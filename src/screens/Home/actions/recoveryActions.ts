import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { buildRecoveryResponse } from '../../../lib/recoveryHandler';
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
      throw new Error('Unable to decrypt stored data');
    }
    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const pwForEncryption =
      encryptionKey.password + passwordDecrypted.toString(CryptoJS.enc.Utf8);
    const xprivEncrypted = identityChainState?.xprivKey;
    if (!xprivEncrypted || typeof xprivEncrypted !== 'string') {
      throw new Error('Identity xpriv not available');
    }
    const xprivDecrypted = CryptoJS.AES.decrypt(
      xprivEncrypted,
      pwForEncryption,
    ).toString(CryptoJS.enc.Utf8);
    if (!xprivDecrypted) {
      throw new Error('Failed to decrypt identity xpriv');
    }
    const response = buildRecoveryResponse({
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
    clearRecoveryRequest?.();
  } catch (error) {
    console.log('[recovery] approve failed', error);
    displayMessage('error', (error as Error)?.message ?? 'Recovery failed');
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
