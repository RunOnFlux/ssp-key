/**
 * Relay Authentication Utility for SSP Key
 *
 * Provides functions to create authenticated requests for the SSP Relay.
 * All relay endpoints require Bitcoin signature-based authentication.
 */

import { fluxnode } from '@runonflux/flux-sdk';
import { Buffer } from 'buffer';
import QuickCrypto from 'react-native-quick-crypto';
import { sha256 } from '@noble/hashes/sha2.js';
import { wifToPrivateKey, generateAddressKeypair } from './wallet';
import { blockchains } from '@storage/blockchains';
import { cryptos } from '../types';

/**
 * Signature payload structure for relay authentication.
 */
export interface SignaturePayload {
  timestamp: number;
  /**
   * 'read' is only valid for header-signed GET polls (RA-4) — the relay
   * refuses it on POST/socket verifiers, so a read signature can never
   * authorise a write.
   */
  action: 'sync' | 'action' | 'token' | 'join' | 'read';
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
  return hash.digest('hex').toString();
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
  const identityKeypair = generateAddressKeypair(xprivKey, 10, 0, chain);

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

// ---------------------------------------------------------------------------
// RA-4: authenticated GET reads
// ---------------------------------------------------------------------------

/** Header names of the read-auth scheme (all present, or none). */
export const READ_AUTH_HEADERS = {
  signature: 'x-ssp-signature',
  message: 'x-ssp-message',
  publicKey: 'x-ssp-publickey',
  witnessScript: 'x-ssp-witnessscript',
} as const;

/** `x-ssp-*` header name -> value. */
export type ReadAuthHeaders = Record<string, string>;

/**
 * The request path a read signature binds: the URL path WITHOUT the query
 * string (and without scheme/host), e.g. `/v1/action/bc1q…`.
 */
export function relayRequestPath(urlOrPath: string): string {
  const withoutOrigin = urlOrPath.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
  const path = withoutOrigin.split(/[?#]/)[0];
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * `data` of a read signature: sha256 hex of the UTF-8 string `GET <path>`.
 * Real SHA-256 from @noble/hashes (not the quick-crypto shim) so the value is
 * exactly what the relay recomputes.
 */
export function readAuthDataHash(path: string): string {
  const digest = sha256(new TextEncoder().encode(`GET ${path}`));
  return Buffer.from(digest).toString('hex');
}

/**
 * Build the RA-4 read-auth headers for `GET <path>` as `identity`.
 *
 * @param identityPrivKeyWIF - the identity /10/0 private key (WIF)
 * @param publicKey - its compressed public key (66 hex)
 * @param witnessScript - the 2-of-2 identity script; required for multisig
 *   identities (wkIdentity), omitted for single-sig ones
 * @param chain - chain whose message prefix signs (the identity chain)
 */
export function createReadAuthHeaders(params: {
  path: string;
  identity: string;
  identityPrivKeyWIF: string;
  publicKey: string;
  witnessScript?: string;
  chain?: keyof cryptos;
}): ReadAuthHeaders {
  const path = relayRequestPath(params.path);
  const payload = createSignaturePayload(
    'read',
    params.identity,
    readAuthDataHash(path),
  );
  const message = JSON.stringify(payload);
  const headers: ReadAuthHeaders = {
    [READ_AUTH_HEADERS.signature]: signMessage(
      message,
      params.identityPrivKeyWIF,
      params.chain ?? 'btc',
    ),
    [READ_AUTH_HEADERS.message]: message,
    [READ_AUTH_HEADERS.publicKey]: params.publicKey,
  };
  if (params.witnessScript) {
    headers[READ_AUTH_HEADERS.witnessScript] = params.witnessScript;
  }
  return headers;
}
