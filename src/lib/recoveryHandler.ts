/**
 * Recovery Handler (ssp-key side).
 *
 * Derives the recovery private key `sk_r` from the SSP Key seed on demand,
 * wraps it for transport to the wallet using the wallet's ephemeral pubkey,
 * and returns the response payload ready for POST to `/v1/action`.
 *
 * `sk_r(i)` is derived at `m/48'/coin'/99'/scriptType'/0/i` — the recovery
 * account, whose keys exist solely to be released. See lib/recoveryAccount.ts.
 *
 * The caller (screen/UI layer) is responsible for:
 *   - Decrypting the recovery xpriv from the store (requires user auth). The
 *     mnemonic is not needed here — the stored account key is all this path
 *     uses.
 *   - Calling this helper with the decrypted xprivs + the incoming request.
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
import { RECOVERY_CHANGE_INDEX } from './recoveryAccount';

/**
 * Identity leaf m/48'/coin'/0'/scriptType'/10/0 — the pubkey forms wkIdentity;
 * the privkey stays on the device (ECDH + relay-auth only).
 */
const IDENTITY_TYPE_INDEX = 10;
const FIXED_ADDRESS_INDEX = 0;

export interface RecoveryRequestPayload {
  pkEph: string; // hex, 33-byte compressed secp256k1 pubkey
  nonce: string; // hex
  timestamp: number;
  /** Which sk_r(i) under the recovery account the requester's envelope uses. */
  recoveryIndex: number;
}

export interface RecoveryResponsePayload {
  version: 2; // protocol version
  transit: string; // hex of wrapped sk_r
  nonce: string; // echoed
  timestamp: number; // echoed
  recoveryIndex: number; // which sk_r(i) under the recovery account
}

/**
 * How far out of step a request's timestamp may be before it is refused. A
 * recovery request is approved by the user in real time, so the accepted
 * window is deliberately narrow.
 */
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;

/**
 * Nonces answered in this process. A recovery response releases a private key,
 * so each request is answered exactly once.
 */
const answeredNonces = new Set<string>();

/**
 * Clears the answered set. Only the tests need this — the set is per-process,
 * and a nonce is random, so nothing depends on it being emptied at runtime.
 */
export function resetAnsweredNonces(): void {
  answeredNonces.clear();
}

/**
 * Build the recovery response payload from the decrypted RECOVERY account xpriv
 * and an incoming recovery request.
 *
 * @param xprivRecovery plaintext xpriv at m/48'/coin'/99'/scriptType' — the
 *   recovery account, whose keys are what this flow releases.
 *   See lib/recoveryAccount.ts.
 * @param xprivKeyIdentity plaintext xpriv at m/48'/coin'/0'/scriptType' — used
 *   to derive /10/0 for the ECDH transit wrap, so the wallet can confirm the
 *   response came from this Key.
 * @param request the incoming recovery request from the wallet.
 * @param identityChain typically 'btc' — must match the wallet side.
 */
export function buildRecoveryResponse(params: {
  xprivRecovery: string;
  xprivKeyIdentity: string;
  request: RecoveryRequestPayload;
  identityChain: keyof cryptos;
}): RecoveryResponsePayload {
  const { xprivRecovery, xprivKeyIdentity, request, identityChain } = params;

  if (!/^[0-9a-f]+$/i.test(request.pkEph) || request.pkEph.length !== 66) {
    throw new Error('invalid pkEph in recovery request');
  }
  if (!/^[0-9a-f]+$/i.test(request.nonce) || request.nonce.length < 32) {
    throw new Error('invalid nonce in recovery request');
  }
  if (
    typeof request.timestamp !== 'number' ||
    !Number.isFinite(request.timestamp) ||
    Math.abs(Date.now() - request.timestamp) > MAX_REQUEST_AGE_MS
  ) {
    throw new Error('recovery request timestamp outside the accepted window');
  }
  if (answeredNonces.has(request.nonce)) {
    throw new Error('recovery request nonce already answered');
  }

  if (
    typeof request.recoveryIndex !== 'number' ||
    !Number.isInteger(request.recoveryIndex) ||
    request.recoveryIndex < 0 ||
    request.recoveryIndex >= 0x80000000
  ) {
    throw new Error('invalid recoveryIndex in recovery request');
  }
  const recoveryIndex = request.recoveryIndex;

  const bipParams = blockchains[identityChain].bip32;

  // sk_r(i) from the recovery account. The final two levels are non-hardened so
  // the wallet can derive pk_r(i) from the published account xpub.
  const recoveryAccountHd = HDKey.fromExtendedKey(xprivRecovery, bipParams);
  const recoveryChild = recoveryAccountHd
    .deriveChild(RECOVERY_CHANGE_INDEX)
    .deriveChild(recoveryIndex);
  if (!recoveryChild.privateKey) {
    throw new Error('derivation did not yield a recovery privkey');
  }
  const skR = Buffer.from(recoveryChild.privateKey);

  // Identity privkey at /10/0 — used here to perform the ECDH transit
  // wrap with the wallet's ephemeral pubkey. Same key ssp-key uses for
  // relay-auth signing elsewhere, but only the privkey participates in
  // ECDH here; it is never released to the wallet.
  const identityHd = HDKey.fromExtendedKey(xprivKeyIdentity, bipParams);
  const identityChild = identityHd
    .deriveChild(IDENTITY_TYPE_INDEX)
    .deriveChild(FIXED_ADDRESS_INDEX);
  if (!identityChild.privateKey) {
    throw new Error('derivation did not yield the identity privkey');
  }
  const sspKeyIdentityPriv = Buffer.from(identityChild.privateKey);

  const walletEphPub = Buffer.from(request.pkEph, 'hex');
  const transit = wrapSkRForTransit(sspKeyIdentityPriv, walletEphPub, skR);

  skR.fill(0);
  sspKeyIdentityPriv.fill(0);

  answeredNonces.add(request.nonce);

  return {
    version: 2,
    transit,
    nonce: request.nonce,
    timestamp: request.timestamp,
    recoveryIndex,
  };
}
