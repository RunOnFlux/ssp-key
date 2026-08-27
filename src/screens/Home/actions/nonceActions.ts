import axios from 'axios';
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { sspConfig } from '@storage/ssp';
import { generatePublicNonce } from '../../../lib/wallet';
import { setSspKeyEnterprisePublicNonces } from '../../../store/ssp';
import { publicPrivateNonce } from '../../../types';
import type { HomeActionContext } from './types';

/**
 * Outcome of a replenish attempt. The function never rejects — the
 * fire-and-forget refresh caller must not be able to break Home — so callers
 * that need to know whether nonces actually reached the relay (the manual
 * "Sync Nonces" action) read this instead of relying on a thrown error.
 */
export interface EnterpriseNonceSyncResult {
  ok: boolean;
  generated: number;
  reason?:
    | 'no_identity'
    | 'busy'
    | 'not_needed'
    | 'no_credentials'
    | 'submit_failed';
}

/**
 * Check enterprise nonce pool and replenish if below threshold.
 * Generates nonces locally, stores private parts in Keychain,
 * submits public parts to relay.
 *
 * @param forceReplace - If true, delete all existing nonces and generate a fresh full set.
 *   Used by the manual "Sync Nonces" action triggered from the enterprise app.
 */
export const checkAndReplenishEnterpriseNonces = async (
  ctx: HomeActionContext,
  forceReplace = false,
): Promise<EnterpriseNonceSyncResult> => {
  const {
    sspWalletKeyInternalIdentity,
    nonceReplenishInProgressRef,
    enterprisePublicNonces,
    dispatch,
  } = ctx;
  if (!sspWalletKeyInternalIdentity) {
    return { ok: false, generated: 0, reason: 'no_identity' };
  }
  if (nonceReplenishInProgressRef.current) {
    if (!forceReplace) {
      return { ok: false, generated: 0, reason: 'busy' };
    }
    // Force replace: wait for background replenish to finish before proceeding
    const maxWait = 30_000;
    const start = Date.now();
    while (
      nonceReplenishInProgressRef.current &&
      Date.now() - start < maxWait
    ) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (nonceReplenishInProgressRef.current) {
      return { ok: false, generated: 0, reason: 'busy' }; // timed out
    }
  }
  nonceReplenishInProgressRef.current = true;
  try {
    const TARGET_COUNT = 50;

    // Check server-side pool status
    let serverAvailable = 0;
    try {
      const statusRes = await axios.get(
        `https://${sspConfig().relay}/v1/nonces/status/${sspWalletKeyInternalIdentity}`,
      );
      const poolData = statusRes.data?.data;
      if (!forceReplace && !poolData?.replenishNeeded?.key) {
        return { ok: true, generated: 0, reason: 'not_needed' };
      }
      serverAvailable = poolData?.key?.available ?? 0;
    } catch {
      // If status check fails, proceed with replenishment based on local count
    }

    // Get encryption key for local storage
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });
    if (!encryptionKey || !passwordData) {
      return { ok: false, generated: 0, reason: 'no_credentials' };
    }

    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const pwForEncryption =
      encryptionKey.password + passwordDecrypted.toString(CryptoJS.enc.Utf8);

    // Load existing enterprise nonces from Redux store
    let existingNonces: publicPrivateNonce[] = [];
    try {
      if (enterprisePublicNonces) {
        const decrypted = CryptoJS.AES.decrypt(
          enterprisePublicNonces,
          pwForEncryption,
        );
        existingNonces = JSON.parse(
          decrypted.toString(CryptoJS.enc.Utf8),
        ) as publicPrivateNonce[];
      }
    } catch {
      // No existing nonces or corrupt data — start fresh
      existingNonces = [];
    }

    // Reconcile: tell server which nonces we actually have locally.
    // This purges server-side 'available' nonces that we don't have
    // (e.g. local storage cleared, app reinstalled) while leaving
    // reserved/used ones untouched.
    //
    // NOTE: forceReplace no longer purges the whole server pool first. That
    // emptied the pool before the refill (a failed refill left it at zero)
    // and wiped local private halves still reserved by pending proposals,
    // making them permanently unsignable. Reconciling against the real local
    // list fixes the same desyncs without either failure mode.
    if (existingNonces.length > 0 || serverAvailable > 0) {
      try {
        const localPublicKeys = existingNonces.map((n) => ({
          kPublic: n.kPublic,
          kTwoPublic: n.kTwoPublic,
        }));
        const reconcileRes = await axios.post(
          `https://${sspConfig().relay}/v1/nonces/reconcile`,
          {
            wkIdentity: sspWalletKeyInternalIdentity,
            source: 'key',
            localNonces: localPublicKeys,
          },
        );
        const purged =
          (reconcileRes.data as { data?: { purged?: number } } | undefined)
            ?.data?.purged ?? 0;
        if (purged > 0) {
          console.log(
            `[Enterprise Nonces] Key: Purged ${purged} orphaned server nonces`,
          );
          serverAvailable = Math.max(serverAvailable - purged, 0);
        }
      } catch {
        // Reconcile is best-effort — don't block replenishment
      }
    }

    // Generate based on what the SERVER needs, not just local count.
    // Handles the case where server nonces were deleted but local still has them.
    const toGenerate = Math.max(
      TARGET_COUNT - existingNonces.length,
      TARGET_COUNT - serverAvailable,
      0,
    );
    if (toGenerate <= 0) {
      return { ok: true, generated: 0, reason: 'not_needed' };
    }

    // Generate new nonces
    const newNonces: publicPrivateNonce[] = [];
    for (let i = 0; i < toGenerate; i++) {
      newNonces.push(generatePublicNonce());
    }

    // Submit public parts to relay FIRST (if this fails, don't save locally)
    const publicParts = newNonces.map((n) => ({
      kPublic: n.kPublic,
      kTwoPublic: n.kTwoPublic,
    }));
    await axios.post(`https://${sspConfig().relay}/v1/nonces`, {
      wkIdentity: sspWalletKeyInternalIdentity,
      source: 'key',
      nonces: publicParts,
    });

    // Merge and store locally (encrypted in Redux, persisted via MMKV)
    const allNonces = [...existingNonces, ...newNonces];
    const encryptedNonces = CryptoJS.AES.encrypt(
      JSON.stringify(allNonces),
      pwForEncryption,
    ).toString();
    dispatch(setSspKeyEnterprisePublicNonces(encryptedNonces));

    console.log(
      `[Enterprise Nonces] Key: Generated and submitted ${toGenerate} nonces (server had ${serverAvailable}, local had ${existingNonces.length})`,
    );
    return { ok: true, generated: toGenerate };
  } catch (error) {
    // Non-critical — don't block Key functionality. The mandatory POST
    // /v1/nonces lands here too, so report the failure instead of swallowing
    // it: callers that told the user a sync started must not claim success.
    console.log('[Enterprise Nonces] Key replenish error:', error);
    return { ok: false, generated: 0, reason: 'submit_failed' };
  } finally {
    nonceReplenishInProgressRef.current = false;
  }
};
