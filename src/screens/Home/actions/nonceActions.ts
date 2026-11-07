import axios from 'axios';
import * as CryptoJS from 'crypto-js';
import * as Keychain from '../../../lib/keychain';
import { sspConfig } from '@storage/ssp';
import { generatePublicNonce } from '../../../lib/wallet';
import { createReadAuthHeadersFromStore } from '../../../hooks/useRelayAuth';
import {
  addEnterpriseNonces,
  readEnterpriseNonces,
} from '../../../lib/enterpriseNoncePool';
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
    | 'no_auth'
    | 'submit_failed';
}

/**
 * Adds the WK identity auth fields (RA-2: `/v1/nonces*` require auth) to a
 * nonce request body. The signature binds a hash of `body`. Fails closed:
 * returns null when auth cannot be produced, and the caller then sends
 * NOTHING (an unsigned nonce write is never posted) and reports `no_auth`
 * so the sync is retried later.
 */
const withWkAuth = async (
  ctx: HomeActionContext,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> => {
  try {
    const auth = ctx.createWkAuth
      ? await ctx.createWkAuth('action', ctx.sspWalletKeyInternalIdentity, body)
      : null;
    return auth ? { ...body, ...auth } : null;
  } catch (error) {
    console.log('[Enterprise Nonces] Could not sign nonce request:', error);
    return null;
  }
};

const NO_AUTH_RESULT: EnterpriseNonceSyncResult = {
  ok: false,
  generated: 0,
  reason: 'no_auth',
};

/**
 * Single in-flight replenish for the whole app (K2). Module scope, so a
 * remounted Home — which gets a fresh nonceReplenishInProgressRef — cannot
 * start a second replenish next to one that is still on the network.
 */
let replenishInFlight = false;

/** Test-only: the module-level replenish lock state. */
export const isEnterpriseReplenishInFlight = (): boolean => replenishInFlight;

/**
 * Check enterprise nonce pool and replenish if below threshold.
 * Generates nonces locally, submits public parts to relay, then stores them
 * (encrypted) in the persisted pool.
 *
 * K2: the pool written at the end is NOT built from the snapshot read at the
 * start. addEnterpriseNonces re-reads the current pool under the pool lock
 * and filters it against the used-nonce ledger, so a nonce a vault signature
 * consumed while this function was on the network is never written back.
 *
 * @param forceReplace - If true, generate a full set even when the relay says
 *   no replenish is needed. Used by the manual "Sync Nonces" action.
 */
export const checkAndReplenishEnterpriseNonces = async (
  ctx: HomeActionContext,
  forceReplace = false,
): Promise<EnterpriseNonceSyncResult> => {
  const { sspWalletKeyInternalIdentity, nonceReplenishInProgressRef } = ctx;
  if (!sspWalletKeyInternalIdentity) {
    return { ok: false, generated: 0, reason: 'no_identity' };
  }
  const isBusy = () => replenishInFlight || nonceReplenishInProgressRef.current;
  if (isBusy()) {
    if (!forceReplace) {
      return { ok: false, generated: 0, reason: 'busy' };
    }
    // Force replace: wait for background replenish to finish before proceeding
    const maxWait = 30_000;
    const start = Date.now();
    while (isBusy() && Date.now() - start < maxWait) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (isBusy()) {
      return { ok: false, generated: 0, reason: 'busy' }; // timed out
    }
  }
  replenishInFlight = true;
  nonceReplenishInProgressRef.current = true;
  try {
    const TARGET_COUNT = 50;

    // Check server-side pool status
    let serverAvailable = 0;
    try {
      // RA-4: the status read is signed with the WK identity (headers), so
      // it keeps working once the relay enforces read auth.
      const statusPath = `/v1/nonces/status/${sspWalletKeyInternalIdentity}`;
      let readHeaders: Record<string, string> | null = null;
      try {
        readHeaders = await createReadAuthHeadersFromStore(
          statusPath,
          sspWalletKeyInternalIdentity,
        );
      } catch {
        readHeaders = null;
      }
      const statusRes = await axios.get(
        `https://${sspConfig().relay}${statusPath}`,
        readHeaders ? { headers: readHeaders } : undefined,
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

    // The CURRENT pool (read from the store now, used nonces removed) — only
    // used for the reconcile list and the count. The write below re-reads.
    let existingNonces: publicPrivateNonce[] = [];
    try {
      existingNonces = readEnterpriseNonces(pwForEncryption);
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
      const reconcileBody = await withWkAuth(ctx, {
        wkIdentity: sspWalletKeyInternalIdentity,
        source: 'key',
        localNonces: existingNonces.map((n) => ({
          kPublic: n.kPublic,
          kTwoPublic: n.kTwoPublic,
        })),
      });
      if (!reconcileBody) {
        console.log(
          '[Enterprise Nonces] WK auth unavailable — not sending; retry later',
        );
        return NO_AUTH_RESULT;
      }
      try {
        const reconcileRes = await axios.post(
          `https://${sspConfig().relay}/v1/nonces/reconcile`,
          reconcileBody,
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
    const submitBody = await withWkAuth(ctx, {
      wkIdentity: sspWalletKeyInternalIdentity,
      source: 'key',
      nonces: publicParts,
    });
    if (!submitBody) {
      // Fail closed: nothing is posted and nothing is stored — the freshly
      // generated nonces never leave this function.
      console.log(
        '[Enterprise Nonces] WK auth unavailable — not sending; retry later',
      );
      return NO_AUTH_RESULT;
    }
    await axios.post(`https://${sspConfig().relay}/v1/nonces`, submitBody);

    // Merge into the pool as it is NOW (re-read under the pool lock, used
    // nonces filtered out) and flush it to disk.
    const poolSize = await addEnterpriseNonces(newNonces, pwForEncryption);

    console.log(
      `[Enterprise Nonces] Key: Generated and submitted ${toGenerate} nonces (server had ${serverAvailable}, local pool now ${poolSize})`,
    );
    return { ok: true, generated: toGenerate };
  } catch (error) {
    // Non-critical — don't block Key functionality. The mandatory POST
    // /v1/nonces lands here too, so report the failure instead of swallowing
    // it: callers that told the user a sync started must not claim success.
    console.log('[Enterprise Nonces] Key replenish error:', error);
    return { ok: false, generated: 0, reason: 'submit_failed' };
  } finally {
    replenishInFlight = false;
    nonceReplenishInProgressRef.current = false;
  }
};
