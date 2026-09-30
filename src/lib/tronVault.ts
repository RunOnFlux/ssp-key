// ============================================================
// TRON enterprise-vault (M-of-N) verify + co-sign (TRON_SSP_CONTRACT.md §3,
// §5, §6 "Enterprise proposal").
//
// The relay request carries `rawUnsignedTx` = the Op digest (0x…32 bytes)
// and `tronOp` = {network, vault, signers, threshold, op}. SSP Key:
//  - recomputes the digest from the structured Op and requires it to equal
//    rawUnsignedTx (never signs an opaque hash — the `userOpHashMatches`
//    pattern);
//  - requires vault == predict(configHash(signers, threshold)) on the pinned
//    network, and (at sign time) its OWN leaf
//    m/48'/195'/org'/0'/vaultIndex/addressIndex to be one of the signers;
//  - decodes the Op under the ENTERPRISE policy: approve / unknown calls /
//    Stake 2.0 vault self-calls only when the request's org policy flags
//    explicitly allow them (absent = refused; the on-chain nonce
//    invalidation is allowed unless explicitly off), fee to the pinned
//    collector in TRX or USDT under the ceiling (or 0), deadline ≤ 30 days;
//  - only for an enterprise account (orgIndex 100…99999): never the consumer
//    account 0' or the reserved 99', whose leaves must not co-sign here;
//  - signs the digest with its leaf and returns a 65-byte signature, and
//    ONLY when that digest is the one the approval screen displayed (a
//    request swapped in while the user was approving is refused).
// Display and signing run the SAME verification; the UI fails closed on a
// pending or failed verdict and the signing path re-verifies from scratch.
// ============================================================

import { HDKey } from '@scure/bip32';
import { blockchains } from '@storage/blockchains';
import type { VaultDecodedTx } from './transactions';
import {
  TRON_ENTERPRISE_MAX_DEADLINE_SECONDS,
  TronNotLiveError,
  TronVerifyError,
  requireTronLive,
  tronDisplayTokens,
  tronEnterpriseFeeCeilings,
  tronErrorReason,
  tronNetwork,
  tronNetworkMatches,
  tronNowSeconds,
  tronOpView,
  tronSdk as T,
  type TronNetworkConfig,
  type TronOpView,
} from './tron';

/** Minimal shape of the relay vault-signing payload the TRON path needs. */
export interface VaultTronSigningPayload {
  chain: string;
  /** The org account m/48'/195'/orgIndex'/0' the vault keys live under. */
  orgIndex?: unknown;
  rawUnsignedTx?: string;
  tronOp?: unknown;
  tronPolicy?: unknown;
  sourceAddress?: string;
  inputDetails?: unknown;
  /** Message signing (WalletConnect) — never valid for TRON (contract §7). */
  signMessage?: unknown;
}

/** Enterprise organisation indices (BIP-48 account', CLAUDE.md conventions). */
export const TRON_ENTERPRISE_ORG_INDEX_MIN = 100;
export const TRON_ENTERPRISE_ORG_INDEX_MAX = 99999;

export interface TronOpEnvelope {
  network: string;
  vault: string;
  signers: string[];
  threshold: number;
  op: ReturnType<typeof T.opFromJson>;
}

export interface TronPolicyFlags {
  allowApprove: boolean;
  allowUnknown: boolean;
  /** Vault self-calls at all (the on-chain nonce invalidation). */
  allowSelfCalls: boolean;
  /** Stake 2.0 self-calls (freeze, delegate, vote, …): explicit opt-in only. */
  allowStakingSelfCalls: boolean;
}

export interface TronVaultDecodeState {
  /** 'ok' is the ONLY state approval may proceed from. */
  status: 'ok' | 'failed';
  reasons: string[];
  view?: TronOpView;
  /**
   * 'ok' only: the Op digest (0x…) the approval screen displays. Approval
   * hands it back and signing refuses any other digest.
   */
  digest?: string;
}

export interface TronVaultVerified {
  network: TronNetworkConfig;
  envelope: TronOpEnvelope;
  config: ReturnType<typeof T.validateConfig>;
  vault: ReturnType<typeof T.deriveVault>;
  digest: Uint8Array;
  view: TronOpView;
  addressIndex: number;
}

const ENVELOPE_KEYS = ['network', 'vault', 'signers', 'threshold', 'op'];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Strict parse of the proposal's `tronOp` (JSON string or object). */
export function parseTronOpEnvelope(raw: unknown): TronOpEnvelope {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new TronVerifyError('bad_payload', 'tronOp is not JSON');
    }
  }
  if (!isPlainObject(obj)) {
    throw new TronVerifyError('bad_payload', 'TRON proposal carries no tronOp');
  }
  const extra = Object.keys(obj).filter((k) => !ENVELOPE_KEYS.includes(k));
  if (extra.length > 0) {
    throw new TronVerifyError(
      'bad_payload',
      `Unexpected tronOp field(s): ${extra.join(', ')}`,
    );
  }
  const { network, vault, signers, threshold } = obj;
  if (typeof network !== 'string' || !T.isValidAddress(vault)) {
    throw new TronVerifyError('bad_payload', 'Invalid tronOp network or vault');
  }
  if (
    !Array.isArray(signers) ||
    signers.length === 0 ||
    signers.length > T.MAX_SIGNERS ||
    !signers.every((s) => T.isValidAddress(s))
  ) {
    throw new TronVerifyError('bad_payload', 'Invalid tronOp signers');
  }
  if (typeof threshold !== 'number' || !Number.isInteger(threshold)) {
    throw new TronVerifyError('bad_payload', 'Invalid tronOp threshold');
  }
  let op: TronOpEnvelope['op'];
  try {
    op = T.opFromJson(obj.op);
  } catch (error) {
    throw new TronVerifyError(
      'bad_payload',
      `Invalid TRON operation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { network, vault, signers, threshold, op };
}

/**
 * The org policy flags carried by the request. `approve` and unknown contract
 * calls need an explicit boolean `true`; anything absent or malformed is
 * `false`. Of the vault self-calls, only the nonce invalidation (it can only
 * burn nonces — the on-chain cancel of a fully signed proposal) is allowed
 * unless the request explicitly says `allowSelfCalls: false`. The Stake 2.0
 * self-calls (freeze / unfreeze TRX, delegate resources to another account,
 * vote) change what the vault's TRX can do, so like approve they need an
 * explicit `allowSelfCalls: true` (contract §5.3).
 */
export function tronPolicyFlags(raw: unknown): TronPolicyFlags {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  const p = isPlainObject(obj) ? obj : {};
  return {
    allowApprove: p.allowApprove === true,
    allowUnknown: p.allowUnknown === true,
    allowSelfCalls: p.allowSelfCalls !== false,
    allowStakingSelfCalls: p.allowSelfCalls === true,
  };
}

/** Normalised 0x-lowercase form of a 32-byte hex digest, or null. */
function normalizeDigestHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const hex = v.startsWith('0x') || v.startsWith('0X') ? v.slice(2) : v;
  return /^[0-9a-fA-F]{64}$/.test(hex) ? `0x${hex.toLowerCase()}` : null;
}

/** addressIndex of the proposal's source address (inputDetails[0]). */
export function tronVaultAddressIndex(inputDetails: unknown): number {
  let list: unknown = inputDetails;
  if (typeof inputDetails === 'string') {
    try {
      list = JSON.parse(inputDetails);
    } catch {
      list = [];
    }
  }
  const first = Array.isArray(list) ? (list[0] as unknown) : undefined;
  if (first === undefined || first === null) return 0;
  const idx = isPlainObject(first) ? first.addressIndex : undefined;
  if (idx === undefined) return 0;
  if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0) {
    throw new TronVerifyError('bad_payload', 'Invalid TRON address index');
  }
  return idx;
}

/**
 * Everything but the own-leaf check (which needs the vault xpriv and runs at
 * sign time). Throws on any disagreement.
 */
export function verifyTronVaultRequest(
  data: VaultTronSigningPayload,
  network: TronNetworkConfig,
  now: bigint,
  /** USD per TRX from the relay (0 = unknown: the 300 TRX cap alone). */
  trxUsdRate = 0,
): TronVaultVerified {
  const { orgIndex } = data;
  if (
    typeof orgIndex !== 'number' ||
    !Number.isInteger(orgIndex) ||
    orgIndex < TRON_ENTERPRISE_ORG_INDEX_MIN ||
    orgIndex > TRON_ENTERPRISE_ORG_INDEX_MAX
  ) {
    // 0' is the consumer account (its leaves are consumer vault signers) and
    // 99' is reserved: an enterprise request never signs with either.
    throw new TronVerifyError(
      'bad_payload',
      `Invalid TRON organisation index ${String(orgIndex)}`,
    );
  }
  if (data.signMessage) {
    // The screen would show a "message" beside the Op; TRON message signing
    // is out of scope (contract §7), so the combination is refused outright.
    throw new TronVerifyError(
      'bad_payload',
      'TRON message signing is not supported',
    );
  }
  requireTronLive(network);
  const envelope = parseTronOpEnvelope(data.tronOp);
  if (!tronNetworkMatches(envelope.network, network)) {
    throw new TronVerifyError(
      'wrong_network',
      `TRON proposal is for ${envelope.network}, not ${network.name}`,
    );
  }
  // Rule 1: the stated vault must be the one (signers, threshold) derive to.
  let config: TronVaultVerified['config'];
  try {
    config = T.validateConfig({
      signers: envelope.signers,
      threshold: envelope.threshold,
    });
  } catch (error) {
    throw new TronVerifyError(
      'wrong_vault',
      `Invalid TRON vault configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const vault = T.deriveVault(network, config);
  if (vault.address !== envelope.vault) {
    throw new TronVerifyError(
      'wrong_vault',
      'TRON proposal vault does not match its signers and threshold',
    );
  }
  if (
    typeof data.sourceAddress === 'string' &&
    data.sourceAddress !== '' &&
    data.sourceAddress !== vault.address
  ) {
    throw new TronVerifyError(
      'wrong_vault',
      'TRON proposal source address is not its vault',
    );
  }
  // Rule 2: never sign an opaque hash.
  const digest = T.opDigest(network.chainId, vault.address, envelope.op);
  const claimed = normalizeDigestHex(data.rawUnsignedTx);
  if (claimed === null || claimed !== T.to0x(digest)) {
    throw new TronVerifyError(
      'digest_mismatch',
      'TRON proposal digest does not match its operation',
    );
  }
  // Rules 3–5 under the enterprise policy and the org's explicit flags.
  const flags = tronPolicyFlags(data.tronPolicy);
  const display = T.decodeOpForDisplay(envelope.op, {
    policy: 'enterprise',
    vault: vault.address,
    now,
    maxDeadlineSeconds: TRON_ENTERPRISE_MAX_DEADLINE_SECONDS,
    feeCollector: network.feeCollector,
    feeCeilings: tronEnterpriseFeeCeilings(network, trxUsdRate),
    tokens: tronDisplayTokens(data.chain, network),
    allowApprove: flags.allowApprove,
    allowUnknown: flags.allowUnknown,
    allowSelfCalls: flags.allowSelfCalls,
  });
  if (!flags.allowStakingSelfCalls) {
    const staking = display.calls.find(
      (c) => c.kind === 'selfCall' && c.action !== 'invalidateNonces',
    );
    if (staking && staking.kind === 'selfCall') {
      throw new T.PolicyError(
        'CALL_KIND_NOT_ALLOWED',
        `call ${staking.index} (${staking.action}) needs the org policy to allow vault self-calls`,
        staking.index,
      );
    }
  }
  return {
    network,
    envelope,
    config,
    vault,
    digest,
    view: tronOpView(display, data.chain),
    addressIndex: tronVaultAddressIndex(data.inputDetails),
  };
}

/** Readable reason lines for a refused TRON proposal. */
function reasonsFor(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return [message, tronErrorReason(error)];
}

/**
 * Display-time verdict for VaultSignRequest. Never throws: any failure is a
 * 'failed' state (approval blocked), and the generic decodedTx carries the
 * vault as the sender plus an `error` on failure.
 */
export function decodeTronVaultRequest(
  data: VaultTronSigningPayload,
  network?: TronNetworkConfig,
  now: bigint = tronNowSeconds(),
  trxUsdRate = 0,
): { state: TronVaultDecodeState; decoded: VaultDecodedTx } {
  try {
    const verified = verifyTronVaultRequest(
      data,
      network ?? tronNetwork(data.chain),
      now,
      trxUsdRate,
    );
    return {
      state: {
        status: 'ok',
        reasons: [],
        view: verified.view,
        digest: T.to0x(verified.digest),
      },
      decoded: { sender: verified.vault.address, recipients: [], fee: '0' },
    };
  } catch (error) {
    return {
      state: {
        status: 'failed',
        reasons:
          error instanceof TronNotLiveError
            ? [error.message]
            : reasonsFor(error),
      },
      decoded: {
        sender: '',
        recipients: [],
        fee: '0',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Apply the verdict through the (seq-guarded) setters. Async only for the
 * TRX/USD rate behind the enterprise fee cap (never throws: a failed rate
 * lookup is 0, i.e. the 300 TRX cap alone); the verdict stays null — approval
 * blocked — until it resolves.
 */
export async function applyVaultTronDecode(
  data: VaultTronSigningPayload,
  setDecodedTx: (tx: VaultDecodedTx) => void,
  setState: (state: TronVaultDecodeState) => void,
  getRate: (chain: string) => Promise<number>,
  network?: TronNetworkConfig,
): Promise<void> {
  let rate = 0;
  try {
    rate = await getRate(data.chain);
  } catch {
    rate = 0;
  }
  const { state, decoded } = decodeTronVaultRequest(
    data,
    network,
    tronNowSeconds(),
    rate,
  );
  setDecodedTx(decoded);
  setState(state);
}

/**
 * Co-sign a TRON enterprise proposal: re-verify from scratch, require the
 * recomputed digest to be the one the approval screen displayed
 * (`approvedDigest`), require this key's leaf
 * m/48'/195'/org'/0'/vaultIndex/addressIndex (from `vaultXpriv` = the org
 * account xpriv) to be a signer, sign the recomputed digest.
 *
 * `wallet_only` vaults have no key leaves: the proposal is still verified,
 * but nothing is signed (`keySignature: null`) — SSP Wallet expects a reply
 * without a key signature in that mode.
 */
export function signTronVaultRequest(opts: {
  data: VaultTronSigningPayload;
  vaultXpriv: string;
  vaultIndex: number;
  signingMode?: string;
  network?: TronNetworkConfig;
  now?: bigint;
  /** USD per TRX from the relay (0 = unknown: the 300 TRX cap alone). */
  trxUsdRate?: number;
  /**
   * The digest (0x…) of the proposal the approval screen displayed when the
   * user approved. Anything else — e.g. a request the relay swapped in while
   * Authentication was open — is refused.
   */
  approvedDigest: string;
}): { keySignature: string | null; keyPubKey: string } {
  if (!Number.isInteger(opts.vaultIndex) || opts.vaultIndex < 0) {
    throw new TronVerifyError('bad_payload', 'Invalid TRON vault index');
  }
  const verified = verifyTronVaultRequest(
    opts.data,
    opts.network ?? tronNetwork(opts.data.chain),
    opts.now ?? tronNowSeconds(),
    opts.trxUsdRate ?? 0,
  );
  if (normalizeDigestHex(opts.approvedDigest) !== T.to0x(verified.digest)) {
    throw new TronVerifyError(
      'digest_mismatch',
      'TRON proposal changed since it was displayed; review it again',
    );
  }
  const node = HDKey.fromExtendedKey(
    opts.vaultXpriv,
    blockchains[opts.data.chain].bip32,
  )
    .deriveChild(opts.vaultIndex)
    .deriveChild(verified.addressIndex);
  if (!node.privateKey || !node.publicKey) {
    throw new Error('TRON private key derivation failed');
  }
  const keyPubKey = T.bytesToHex(node.publicKey);
  if (opts.signingMode === 'wallet_only') {
    node.wipePrivateData();
    return { keySignature: null, keyPubKey };
  }
  const signer = T.localSigner(node.privateKey);
  node.wipePrivateData();
  try {
    if (!verified.config.signers.includes(signer.address)) {
      throw new TronVerifyError(
        'not_a_signer',
        'This SSP Key is not a signer of this TRON vault',
      );
    }
    const signature = signer.signDigest(verified.digest);
    return { keySignature: T.to0x(signature), keyPubKey };
  } finally {
    signer.destroy();
  }
}
