/**
 * Recovery Handler (ssp-key side).
 *
 * Derives the recovery private key `sk_r` from the SSP Key seed on demand,
 * wraps it for transport to the wallet using the wallet's ephemeral pubkey,
 * and returns the response payload ready for POST to `/v1/action`.
 *
 * ssp-key holds no persistent state for recovery — `sk_r` is derived
 * deterministically at `m/48'/coin_identity'/0'/scriptType'/11/0` each
 * time the handler is invoked. This mirrors the wallet's understanding:
 * the recovery key is a BIP32 child of the same master xpriv already used
 * for wkIdentity multisig signing.
 *
 * The caller (screen/UI layer) is responsible for:
 *   - Decrypting the identity xpriv from Keychain (requires user auth).
 *   - Calling this helper with the decrypted xpriv + the incoming request.
 *   - Posting the returned `responsePayload` to relay via POST /v1/action
 *     with action type 'recoveryresponse'.
 *
 * On deny, the UI layer POSTs action type 'recoverydenied' directly with
 * no call into this handler.
 */

import { HDKey } from '@scure/bip32';
import { Buffer } from 'buffer';

import { blockchains } from '@storage/blockchains';
import { cryptos } from '../types';
import { wrapSkRForTransit } from './recoveryCrypto';

const RECOVERY_TYPE_INDEX = 11;
const FIXED_ADDRESS_INDEX = 0;

export interface RecoveryRequestPayload {
  pkEph: string; // hex, 33-byte compressed secp256k1 pubkey
  nonce: string; // hex
  timestamp: number;
}

export interface RecoveryResponsePayload {
  transit: string; // hex of wrapped sk_r
  nonce: string; // echoed
  timestamp: number; // echoed
}

/**
 * Build the recovery response payload given a decrypted identity xpriv and
 * an incoming recovery request.
 *
 * @param xprivKeyIdentity plaintext xpriv at m/48'/coin_id'/0'/scriptType'
 *   — decrypted from Keychain by the caller after user auth.
 * @param request the incoming recovery request from the wallet.
 * @param identityChain typically 'btc' — should match wallet side.
 */
export function buildRecoveryResponse(params: {
  xprivKeyIdentity: string;
  request: RecoveryRequestPayload;
  identityChain: keyof cryptos;
}): RecoveryResponsePayload {
  const { xprivKeyIdentity, request, identityChain } = params;

  if (!/^[0-9a-f]+$/i.test(request.pkEph) || request.pkEph.length !== 66) {
    throw new Error('invalid pkEph in recovery request');
  }
  if (!/^[0-9a-f]+$/i.test(request.nonce)) {
    throw new Error('invalid nonce in recovery request');
  }

  const bipParams = blockchains[identityChain].bip32;
  const masterHd = HDKey.fromExtendedKey(xprivKeyIdentity, bipParams);

  const recoveryChild = masterHd
    .deriveChild(RECOVERY_TYPE_INDEX)
    .deriveChild(FIXED_ADDRESS_INDEX);
  if (!recoveryChild.privateKey) {
    throw new Error('derivation did not yield a recovery privkey');
  }
  const skR = Buffer.from(recoveryChild.privateKey);

  // Identity privkey at /10/0 — used here to perform the ECDH transit
  // wrap with the wallet's ephemeral pubkey. Same key ssp-key uses for
  // relay-auth signing elsewhere, but only the privkey participates in
  // ECDH here; it is never released to the wallet.
  const identityChild = masterHd.deriveChild(10).deriveChild(0);
  if (!identityChild.privateKey) {
    throw new Error('derivation did not yield the identity privkey');
  }
  const sspKeyIdentityPriv = Buffer.from(identityChild.privateKey);

  const walletEphPub = Buffer.from(request.pkEph, 'hex');
  const transit = wrapSkRForTransit(sspKeyIdentityPriv, walletEphPub, skR);

  skR.fill(0);
  sspKeyIdentityPriv.fill(0);

  return {
    transit,
    nonce: request.nonce,
    timestamp: request.timestamp,
  };
}
