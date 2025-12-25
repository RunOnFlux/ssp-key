/**
 * Relay Authentication Utility for SSP Key
 *
 * Provides functions to create authenticated requests for the SSP Relay.
 * All relay endpoints require Bitcoin signature-based authentication.
 */

import { fluxnode } from '@runonflux/flux-sdk';
import { Buffer } from 'buffer';
import QuickCrypto from 'react-native-quick-crypto';
import { wifToPrivateKey, generateAddressKeypair } from './wallet';
import { blockchains } from '@storage/blockchains';
import { cryptos } from '../types';

/**
 * Signature payload structure for relay authentication.
 */
export interface SignaturePayload {
  timestamp: number;
  action: 'sync' | 'action' | 'token' | 'join';
  identity: string;
  nonce: string;
  data?: string;
}

/**
 * Authentication fields to include in relay requests.
 */
export interface AuthFields {
  signature: string;
  message: string;
  publicKey: string;
  witnessScript?: string;
}

/**
 * Generate a random 32-byte nonce as hex string.
 */
export function generateNonce(): string {
  return Buffer.from(QuickCrypto.randomBytes(32)).toString('hex');
}

/**
 * Compute SHA256 hash of request body for signing.
 * This binds the signature to the actual request data.
 *
 * @param body - The request body to hash
 * @returns Hex-encoded SHA256 hash
 */
export function computeBodyHash(body: Record<string, unknown>): string {
  const jsonString = JSON.stringify(body);
  const hash = QuickCrypto.createHash('sha256');
  hash.update(jsonString);
  return hash.digest('hex');
}

/**
 * Create the signature payload for a relay request.
 *
 * @param action - The action type (sync, action, token, join)
 * @param identity - The identity being authenticated
 * @param dataHash - Optional hash of request body
 * @returns The signature payload object
 */
export function createSignaturePayload(
  action: SignaturePayload['action'],
  identity: string,
  dataHash?: string,
): SignaturePayload {
  return {
    timestamp: Date.now(),
    action,
    identity,
    nonce: generateNonce(),
    ...(dataHash && { data: dataHash }),
  };
}

/**
 * Sign a message using Bitcoin message signing format.
 *
 * @param message - The message to sign
 * @param privateKeyWIF - Private key in WIF format
 * @param chain - The blockchain for message prefix
 * @returns Base64-encoded signature
 */
export function signMessage(
  message: string,
  privateKeyWIF: string,
  chain: keyof cryptos = 'btc',
): string {
  const blockchainConfig = blockchains[chain];
  const isCompressed = true; // SSP always uses compressed keys
  const privateKeyHex = wifToPrivateKey(privateKeyWIF, chain);
  const messagePrefix = blockchainConfig.messagePrefix;

  // Sign with extra entropy for non-deterministic signatures
  const extraEntropy = Buffer.from(QuickCrypto.randomBytes(32));
  const signature = fluxnode.signMessage(
    message,
    privateKeyHex,
    isCompressed,
    messagePrefix,
    { extraEntropy },
  );

  return signature;
}

/**
 * Create authentication fields for a relay request using pre-stored identity data.
 *
 * @param action - The action type
 * @param wkIdentity - The wkIdentity being authenticated
 * @param xprivKey - Key's extended private key (for signing)
 * @param witnessScript - Pre-computed witness script from state
 * @param publicKey - Pre-computed identity public key from state
 * @param chain - The blockchain
 * @param dataHash - Optional hash of request body for tamper protection
 * @returns Authentication fields to include in the request
 */
export function createMultisigAuth(
  action: SignaturePayload['action'],
  wkIdentity: string,
  xprivKey: string,
  witnessScript: string,
  publicKey: string,
  chain: keyof cryptos,
  dataHash?: string,
): AuthFields {
  // Derive private key for signing (typeIndex=10 for internal identity)
  const identityKeypair = generateAddressKeypair(
    xprivKey,
    10,
    0,
    chain,
  );

  // Create the payload with optional data hash
  const payload = createSignaturePayload(action, wkIdentity, dataHash);
  const message = JSON.stringify(payload);

  // Sign the message
  const signature = signMessage(message, identityKeypair.privKey, chain);

  return {
    signature,
    message,
    publicKey,
    witnessScript,
  };
}

/**
 * Add authentication fields to a request body.
 *
 * @param body - The original request body
 * @param authFields - The authentication fields
 * @returns The request body with auth fields added
 */
export function addAuthToRequest<T extends Record<string, unknown>>(
  body: T,
  authFields: AuthFields,
): T & AuthFields {
  return {
    ...body,
    ...authFields,
  };
}
