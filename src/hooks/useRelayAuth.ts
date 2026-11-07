/**
 * useRelayAuth Hook
 *
 * Provides authentication capabilities for SSP Relay communication.
 * This hook handles the decryption of keys and signing of messages
 * for authenticated relay requests.
 */

import { useCallback } from 'react';
import { useAppSelector } from '.';
import * as Keychain from '../lib/keychain';
import * as CryptoJS from 'crypto-js';
import { blockchains } from '@storage/blockchains';
import { generateAddressKeypair } from '../lib/wallet';
import {
  signMessage,
  createSignaturePayload,
  computeBodyHash,
  createReadAuthHeaders as buildReadAuthHeaders,
  AuthFields,
  ReadAuthHeaders,
  SignaturePayload,
} from '../lib/relayAuth';
import { store } from '../store';
import { cryptos } from '../types';

type WriteAction = Exclude<SignaturePayload['action'], 'read'>;

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
    action: WriteAction,
    wkIdentity: string,
    requestBody?: Record<string, unknown>,
    chain?: keyof cryptos,
  ) => Promise<AuthFields | null>;

  /**
   * RA-4: read-auth headers for a GET poll of `path` (e.g.
   * `/v1/action/<wkIdentity>`) as `identity`. Null when the identity key
   * material is not available yet — the caller then polls without headers.
   */
  createReadAuthHeaders: (
    path: string,
    identity: string,
  ) => Promise<ReadAuthHeaders | null>;

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

/** What identity signing needs, all taken from persisted state. */
interface IdentityAuthMaterial {
  witnessScript: string;
  identityPubKey: string;
  /** Encrypted identity-chain xpriv. */
  xprivKey: string | undefined;
  identityChain: keyof cryptos;
}

interface IdentitySigner {
  privKeyWIF: string;
  publicKey: string;
  witnessScript: string;
  /** Chain whose message prefix the relay verifies with. */
  signingChain: keyof cryptos;
}

/**
 * Decrypt the identity xpriv and derive the /10/0 signing key. Null (never a
 * throw) when anything is missing.
 */
async function loadIdentitySigner(
  material: IdentityAuthMaterial,
  chain: keyof cryptos = material.identityChain,
): Promise<IdentitySigner | null> {
  const { witnessScript, identityPubKey, xprivKey } = material;
  if (!witnessScript || !identityPubKey) {
    console.error('witnessScript or identityPubKey not available in state');
    return null;
  }
  if (!xprivKey) {
    console.error('xprivKey not available');
    return null;
  }
  const pwForEncryption = await getDecryptionPassword();
  if (!pwForEncryption) {
    console.error('Could not get decryption password');
    return null;
  }
  let xprivKeyDecrypted = '';
  try {
    xprivKeyDecrypted = CryptoJS.AES.decrypt(
      xprivKey,
      pwForEncryption,
    ).toString(CryptoJS.enc.Utf8);
  } catch {
    xprivKeyDecrypted = '';
  }
  if (!xprivKeyDecrypted) {
    console.error('Failed to decrypt xprivKey');
    return null;
  }
  // Identity keypair for signing (typeIndex=10 for internal identity)
  const identityKeypair = generateAddressKeypair(
    xprivKeyDecrypted,
    10,
    0,
    chain,
  );
  return {
    privKeyWIF: identityKeypair.privKey,
    publicKey: identityPubKey,
    witnessScript,
    // For BTC-based signing, we use 'btc' as the chain for message prefix
    signingChain: blockchains[chain].chainType === 'utxo' ? chain : 'btc',
  };
}

async function readAuthHeadersFor(
  material: IdentityAuthMaterial,
  path: string,
  identity: string,
): Promise<ReadAuthHeaders | null> {
  try {
    const signer = await loadIdentitySigner(material);
    if (!signer) return null;
    return buildReadAuthHeaders({
      path,
      identity,
      identityPrivKeyWIF: signer.privKeyWIF,
      publicKey: signer.publicKey,
      witnessScript: signer.witnessScript,
      chain: signer.signingChain,
    });
  } catch (error) {
    console.error('Error creating read auth headers:', error);
    return null;
  }
}

/**
 * RA-4 read-auth headers built from the CURRENT persisted store state, for
 * callers outside React (action modules such as the enterprise nonce status
 * poll). Same signer as the hook.
 */
export async function createReadAuthHeadersFromStore(
  path: string,
  identity: string,
): Promise<ReadAuthHeaders | null> {
  const state = store.getState();
  const { identityChain } = state.ssp;
  return readAuthHeadersFor(
    {
      witnessScript: state.ssp.sspWalletKeyInternalIdentityWitnessScript,
      identityPubKey: state.ssp.sspWalletKeyInternalIdentityPubKey,
      xprivKey: state[identityChain]?.xprivKey,
      identityChain,
    },
    path,
    identity,
  );
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
      action: WriteAction,
      wkIdentity: string,
      requestBody?: Record<string, unknown>,
      chain: keyof cryptos = identityChain,
    ): Promise<AuthFields | null> => {
      try {
        const signer = await loadIdentitySigner(
          { witnessScript, identityPubKey, xprivKey, identityChain },
          chain,
        );
        if (!signer) return null;

        // Compute body hash if request body is provided
        const dataHash = requestBody ? computeBodyHash(requestBody) : undefined;

        // Create the signature payload (includes body hash for tamper protection)
        const payload = createSignaturePayload(action, wkIdentity, dataHash);
        const message = JSON.stringify(payload);

        // Sign the message using the identity keypair
        const signature = signMessage(
          message,
          signer.privKeyWIF,
          signer.signingChain,
        );

        return {
          signature,
          message,
          publicKey: signer.publicKey,
          witnessScript: signer.witnessScript,
        };
      } catch (error) {
        console.error('Error creating wkIdentity auth:', error);
        return null;
      }
    },
    [xprivKey, witnessScript, identityPubKey, identityChain],
  );

  const createReadAuthHeaders = useCallback(
    (path: string, identity: string) =>
      readAuthHeadersFor(
        { witnessScript, identityPubKey, xprivKey, identityChain },
        path,
        identity,
      ),
    [xprivKey, witnessScript, identityPubKey, identityChain],
  );

  return {
    createWkIdentityAuth,
    createReadAuthHeaders,
    isAuthAvailable,
  };
}

export default useRelayAuth;
