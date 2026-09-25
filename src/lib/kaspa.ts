/**
 * Kaspa (chainType 'kas') on @runonflux/kaspa-core.
 *
 * Vaults are P2SH multisig over the sorted x-only Schnorr keys of every
 * signer at the same BIP-48 leaf (consumer: m/48'/111111'/0'/0'/type/index,
 * wallet + key 2-of-2; enterprise: m/48'/111111'/org'/0'/vault/index).
 * SSP Wallet derives the identical script: every derivation here must stay
 * byte-for-byte in step with ssp-wallet's src/lib/kaspa.ts and with
 * KASPA_SSP_CONTRACT.md §2 (the test vectors pin both).
 *
 * SSP Key is a CO-SIGNER, so everything that reads a SigningBundle obeys the
 * contract's security rules (§4): bundles are only ever opened against this
 * device's OWN UTXO lookup (never the relay's `utxos` or the payload's claimed
 * entries), only the vault's own scripts are signed, and every signature goes
 * through the persistent signed-amount ledger (lib/kaspaLedger.ts).
 *
 * Only the '.' and './rest' entry points of kaspa-core are imported — never
 * './wrpc' (SSP only needs REST).
 */
import * as K from '@runonflux/kaspa-core';
import { createRestClient } from '@runonflux/kaspa-core/rest';
import type {
  FetchLike,
  KaspaRestClient,
  KaspaUtxo,
} from '@runonflux/kaspa-core/rest';
import { HDKey } from '@scure/bip32';
import { blockchains } from '@storage/blockchains';
import { backends } from '@storage/backends';

export type KasSpend = K.Spend;
export type KasSigningBundle = K.SigningBundle;
export type KasOpenedBundle = ReturnType<typeof K.openSigningBundle>;
export type { KaspaUtxo };

export const KAS_BUNDLE_FORMAT = 'kaspa-core-signing-bundle';

/** The address prefix of a Kaspa chain ('kaspa'). */
export function kasPrefix(chain: string): K.NetworkPrefix {
  return blockchains[chain].libid as K.NetworkPrefix;
}

export function isKasChain(chain: string): boolean {
  return blockchains[chain]?.chainType === 'kas';
}

// ---------------------------------------------------------------------------
// Keys, scripts and addresses
// ---------------------------------------------------------------------------

function leafPublicKey(
  xpub: string,
  a: number,
  b: number,
  chain: string,
): Uint8Array {
  const node = HDKey.fromExtendedKey(xpub, blockchains[chain].bip32)
    .deriveChild(a)
    .deriveChild(b);
  if (!node.publicKey) throw new Error('Kaspa key derivation failed');
  return node.publicKey;
}

/** x-only (32-byte) public key of an account xpub at leaf a/b. */
export function kasLeafXOnly(
  xpub: string,
  a: number,
  b: number,
  chain: string,
): Uint8Array {
  return K.xOnlyFromCompressed(leafPublicKey(xpub, a, b, chain));
}

/** The consumer 2-of-2 vault spend (sorted x-only keys) at a leaf. */
export function kasVaultSpend(
  xpubWallet: string,
  xpubKey: string,
  typeIndex: number,
  addressIndex: number,
  chain: string,
): KasSpend {
  const w = kasLeafXOnly(xpubWallet, typeIndex, addressIndex, chain);
  const k = kasLeafXOnly(xpubKey, typeIndex, addressIndex, chain);
  return K.multisigSpend([w, k], 2);
}

/** Address (kaspa:p…) and redeem script (hex) of a multisig spend. */
export function kasSpendAddress(
  spend: KasSpend,
  chain: string,
): { address: string; redeemScript: string } {
  if (spend.kind !== 'p2sh-multisig') {
    throw new Error('Kaspa vault spend must be a P2SH multisig');
  }
  const address = K.scriptPublicKeyToAddress(
    K.spendScriptPublicKey(spend),
    kasPrefix(chain),
  );
  if (!address) throw new Error('Kaspa address encoding failed');
  return { address, redeemScript: K.bytesToHex(spend.redeem) };
}

/** Consumer vault address (kaspa:p…) and its redeem script (hex). */
export function generateMultisigAddressKAS(
  xpubWallet: string,
  xpubKey: string,
  typeIndex: number,
  addressIndex: number,
  chain: string,
): { address: string; redeemScript: string } {
  return kasSpendAddress(
    kasVaultSpend(xpubWallet, xpubKey, typeIndex, addressIndex, chain),
    chain,
  );
}

/**
 * Enterprise M-of-N vault at vaultIndex/addressIndex from the account xpubs
 * (m/48'/111111'/org'/0') of every key in the vault — exactly like
 * vaultAddressService.generateUtxoMultisigAddress: `dual` passes wallet AND
 * key xpub per signer with m = 2 × requiredSigners, `key_only` /
 * `wallet_only` one xpub per signer with m = requiredSigners.
 */
export function generateVaultMultisigAddressKAS(
  xpubs: string[],
  m: number,
  vaultIndex: number,
  addressIndex: number,
  chain: string,
): { address: string; redeemScript: string } {
  const keys = xpubs.map((x) =>
    kasLeafXOnly(x, vaultIndex, addressIndex, chain),
  );
  return kasSpendAddress(K.multisigSpend(keys, m), chain);
}

/** This device's signing key at a leaf: raw private key and x-only public key (hex). */
export function generateAddressKeypairKAS(
  xpriv: string,
  a: number,
  b: number,
  chain: string,
): { privKey: string; pubKey: string } {
  const node = HDKey.fromExtendedKey(xpriv, blockchains[chain].bip32)
    .deriveChild(a)
    .deriveChild(b);
  if (!node.privateKey) throw new Error('Kaspa private key derivation failed');
  const privKey = K.bytesToHex(node.privateKey);
  const pubKey = K.bytesToHex(K.xOnlyPublicKey(node.privateKey));
  node.wipePrivateData();
  return { privKey, pubKey };
}

export function isValidKasAddress(address: string, chain: string): boolean {
  try {
    K.addressToScriptPublicKey(address, kasPrefix(chain));
    return true;
  } catch {
    return false;
  }
}

export function kasScriptKey(spk: K.ScriptPublicKey): string {
  return `${String(spk.version)}:${K.bytesToHex(spk.script)}`;
}

// ---------------------------------------------------------------------------
// Network (REST only)
// ---------------------------------------------------------------------------

export function kasRestClient(
  chain: string,
  fetchImpl?: FetchLike,
): KaspaRestClient {
  return createRestClient({
    baseUrl: `https://${backends()[chain].node}`,
    prefix: kasPrefix(chain),
    // Pass fetch explicitly: the lockdown runtime may not expose it on the
    // global the library looks at.
    fetch: fetchImpl ?? ((url, init) => fetch(url, init)),
  });
}

/**
 * This device's own view of the UTXOs of `addresses`. The only amount
 * source a co-signing path may open a bundle with.
 */
export async function fetchKasUtxos(
  addresses: string[],
  chain: string,
  rest: KaspaRestClient = kasRestClient(chain),
): Promise<KaspaUtxo[]> {
  return rest.getUtxos(addresses);
}

// ---------------------------------------------------------------------------
// Bundles
// ---------------------------------------------------------------------------

/** Parse a relay payload into a SigningBundle (shape only; nothing is trusted). */
export function parseKasBundle(payload: string): KasSigningBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Kaspa payload is not a signing bundle');
  }
  const b = parsed as Partial<KasSigningBundle> | null;
  if (
    !b ||
    typeof b !== 'object' ||
    b.format !== KAS_BUNDLE_FORMAT ||
    b.version !== 1
  ) {
    throw new Error('Kaspa payload is not a signing bundle');
  }
  return b as KasSigningBundle;
}

/** True if `payload` looks like a kaspa-core signing bundle (routing only). */
export function isKasBundlePayload(payload: string): boolean {
  try {
    parseKasBundle(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a bundle against THIS device's own UTXO lookup. The library replaces
 * every claimed entry with the trusted one, refuses any input the lookup does
 * not contain, any amount or script disagreement, fee above 5 KAS, and
 * anything but a plain v0 / no-payload / no-lock-time transaction.
 */
export function openKasBundle(
  payload: string,
  trustedUtxos: readonly KaspaUtxo[],
): KasOpenedBundle {
  return K.openSigningBundle(parseKasBundle(payload), { trustedUtxos });
}

/** Transaction ID (hex) of a bundle's transaction; excludes signature scripts. */
export function kasBundleTxid(payload: string): string {
  const bundle = parseKasBundle(payload);
  return K.bytesToHex(K.transactionId(K.transactionFromJson(bundle.tx)));
}

/** Throw unless every partial already in an opened bundle is a valid signature. */
export function assertKasPartialsValid(opened: KasOpenedBundle): void {
  const ctx = new K.SighashContext(
    opened.tx,
    opened.inputs.map((p) => p.entry),
  );
  for (const p of opened.partials) {
    if (!K.verifyPartialSignature(opened.tx, opened.inputs, p, ctx)) {
      throw new Error(
        `Kaspa bundle carries an invalid signature for input ${String(p.inputIndex)}`,
      );
    }
  }
}

/** Describe an opened bundle from the point of view of `ownScripts`. */
export function describeKasOpened(
  opened: KasOpenedBundle,
  chain: string,
  ownScripts: readonly K.ScriptPublicKey[],
): K.TransactionDescription {
  return K.describeTransaction(opened.tx, opened.inputs, {
    prefix: kasPrefix(chain),
    ownScripts,
  });
}

/** Warnings that make a transaction undisplayable: fail closed on these. */
export const KAS_BLOCKING_WARNINGS: readonly K.DescribeWarning[] = [
  'nonstandard-output',
  'burn-output',
  'covenant-output',
  'foreign-input',
  'payload',
  'version-1',
  'non-native-subnetwork',
  'lock-time',
  'non-zero-sequence',
];

export function kasSompiToDecimal(sompi: bigint): string {
  return K.sompiToKaspa(sompi);
}

export { K as kaspaCore };
