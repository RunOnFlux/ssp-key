/**
 * useRelayAuth Hook
 *
 * Provides authentication capabilities for SSP Relay communication.
 * This hook handles the decryption of keys and signing of messages
 * for authenticated relay requests.
 */

import { useCallback } from 'react';
import { useAppSelector } from '.';
import * as Keychain from 'react-native-keychain';
import * as CryptoJS from 'crypto-js';
import { blockchains } from '@storage/blockchains';
import { generateAddressKeypair } from '../lib/wallet';
import {
  signMessage,
  createSignaturePayload,
  computeBodyHash,
  AuthFields,
  SignaturePayload,
} from '../lib/relayAuth';
import { cryptos } from '../types';

interface UseRelayAuthResult {
  /**
   * Create authentication fields for a wkIdentity request.
   * Returns null if authentication fails.
   *
   * @param action - The action type (sync, action, token, join)
   * @param wkIdentity - The wkIdentity to authenticate
   * @param requestBody - Optional request body to hash and bind to signature
   * @param chain - The blockchain (defaults to identityChain)
   */
  createWkIdentityAuth: (
    action: SignaturePayload['action'],
    wkIdentity: string,
    requestBody?: Record<string, unknown>,
    chain?: keyof cryptos,
  ) => Promise<AuthFields | null>;

  /**
   * Check if authentication is available (wallet is synced).
   */
  isAuthAvailable: boolean;
}

/**
 * Get the decrypted password for encryption operations.
 */
async function getDecryptionPassword(): Promise<string | null> {
  try {
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });

    if (!encryptionKey || !passwordData) {
      console.warn('No encryption key or password available');
      return null;
    }

    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const passwordDecryptedString = passwordDecrypted.toString(
      CryptoJS.enc.Utf8,
    );

    return encryptionKey.password + passwordDecryptedString;
  } catch (error) {
    console.error('Error getting decryption password:', error);
    return null;
  }
}

/**
 * Hook for creating authenticated relay requests.
 *
 * Usage:
 * ```
 * const { createWkIdentityAuth } = useRelayAuth();
 *
 * const sendAction = async () => {
 *   const auth = await createWkIdentityAuth('action', wkIdentity);
 *   if (!auth) {
 *     console.error('Auth failed');
 *     return;
 *   }
 *   await axios.post('/v1/action', { ...data, ...auth });
 * };
 * ```
 */
export function useRelayAuth(): UseRelayAuthResult {
  const {
    sspWalletKeyInternalIdentity,
    sspWalletKeyInternalIdentityWitnessScript: witnessScript,
    sspWalletKeyInternalIdentityPubKey: identityPubKey,
    identityChain,
  } = useAppSelector((state) => state.ssp);

  // Get the chain state for the identity chain (only need xprivKey now)
  const chainState = useAppSelector((state) => state[identityChain]);
  const { xprivKey } = chainState || {};

  const isAuthAvailable = Boolean(
    sspWalletKeyInternalIdentity && witnessScript && identityPubKey && xprivKey,
  );

  /**
   * Create authentication fields for a wkIdentity request.
   */
  const createWkIdentityAuth = useCallback(
    async (
      action: SignaturePayload['action'],
      wkIdentity: string,
      requestBody?: Record<string, unknown>,
      chain: keyof cryptos = identityChain,
    ): Promise<AuthFields | null> => {
      try {
        // Check required state values
        if (!witnessScript || !identityPubKey) {
          console.error(
            'witnessScript or identityPubKey not available in state',
          );
          return null;
        }

        // Get the decryption password
        const pwForEncryption = await getDecryptionPassword();
        if (!pwForEncryption) {
          console.error('Could not get decryption password');
          return null;
        }

        // Decrypt xpriv for signing
        if (!xprivKey) {
          console.error('xprivKey not available');
          return null;
        }
        const xprivDecrypted = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
        const xprivKeyDecrypted = xprivDecrypted.toString(CryptoJS.enc.Utf8);
        if (!xprivKeyDecrypted) {
          console.error('Failed to decrypt xprivKey');
          return null;
        }

        // Generate identity keypair for signing (typeIndex=10 for internal identity)
        const identityKeypair = generateAddressKeypair(
          xprivKeyDecrypted,
          10,
          0,
          chain,
        );

        // Compute body hash if request body is provided
        const dataHash = requestBody ? computeBodyHash(requestBody) : undefined;

        // Create the signature payload (includes body hash for tamper protection)
        const payload = createSignaturePayload(action, wkIdentity, dataHash);
        const message = JSON.stringify(payload);

        // Sign the message using the identity keypair
        // For BTC-based signing, we use 'btc' as the chain for message prefix
        const signature = signMessage(
          message,
          identityKeypair.privKey,
          blockchains[chain].chainType === 'utxo' ? chain : 'btc',
        );

        return {
          signature,
          message,
          publicKey: identityPubKey,
          witnessScript,
        };
      } catch (error) {
        console.error('Error creating wkIdentity auth:', error);
        return null;
      }
    },
    [xprivKey, witnessScript, identityPubKey, identityChain],
  );

  return {
    createWkIdentityAuth,
    isAuthAvailable,
  };
}

export default useRelayAuth;
