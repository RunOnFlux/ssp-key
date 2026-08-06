/**
 * Publishing the recovery account xpub.
 *
 * SSP Wallet needs this account's xpub (see lib/recoveryAccount.ts) before it
 * can build a recovery envelope. A fresh pairing carries it inside the sync
 * record, but that record — like every other relay document except push tokens
 * — expires after 15 minutes, and a wallet that paired earlier has no way to
 * ask for it later. So the Key also publishes it to a persistent relay record,
 * which the wallet reads whenever it needs one.
 *
 * The relay is storage only. Alongside the xpub the Key posts a detached
 * signature over it, made with the identity key at /10/0 — the same key whose
 * public half the wallet already derives from `xpubKeyIdentity` for wkIdentity.
 * The wallet checks that signature before using the xpub, so a substituted
 * value is rejected rather than merely useless.
 */

import { blockchains } from '@storage/blockchains';
import { generateAddressKeypair } from './wallet';
import { signMessage } from './relayAuth';
import { cryptos } from '../types';

/** Identity leaf used for the signature: m/48'/coin'/0'/scriptType'/10/0. */
const IDENTITY_TYPE_INDEX = 10;
const FIXED_ADDRESS_INDEX = 0;

/**
 * The exact bytes both sides sign and verify. Domain-separated, and bound to
 * the identity it belongs to so a record cannot be replayed onto another.
 *
 * Kept byte-identical to SSP Wallet's copy — the wallet's verifier rebuilds
 * this string from the record it fetched.
 */
export function recoveryXpubMessage(
  wkIdentity: string,
  recoveryXpub: string,
): string {
  return `ssp-recovery-xpub\n${wkIdentity}\n${recoveryXpub}`;
}

/**
 * Sign the recovery account xpub with the identity key.
 *
 * @param xprivKeyIdentity plaintext xpriv at m/48'/coin'/0'/scriptType'. Only
 *   /10/0 is used, and only to sign — nothing is derived for release here.
 * @returns base64 Bitcoin signed message, as `signMessage` produces elsewhere.
 */
export function signRecoveryXpub(params: {
  xprivKeyIdentity: string;
  wkIdentity: string;
  recoveryXpub: string;
  identityChain: keyof cryptos;
}): string {
  const { xprivKeyIdentity, wkIdentity, recoveryXpub, identityChain } = params;
  const identityKeypair = generateAddressKeypair(
    xprivKeyIdentity,
    IDENTITY_TYPE_INDEX,
    FIXED_ADDRESS_INDEX,
    identityChain,
  );
  return signMessage(
    recoveryXpubMessage(wkIdentity, recoveryXpub),
    identityKeypair.privKey,
    blockchains[identityChain].chainType === 'utxo' ? identityChain : 'btc',
  );
}
