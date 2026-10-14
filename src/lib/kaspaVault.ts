// ============================================================
// Kaspa enterprise-vault (M-of-N) decode + co-sign.
//
// The payload's bundle (walletSignedHex, or rawUnsignedTx when no wallet
// signed first — KASPA_SSP_CONTRACT.md §3) is opened ONLY against this
// device's own UTXO lookup of the vault address being spent, described with
// kaspa-core, and compared with the relay-supplied recipients and fee. Any
// failure or disagreement fails closed: VaultSignRequest blocks approval and
// the signing path re-runs the same verification before touching a key.
//
// ONE VAULT SCRIPT PER PROPOSAL (contract §4.7). The key cannot know the
// vault's full key set, so the payload is never allowed to name several
// scripts: every inputDetails entry must carry the same addressIndex and
// redeemScript, that redeem script is the ONLY script looked up, every input
// must spend it, and it is the single entry of both `ownScripts` (describe)
// and `onlyScripts` (sign). Everything else is an external output that is
// shown and must match the relay's recipients. At sign time the script must
// also be a multisig containing this key's own leaf at
// org'/vaultIndex/addressIndex. (Otherwise an attacker who knows the xpubs
// builds a 1-of-2 {keyLeaf, attackerKey} script, mixes a UTXO of it into the
// proposal and hides a drain to it as "own" change.)
// ============================================================

import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';
import type { VaultDecodedTx } from './transactions';
import type { KasLedger } from './kaspaLedger';
import {
  KAS_BLOCKING_WARNINGS,
  KAS_MAX_FEE_SOMPI,
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
  signingMode?: string;
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
  /** The single vault address index every input spends. */
  addressIndex: number;
  /** The single vault spend (P2SH multisig) every input spends. */
  vaultSpend: Extract<K.Spend, { kind: 'p2sh-multisig' }>;
  /** Its locking script: the only own script and the only signable one. */
  vaultScript: K.ScriptPublicKey;
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
  maxFee: bigint = KAS_MAX_FEE_SOMPI,
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
  // §4.7: exactly one vault script, named identically by every detail.
  const addressIndex = details[0].addressIndex;
  const redeemHex = details[0].redeemScript;
  if (!redeemHex || !/^[0-9a-f]+$/.test(redeemHex)) {
    throw new Error('Kaspa input details carry no vault redeem script');
  }
  if (
    details.some(
      (d) => d.addressIndex !== addressIndex || d.redeemScript !== redeemHex,
    )
  ) {
    throw new Error(
      'Kaspa proposal spends more than one vault script (one vault address per proposal)',
    );
  }
  const redeem = K.hexToBytes(redeemHex);
  const parsed = K.parseMultisigRedeemScript(redeem);
  if (!parsed || parsed.ecdsa) {
    throw new Error('Kaspa vault redeem script is not a Schnorr multisig');
  }
  // Threshold sanity against the signing mode: a dual vault holds a wallet
  // AND a key per signer, m = 2 × requiredSigners.
  if (
    data.signingMode === 'dual' &&
    (parsed.m % 2 !== 0 || parsed.pubkeys.length % 2 !== 0)
  ) {
    throw new Error('Kaspa vault script does not fit a dual-signing vault');
  }
  const vaultSpend = {
    kind: 'p2sh-multisig' as const,
    redeem,
    pubkeys: parsed.pubkeys,
    m: parsed.m,
  };
  const vaultScript = K.spendScriptPublicKey(vaultSpend);
  const vaultAddress = K.scriptPublicKeyToAddress(vaultScript, prefix);
  if (!vaultAddress) throw new Error('Kaspa vault address encoding failed');
  // Our own lookup of THAT address only — never of addresses the bundle
  // claims. Any input of another script is then absent from the lookup and
  // openSigningBundle refuses it.
  const trusted = fetchUtxos
    ? await fetchUtxos([vaultAddress])
    : await fetchKasUtxos([vaultAddress], chain);
  const opened = openKasBundle(payload, trusted, maxFee);
  const vaultKey = kasScriptKey(vaultScript);
  opened.inputs.forEach((p, i) => {
    if (
      p.spend.kind !== 'p2sh-multisig' ||
      !K.equalBytes(p.spend.redeem, redeem) ||
      kasScriptKey(p.entry.scriptPublicKey) !== vaultKey
    ) {
      throw new Error(
        `Kaspa input ${String(i)} does not spend the proposal's vault script`,
      );
    }
  });
  const description = describeKasOpened(opened, chain, [vaultScript]);

  const mismatches: string[] = [];
  const blocking = description.warnings.filter((w) =>
    KAS_BLOCKING_WARNINGS.includes(w),
  );
  if (blocking.length > 0) {
    mismatches.push(`unsupported transaction: ${blocking.join(', ')}`);
  }
  const external = description.outputs.filter((o) => !o.isOwn);
  // Outputs to the vault itself (change, or a consolidation's only output).
  const ownKeys = description.outputs
    .filter((o) => o.isOwn)
    .map((o) => recipientKey(vaultAddress, o.value, prefix));
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
      // A recipient that IS the vault (a consolidation) pays our own script:
      // it must match a distinct own output and is not an external payment.
      .filter((k) => {
        const i = ownKeys.indexOf(k);
        if (i < 0) return true;
        ownKeys.splice(i, 1);
        return false;
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
    sender: vaultAddress,
    // A pure consolidation has no external output: show the vault itself.
    recipients: (external.length > 0
      ? external
      : description.outputs.filter((o) => o.isOwn)
    ).map((o) => ({
      address: o.isOwn ? vaultAddress : (o.address ?? ''),
      amount: o.value.toString(),
    })),
    fee: description.fee.toString(),
  };
  return {
    payload,
    opened,
    description,
    details,
    addressIndex,
    vaultSpend,
    vaultScript,
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
 * Co-sign a vault proposal (contract §5, §4.7): re-verify from scratch
 * (single vault script, own lookup, relay recipients + fee, no blocking
 * warning, fee ≤ maxFee), confirm this key's leaf
 * m/48'/111111'/org'/0'/vaultIndex/addressIndex is one of the vault script's
 * keys, sign ONLY that script through the ledger, flush the ledger and return
 * the merged bundle JSON for `enterprisevaultsigned`.
 */
export async function signKasVaultBundle(opts: {
  data: VaultKasSigningPayload;
  vaultXpriv: string;
  vaultIndex: number;
  ledger: KasLedger;
  maxFee?: bigint;
  fetchUtxos?: KasUtxoFetcher;
}): Promise<{ signedHex: string; keyPubKey: string; txid: string }> {
  const chain = opts.data.chain as keyof cryptos;
  const maxFee = opts.maxFee ?? KAS_MAX_FEE_SOMPI;
  const v = await verifyKasVaultBundle(opts.data, opts.fetchUtxos, maxFee);
  if (v.mismatches.length > 0) {
    throw new Error(`Kaspa proposal mismatch: ${v.mismatches.join('; ')}`);
  }
  assertKasPartialsValid(v.opened);

  const kp = generateAddressKeypairKAS(
    opts.vaultXpriv,
    opts.vaultIndex,
    v.addressIndex,
    chain,
  );
  const key = K.hexToBytes(kp.privKey);
  kp.privKey = '';
  const signer = K.localSigner(key);
  key.fill(0);
  try {
    const own = signer.xOnlyPublicKey;
    if (!v.vaultSpend.pubkeys.some((k) => K.equalBytes(k, own))) {
      throw new Error(
        `SSP Key is not a signer of this Kaspa vault (vault ${String(opts.vaultIndex)}, address ${String(v.addressIndex)})`,
      );
    }
    const keyPartials = await K.signTransaction(
      v.opened.tx,
      v.opened.inputs,
      [signer],
      { onlyScripts: [v.vaultScript], signedAmounts: opts.ledger, maxFee },
    );
    const signedInputs = new Set(keyPartials.map((p) => p.inputIndex));
    if (signedInputs.size !== v.opened.inputs.length) {
      throw new Error('SSP Key could not sign every Kaspa input');
    }
    // Persist the ledger BEFORE the signatures can leave this device.
    opts.ledger.flush();
    const merged = K.mergePartialSignatures(keyPartials, v.opened.partials);
    const bundle = K.createSigningBundle(v.opened.tx, v.opened.inputs, merged);
    return {
      signedHex: JSON.stringify(bundle),
      keyPubKey: K.bytesToHex(own),
      txid: v.description.id,
    };
  } finally {
    signer.destroy();
  }
}
