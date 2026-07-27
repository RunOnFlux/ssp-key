import axios from 'axios';
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { sspConfig } from '@storage/ssp';
import { buildRecoveryResponse } from '../../../lib/recoveryHandler';
import { signRecoveryXpub } from '../../../lib/recoveryPublish';
import type { HomeActionContext } from './types';

/**
 * Respond to a wallet-issued randomParams recovery request. Derives
 * sk_r from the identity seed on demand, wraps it with ECDH+AES-GCM
 * using the wallet's ephemeral pubkey from the request, and posts the
 * response back through the relay.
 */
export const approveRecoveryRequest = async (ctx: HomeActionContext) => {
  const {
    recoveryRequest,
    identityChainState,
    identityChain,
    postAction,
    sspWalletKeyInternalIdentity,
    t,
    displayMessage,
    clearRecoveryRequest,
  } = ctx;
  if (!recoveryRequest) return;
  try {
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });
    if (!passwordData || !encryptionKey) {
      throw new Error('[recovery] stored password/encryption key unavailable');
    }
    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const pwForEncryption =
      encryptionKey.password + passwordDecrypted.toString(CryptoJS.enc.Utf8);
    const xprivEncrypted = identityChainState?.xprivKey;
    if (!xprivEncrypted || typeof xprivEncrypted !== 'string') {
      throw new Error('[recovery] identity xpriv not available');
    }
    const xprivDecrypted = CryptoJS.AES.decrypt(
      xprivEncrypted,
      pwForEncryption,
    ).toString(CryptoJS.enc.Utf8);
    if (!xprivDecrypted) {
      throw new Error('[recovery] identity xpriv decryption failed');
    }
    // Needs the recovery account. Until it is provisioned there is nothing to
    // answer with, so decline.
    const xprivRecoveryEncrypted = ctx.xprivRecovery;
    if (!xprivRecoveryEncrypted || typeof xprivRecoveryEncrypted !== 'string') {
      throw new Error('[recovery] recovery account not provisioned');
    }
    const xprivRecoveryDecrypted = CryptoJS.AES.decrypt(
      xprivRecoveryEncrypted,
      pwForEncryption,
    ).toString(CryptoJS.enc.Utf8);
    if (!xprivRecoveryDecrypted) {
      throw new Error('[recovery] recovery xpriv decryption failed');
    }
    const response = buildRecoveryResponse({
      xprivRecovery: xprivRecoveryDecrypted,
      xprivKeyIdentity: xprivDecrypted,
      request: recoveryRequest,
      identityChain,
    });
    await postAction(
      'recoveryresponse',
      JSON.stringify(response),
      identityChain,
      '',
      sspWalletKeyInternalIdentity,
    );
    // Confirm on this device too — the request screen closes on approve, so
    // without this the only outcome report is on the requesting wallet.
    displayMessage('success', t('home:recovery_request_approved_info'));
    clearRecoveryRequest?.();
  } catch (error) {
    // The thrown messages above are developer detail (never translated, and
    // they name internal key material) — the user gets one actionable string.
    console.log('[recovery] approve failed', error);
    displayMessage('error', t('home:err_recovery_failed'));
    clearRecoveryRequest?.();
  }
};
export const denyRecoveryRequest = async (ctx: HomeActionContext) => {
  const {
    recoveryRequest,
    postAction,
    identityChain,
    sspWalletKeyInternalIdentity,
    clearRecoveryRequest,
  } = ctx;
  if (!recoveryRequest) return;
  try {
    await postAction(
      'recoverydenied',
      JSON.stringify({
        nonce: recoveryRequest.nonce,
        timestamp: recoveryRequest.timestamp,
      }),
      identityChain,
      '',
      sspWalletKeyInternalIdentity,
    );
  } catch (error) {
    console.log('[recovery] deny post failed', error);
  } finally {
    clearRecoveryRequest?.();
  }
};

/**
 * Publish this device's recovery account xpub to the relay.
 *
 * SSP Wallet needs it before it can build a recovery envelope. Pairing carries
 * it in the sync record, but that record expires; this persistent copy is what
 * a wallet paired earlier reads. Runs unattended — the xpub is public, and the
 * accompanying signature lets the wallet verify it without trusting the relay
 * (see lib/recoveryPublish.ts).
 */
export const publishRecoveryXpub = async (
  ctx: HomeActionContext,
): Promise<boolean> => {
  const {
    xpubRecovery,
    identityChainState,
    identityChain,
    createWkAuth,
    sspWalletKeyInternalIdentity,
  } = ctx;
  if (!xpubRecovery || !sspWalletKeyInternalIdentity) return false;
  try {
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });
    if (!passwordData || !encryptionKey) {
      throw new Error('[recovery] stored password/encryption key unavailable');
    }
    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const pwForEncryption =
      encryptionKey.password + passwordDecrypted.toString(CryptoJS.enc.Utf8);

    const recoveryXpub = CryptoJS.AES.decrypt(
      xpubRecovery,
      pwForEncryption,
    ).toString(CryptoJS.enc.Utf8);
    if (!recoveryXpub) {
      throw new Error('[recovery] recovery xpub decryption failed');
    }
    const xprivEncrypted = identityChainState?.xprivKey;
    if (!xprivEncrypted || typeof xprivEncrypted !== 'string') {
      throw new Error('[recovery] identity xpriv not available');
    }
    const xprivKeyIdentity = CryptoJS.AES.decrypt(
      xprivEncrypted,
      pwForEncryption,
    ).toString(CryptoJS.enc.Utf8);
    if (!xprivKeyIdentity) {
      throw new Error('[recovery] identity xpriv decryption failed');
    }

    const xpubSignature = signRecoveryXpub({
      xprivKeyIdentity,
      wkIdentity: sspWalletKeyInternalIdentity,
      recoveryXpub,
      identityChain,
    });

    const body: Record<string, unknown> = {
      wkIdentity: sspWalletKeyInternalIdentity,
      recoveryXpub,
      xpubSignature,
      chain: identityChain,
    };
    // The endpoint requires wkIdentity auth: only the paired Key may write this
    // identity's record, so nobody else can overwrite it.
    const auth = await createWkAuth('sync', sspWalletKeyInternalIdentity, body);
    if (!auth) {
      throw new Error('[recovery] relay auth unavailable');
    }
    await axios.post(`https://${sspConfig().relay}/v1/recoverypub`, {
      ...body,
      ...auth,
    });
    return true;
  } catch (error) {
    // Unattended, so nothing is shown. The caller retries, and the wallet reads
    // the record whenever it next needs one.
    console.log('[recovery] xpub publish failed', error);
    return false;
  }
};
