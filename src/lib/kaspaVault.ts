// ============================================================
// Kaspa enterprise-vault (M-of-N) decode + co-sign.
//
// The payload's bundle (walletSignedHex, or rawUnsignedTx when no wallet
// signed first — KASPA_SSP_CONTRACT.md §3) is opened ONLY against this
// device's own UTXO lookup of the vault addresses being spent, described with
// kaspa-core, and compared with the relay-supplied recipients and fee. Any
// failure or disagreement fails closed: VaultSignRequest blocks approval and
// the signing path re-runs the same verification before touching a key.
// ============================================================

import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';
import type { VaultDecodedTx } from './transactions';
import {
  KAS_BLOCKING_WARNINGS,
  assertKasPartialsValid,
  describeKasOpened,
  fetchKasUtxos,
  generateAddressKeypairKAS,
  kasBundleTxid,
  kasPrefix,
  kasScriptKey,
  kaspaCore as K,
  openKasBundle,
  parseKasBundle,
  type KasOpenedBundle,
  type KaspaUtxo,
} from './kaspa';

export type KasUtxoFetcher = (addresses: string[]) => Promise<KaspaUtxo[]>;

/** Minimal shape of the relay vault-signing payload the kas path needs. */
export interface VaultKasSigningPayload {
  chain: string;
  rawUnsignedTx?: string;
  walletSignedHex?: string;
  inputDetails?: unknown;
  recipients?: Array<{ address: string; amount: string; label?: string }>;
  fee?: string;
}

export interface KasVaultInputDetail {
  index?: number;
  addressIndex: number;
  redeemScript?: string;
}

export interface KasVaultDecodeState {
  /** 'ok' is the ONLY state approval may proceed from. */
  status: 'ok' | 'failed';
  reasons: string[];
  warnings: string[];
}

export interface KasVaultVerified {
  payload: string;
  opened: KasOpenedBundle;
  description: K.TransactionDescription;
  details: KasVaultInputDetail[];
  /** Locking script of each input, in input order (verified). */
  inputScripts: K.ScriptPublicKey[];
  decoded: VaultDecodedTx;
  mismatches: string[];
}

/** The bundle this request asks the key to sign (contract §3). */
export function kasVaultBundlePayload(data: VaultKasSigningPayload): string {
  const signed =
    typeof data.walletSignedHex === 'string' && data.walletSignedHex
      ? data.walletSignedHex
      : '';
  const unsigned =
    typeof data.rawUnsignedTx === 'string' && data.rawUnsignedTx
      ? data.rawUnsignedTx
      : '';
  const payload = signed || unsigned;
  if (!payload) throw new Error('Kaspa vault request carries no bundle');
  if (signed && unsigned && kasBundleTxid(signed) !== kasBundleTxid(unsigned)) {
    // The transaction ID excludes signatures: two bundles of the SAME
    // proposal always agree. Anything else is a swapped transaction.
    throw new Error('Signed and unsigned Kaspa bundles differ');
  }
  return payload;
}

export function parseKasInputDetails(raw: unknown): KasVaultInputDetail[] {
  const list: unknown =
    typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('Kaspa vault request has no input details');
  }
  return list.map((d: unknown, i) => {
    const x = d as Partial<KasVaultInputDetail> | null;
    if (
      !x ||
      typeof x.addressIndex !== 'number' ||
      !Number.isInteger(x.addressIndex) ||
      x.addressIndex < 0 ||
      (x.index !== undefined && x.index !== i)
    ) {
      throw new Error(`Invalid Kaspa input detail ${String(i)}`);
    }
    return {
      index: i,
      addressIndex: x.addressIndex,
      redeemScript:
        typeof x.redeemScript === 'string'
          ? x.redeemScript.toLowerCase()
          : undefined,
    };
  });
}

function recipientKey(
  address: string,
  amount: bigint,
  prefix: K.NetworkPrefix,
): string {
  return `${kasScriptKey(K.addressToScriptPublicKey(address, prefix))}|${amount.toString()}`;
}

function parseAmount(v: unknown): bigint | null {
  return typeof v === 'string' && /^\d+$/.test(v) ? BigInt(v) : null;
}

/**
 * Open and describe a vault request's bundle against this device's own UTXO
 * lookup and compare it with what the relay claims. Throws when the bundle
 * cannot be opened at all; disagreements are returned in `mismatches`.
 */
export async function verifyKasVaultBundle(
  data: VaultKasSigningPayload,
  fetchUtxos?: KasUtxoFetcher,
): Promise<KasVaultVerified> {
  const chain = data.chain as keyof cryptos;
  if (blockchains[chain]?.chainType !== 'kas') {
    throw new Error('Not a Kaspa vault request');
  }
  const prefix = kasPrefix(chain);
  const payload = kasVaultBundlePayload(data);
  const details = parseKasInputDetails(data.inputDetails);
  const bundle = parseKasBundle(payload);
  if (
    !Array.isArray(bundle.inputs) ||
    bundle.inputs.length !== details.length
  ) {
    throw new Error('Kaspa input details do not match the transaction inputs');
  }
  // Addresses to look up: from the scripts the bundle CLAIMS it spends. Only
  // used to know where to look — the lookup is ours and openSigningBundle
  // verifies every claimed spend against the entry we fetched.
  const claimed = bundle.inputs.map((i) => K.inputPlanFromJson(i));
  const addresses = [
    ...new Set(
      claimed.map((p) => {
        const a = K.scriptPublicKeyToAddress(
          K.spendScriptPublicKey(p.spend),
          prefix,
        );
        if (!a) throw new Error('Kaspa input with a non-address script');
        return a;
      }),
    ),
  ];
  const trusted = fetchUtxos
    ? await fetchUtxos(addresses)
    : await fetchKasUtxos(addresses, chain);
  const opened = openKasBundle(payload, trusted);

  const inputScripts = opened.inputs.map((p, i) => {
    if (p.spend.kind !== 'p2sh-multisig') {
      throw new Error(`Kaspa input ${String(i)} is not a vault multisig`);
    }
    const detail = details[i];
    if (
      detail.redeemScript !== undefined &&
      detail.redeemScript !== K.bytesToHex(p.spend.redeem)
    ) {
      throw new Error(
        `Kaspa input ${String(i)} redeem script differs from input details`,
      );
    }
    return p.entry.scriptPublicKey;
  });
  const description = describeKasOpened(opened, chain, inputScripts);

  const mismatches: string[] = [];
  const blocking = description.warnings.filter((w) =>
    KAS_BLOCKING_WARNINGS.includes(w),
  );
  if (blocking.length > 0) {
    mismatches.push(`unsupported transaction: ${blocking.join(', ')}`);
  }
  const external = description.outputs.filter((o) => !o.isOwn);
  if (external.some((o) => !o.address)) {
    mismatches.push('output without a displayable address');
  }
  // Recipients: exact multiset of (script, amount) against the relay's list.
  const decodedKeys = external
    .filter((o) => o.address)
    .map((o) => recipientKey(o.address as string, o.value, prefix))
    .sort();
  let relayKeys: string[] = [];
  try {
    relayKeys = (Array.isArray(data.recipients) ? data.recipients : [])
      .map((r) => {
        const amount = parseAmount(r.amount);
        if (amount === null) throw new Error('bad amount');
        return recipientKey(r.address, amount, prefix);
      })
      .sort();
  } catch {
    mismatches.push('relay recipients are malformed');
  }
  if (
    relayKeys.length !== decodedKeys.length ||
    relayKeys.some((k, i) => k !== decodedKeys[i])
  ) {
    mismatches.push('recipients differ from the proposal');
  }
  const relayFee = parseAmount(data.fee);
  if (relayFee === null || relayFee !== description.fee) {
    mismatches.push(
      `fee ${description.fee.toString()} differs from the proposal (${String(data.fee)})`,
    );
  }

  const decoded: VaultDecodedTx = {
    sender: description.inputs[0]?.address ?? '',
    recipients: external.map((o) => ({
      address: o.address ?? '',
      amount: o.value.toString(),
    })),
    fee: description.fee.toString(),
  };
  return {
    payload,
    opened,
    description,
    details,
    inputScripts,
    decoded,
    mismatches,
  };
}

/**
 * Display decode for VaultSignRequest. NEVER throws: an unreadable bundle or
 * a failed lookup becomes a 'failed' state with decoded.error set.
 */
export async function decodeVaultKasTransaction(
  data: VaultKasSigningPayload,
  fetchUtxos?: KasUtxoFetcher,
): Promise<{ decoded: VaultDecodedTx; state: KasVaultDecodeState }> {
  try {
    const v = await verifyKasVaultBundle(data, fetchUtxos);
    return {
      decoded:
        v.mismatches.length > 0
          ? { ...v.decoded, error: v.mismatches.join('; ') }
          : v.decoded,
      state: {
        status: v.mismatches.length > 0 ? 'failed' : 'ok',
        reasons: v.mismatches,
        warnings: v.description.warnings,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to decode Kaspa vault transaction';
    return {
      decoded: { sender: '', recipients: [], fee: '0', error: message },
      state: { status: 'failed', reasons: [message], warnings: [] },
    };
  }
}

/** Shared helper for the socket and pull-to-refresh paths. NEVER throws. */
export async function applyVaultKasDecode(
  data: VaultKasSigningPayload,
  setDecodedVaultTx: (tx: VaultDecodedTx) => void,
  setKasDecodeState: (state: KasVaultDecodeState) => void,
  fetchUtxos?: KasUtxoFetcher,
): Promise<void> {
  const { decoded, state } = await decodeVaultKasTransaction(data, fetchUtxos);
  setDecodedVaultTx(decoded);
  setKasDecodeState(state);
}

/**
 * Co-sign a vault proposal (contract §5): re-verify from scratch, confirm
 * this key's leaf (m/48'/111111'/org'/0'/vaultIndex/addressIndex) belongs to
 * every input's script, sign only those scripts through the ledger and return
 * the merged bundle JSON for `enterprisevaultsigned`.
 */
export async function signKasVaultBundle(opts: {
  data: VaultKasSigningPayload;
  vaultXpriv: string;
  vaultIndex: number;
  ledger: K.SignedAmountLedger;
  fetchUtxos?: KasUtxoFetcher;
}): Promise<{ signedHex: string; keyPubKey: string; txid: string }> {
  const chain = opts.data.chain as keyof cryptos;
  const v = await verifyKasVaultBundle(opts.data, opts.fetchUtxos);
  if (v.mismatches.length > 0) {
    throw new Error(`Kaspa proposal mismatch: ${v.mismatches.join('; ')}`);
  }
  assertKasPartialsValid(v.opened);

  const signers = new Map<number, K.LocalSigner>();
  let keyPubKey = '';
  try {
    v.details.forEach((detail, i) => {
      let signer = signers.get(detail.addressIndex);
      if (!signer) {
        const kp = generateAddressKeypairKAS(
          opts.vaultXpriv,
          opts.vaultIndex,
          detail.addressIndex,
          chain,
        );
        const key = K.hexToBytes(kp.privKey);
        kp.privKey = '';
        signer = K.localSigner(key);
        key.fill(0);
        signers.set(detail.addressIndex, signer);
      }
      if (!keyPubKey) keyPubKey = K.bytesToHex(signer.xOnlyPublicKey);
      const own = signer.xOnlyPublicKey;
      if (
        !K.spendSigningKeys(v.opened.inputs[i].spend).some((k) =>
          K.equalBytes(k, own),
        )
      ) {
        throw new Error(
          `SSP Key is not a signer of Kaspa input ${String(i)} (vault ${String(opts.vaultIndex)}, address ${String(detail.addressIndex)})`,
        );
      }
    });
    const onlyScripts = [
      ...new Map(v.inputScripts.map((s) => [kasScriptKey(s), s])).values(),
    ];
    const keyPartials = await K.signTransaction(
      v.opened.tx,
      v.opened.inputs,
      [...signers.values()],
      { onlyScripts, signedAmounts: opts.ledger },
    );
    const signedInputs = new Set(keyPartials.map((p) => p.inputIndex));
    if (signedInputs.size !== v.opened.inputs.length) {
      throw new Error('SSP Key could not sign every Kaspa input');
    }
    const merged = K.mergePartialSignatures(keyPartials, v.opened.partials);
    const bundle = K.createSigningBundle(v.opened.tx, v.opened.inputs, merged);
    return {
      signedHex: JSON.stringify(bundle),
      keyPubKey,
      txid: v.description.id,
    };
  } finally {
    for (const s of signers.values()) s.destroy();
  }
}
