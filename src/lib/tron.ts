/**
 * TRON (chainType 'tron') on @runonflux/tron-multisig.
 *
 * A TRON vault is an SSPVault contract clone whose address is fixed by its
 * sorted signer addresses + threshold (+ the network's factory and
 * implementation). SSP Key derives its own leaf at m/48'/195'/{acct}'/0'/a/b;
 * a signer is the TRON address of a leaf key. EVERY piece of vault math
 * (addresses, config hash, vault address, TIP-712 digest, signatures, Op JSON,
 * display decoding, protobuf) comes from the SDK — never re-implemented here.
 *
 * SSP Key is the security boundary (TRON_SSP_CONTRACT.md §5). It co-signs
 * only what it verified and displayed itself:
 *  1. derive, never trust — the vault's signers / threshold / address are
 *     re-derived from THIS device's leaf and the wallet xpub stored at pairing
 *     (consumer), or own-leaf ∈ signers and vault == predict(config)
 *     (enterprise); any disagreement refuses;
 *  2. never sign an opaque hash — the digest is recomputed from the
 *     structured Op on this device;
 *  3. show what you sign — decodeOpForDisplay with the right policy, and the
 *     signing path signs only if its own re-verification yields the digest
 *     the approval screen displayed;
 *  4. fees go to the pinned collector (or are 0 = self-pay), in TRX or the
 *     network's USDT, under the ceilings;
 *  5. deadlines are live and inside the policy window.
 * Every failure throws; callers fail CLOSED.
 *
 * `network` is always passed explicitly (resolved once with tronNetwork()),
 * so tests can pin the vector network; production code only ever resolves
 * the SDK's pinned table by chain.
 */
import * as T from '@runonflux/tron-multisig';
import { TronHttpClient, type FetchLike } from '@runonflux/tron-multisig/rpc';
import { HDKey } from '@scure/bip32';
import { blockchains } from '@storage/blockchains';
import { backends } from '@storage/backends';
import { storage } from '../store/index';

export { T as tronSdk, TronHttpClient };
export type TronNetworkConfig = T.NetworkConfig;
export type TronOp = T.Op;
export type TronVaultConfig = T.VaultConfig;
export type TronVaultInfo = T.VaultInfo;
export type TronOpDisplay = T.OpDisplay;
export type TronLocalSigner = T.LocalSigner;

/** Consumer `tx` payload format (contract §3). */
export const TRON_OP_FORMAT = 'ssp-tron-op';
export const TRON_OP_VERSION = 1;

/** Consumer fee ceilings (contract §5.4): 30 TRX (sun) or 8 USDT (base units). */
export const TRON_FEE_CEILING_TRX_SUN = 30000000n;
export const TRON_FEE_CEILING_USDT = 8000000n;
/** Consumer deadline window (contract §5.5): at most now + 2 h. */
export const TRON_CONSUMER_MAX_DEADLINE_SECONDS = 7200n;
/**
 * Enterprise: at most the proposal expiry, which the backend caps at 30 days
 * from creation; +1 h absorbs clock skew between it and this device (the
 * same window SSP Wallet applies).
 */
export const TRON_ENTERPRISE_MAX_DEADLINE_SECONDS = 2595600n;
/**
 * Enterprise fee sanity cap on this device (the org policy lives on the
 * backend, contract §5.4): min($100 of TRX at the relay rate, 300 TRX) and
 * $100 of USDT — the same cap SSP Wallet applies. A missing or lying rate can
 * only LOWER the TRX cap below 300 TRX, never raise it.
 */
export const TRON_ENTERPRISE_FEE_CAP_TRX_SUN = 300000000n;
export const TRON_ENTERPRISE_MAX_FEE_USD = 100;
/**
 * Self-pay: `fee_limit` of every transaction this device submits (150 TRX).
 * The node burns at most this much; it is a cap, not a charge.
 */
export const TRON_SELF_PAY_FEE_LIMIT_SUN = 150000000n;
/**
 * Self-pay: the key's own TRON account must hold at least this much before
 * approval — a first send deploys the vault (~50k energy) and a USDT send to
 * a new holder costs ~150k energy more, at 100 sun per energy, plus
 * bandwidth.
 */
export const TRON_SELF_PAY_MIN_BALANCE_SUN = 25000000n;
/** TRX has 6 decimals on every TRON network — never the `?? 8` fallback. */
export const TRX_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Chains and networks
// ---------------------------------------------------------------------------

export function isTronChain(chain: string): boolean {
  return blockchains[chain]?.chainType === 'tron';
}

/** The SDK network name of a TRON chain ('mainnet' | 'nile'). */
export function tronNetworkName(chain: string): T.NetworkName {
  const name = blockchains[chain]?.tronNetwork;
  if (!isTronChain(chain) || (name !== 'mainnet' && name !== 'nile')) {
    throw new Error(`${chain} is not a TRON chain`);
  }
  return name;
}

/** The SDK's pinned network of a TRON chain (fail closed on anything else). */
export function tronNetwork(chain: string): T.NetworkConfig {
  return T.getNetwork(tronNetworkName(chain));
}

/**
 * TRON vaults are usable only once the SDK pins every deployment address:
 * factory + implementation (vault addresses), sponsor and fee collector
 * (sponsored sends). Until then every TRON request is refused.
 */
export function isTronLive(network: T.NetworkConfig): boolean {
  return (
    network.factory !== null &&
    network.implementation !== null &&
    network.sponsor !== null &&
    network.feeCollector !== null
  );
}

export function isTronChainLive(chain: string): boolean {
  try {
    return isTronLive(tronNetwork(chain));
  } catch {
    return false;
  }
}

/** TRON vault contracts are not deployed / pinned yet for this network. */
export class TronNotLiveError extends Error {
  constructor(network: string) {
    super(`TRON vaults are not live yet on ${network}`);
    this.name = 'TronNotLiveError';
  }
}

export function requireTronLive(network: T.NetworkConfig): void {
  if (!isTronLive(network)) {
    throw new TronNotLiveError(network.name);
  }
}

export type TronVerifyReason =
  | 'not_tron_payload'
  | 'bad_payload'
  | 'bad_path'
  | 'wrong_network'
  | 'wrong_vault'
  | 'digest_mismatch'
  | 'bad_wallet_signature'
  | 'not_a_signer'
  | 'bad_policy';

/** A request this device refuses to display or sign, with a stable reason. */
export class TronVerifyError extends Error {
  readonly reason: TronVerifyReason;
  constructor(reason: TronVerifyReason, message: string) {
    super(message);
    this.name = 'TronVerifyError';
    this.reason = reason;
  }
}

/** The fee tokens and ceilings a TRON Op may pay (contract §5.4). */
export function tronFeeCeilings(network: T.NetworkConfig): T.FeeCeiling[] {
  const ceilings: T.FeeCeiling[] = [
    { token: T.TRX_FEE_TOKEN, max: TRON_FEE_CEILING_TRX_SUN },
  ];
  if (network.usdt) {
    ceilings.push({ token: network.usdt, max: TRON_FEE_CEILING_USDT });
  }
  return ceilings;
}

/** Enterprise fee tokens and caps (see TRON_ENTERPRISE_FEE_CAP_TRX_SUN). */
export function tronEnterpriseFeeCeilings(
  network: T.NetworkConfig,
  trxUsdRate: number,
): T.FeeCeiling[] {
  let trxMax = TRON_ENTERPRISE_FEE_CAP_TRX_SUN;
  if (Number.isFinite(trxUsdRate) && trxUsdRate > 0) {
    const sun = Math.floor((TRON_ENTERPRISE_MAX_FEE_USD / trxUsdRate) * 1e6);
    if (Number.isSafeInteger(sun) && sun >= 0 && BigInt(sun) < trxMax) {
      trxMax = BigInt(sun);
    }
  }
  const ceilings: T.FeeCeiling[] = [{ token: T.TRX_FEE_TOKEN, max: trxMax }];
  if (network.usdt) {
    ceilings.push({
      token: network.usdt,
      max: BigInt(TRON_ENTERPRISE_MAX_FEE_USD) * 1000000n,
    });
  }
  return ceilings;
}

/**
 * Known TRC-20 tokens for display: the chain's whitelist plus the network's
 * USDT (from the SDK table). Anything else shows as an unknown token.
 */
export function tronDisplayTokens(
  chain: string,
  network: T.NetworkConfig,
): T.TokenInfo[] {
  const out: T.TokenInfo[] = [];
  const seen = new Set<string>();
  const add = (address: string, symbol: string, decimals: number) => {
    if (!T.isValidAddress(address) || seen.has(address)) return;
    seen.add(address);
    out.push({ address, symbol, decimals });
  };
  if (network.usdt) add(network.usdt, 'USDT', 6);
  for (const tk of blockchains[chain]?.tokens ?? []) {
    if (tk.contract) add(tk.contract, tk.symbol, tk.decimals);
  }
  return out;
}

/**
 * The payload's `network` is exactly the SDK network name of the chain the
 * request arrived on ('mainnet' for tron, 'nile' for tronNile), as SSP
 * Wallet, the relay and the enterprise backend all write it.
 */
export function tronNetworkMatches(
  claimed: unknown,
  network: T.NetworkConfig,
): boolean {
  return typeof claimed === 'string' && claimed === network.name;
}

// ---------------------------------------------------------------------------
// Keys, signers and vaults
// ---------------------------------------------------------------------------

/** 33-byte compressed public key of an account xpub at leaf a/b. */
export function tronLeafPublicKey(
  xpub: string,
  a: number,
  b: number,
  chain: string,
): Uint8Array {
  const node = HDKey.fromExtendedKey(xpub, blockchains[chain].bip32)
    .deriveChild(a)
    .deriveChild(b);
  if (!node.publicKey) throw new Error('TRON key derivation failed');
  return node.publicKey;
}

/** TRON address (signer) of an account xpub's leaf a/b. */
export function tronLeafAddress(
  xpub: string,
  a: number,
  b: number,
  chain: string,
): string {
  return T.addressFromPublicKey(tronLeafPublicKey(xpub, a, b, chain));
}

export interface TronConsumerVault {
  config: T.VaultConfig;
  vault: T.VaultInfo;
  walletSigner: string;
  keySigner: string;
}

/** The consumer 2-of-2 vault {wallet leaf, key leaf} at a/b. */
export function tronConsumerVault(
  xpubWallet: string,
  xpubKey: string,
  typeIndex: number,
  addressIndex: number,
  chain: string,
  network: T.NetworkConfig,
): TronConsumerVault {
  if (network.factory === null || network.implementation === null) {
    throw new TronNotLiveError(network.name);
  }
  const walletPub = tronLeafPublicKey(
    xpubWallet,
    typeIndex,
    addressIndex,
    chain,
  );
  const keyPub = tronLeafPublicKey(xpubKey, typeIndex, addressIndex, chain);
  const config = T.buildConsumerConfig(walletPub, keyPub);
  return {
    config,
    vault: T.deriveVault(network, config),
    walletSigner: T.addressFromPublicKey(walletPub),
    keySigner: T.addressFromPublicKey(keyPub),
  };
}

/** Consumer vault address (no script: TRON vaults are contracts). */
export function generateMultisigAddressTRON(
  xpubWallet: string,
  xpubKey: string,
  typeIndex: number,
  addressIndex: number,
  chain: string,
  network: T.NetworkConfig = tronNetwork(chain),
): { address: string } {
  return {
    address: tronConsumerVault(
      xpubWallet,
      xpubKey,
      typeIndex,
      addressIndex,
      chain,
      network,
    ).vault.address,
  };
}

/** This device's leaf key: raw 32-byte private key and compressed public key (hex). */
export function generateAddressKeypairTRON(
  xpriv: string,
  a: number,
  b: number,
  chain: string,
): { privKey: string; pubKey: string } {
  const node = HDKey.fromExtendedKey(xpriv, blockchains[chain].bip32)
    .deriveChild(a)
    .deriveChild(b);
  if (!node.privateKey || !node.publicKey) {
    throw new Error('TRON private key derivation failed');
  }
  const privKey = T.bytesToHex(node.privateKey);
  const pubKey = T.bytesToHex(node.publicKey);
  node.wipePrivateData();
  return { privKey, pubKey };
}

/**
 * A TRON signer over a hex private key. The caller MUST destroy() it. The
 * intermediate key bytes are wiped (the signer keeps its own copy).
 */
export function tronSignerFromPrivHex(privKeyHex: string): T.LocalSigner {
  const key = T.hexToBytes(privKeyHex);
  try {
    return T.localSigner(key);
  } finally {
    key.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Consumer payload (wallet → key `tx` action)
// ---------------------------------------------------------------------------

export interface TronOpPayload {
  network: string;
  vault: string;
  signers: string[];
  threshold: number;
  op: T.Op;
  walletSignature: Uint8Array;
}

const PAYLOAD_KEYS = [
  'format',
  'version',
  'network',
  'vault',
  'signers',
  'threshold',
  'op',
  'walletSignature',
];

const SIG_HEX_RE = /^0x[0-9a-fA-F]{130}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True if `payload` claims to be an `ssp-tron-op` payload (routing only). */
export function isTronOpPayload(payload: string): boolean {
  try {
    const parsed: unknown = JSON.parse(payload);
    return isPlainObject(parsed) && parsed.format === TRON_OP_FORMAT;
  } catch {
    return false;
  }
}

/**
 * Strict parse of the consumer `tx` payload
 * `{format:'ssp-tron-op', version:1, network, vault, signers, threshold, op,
 * walletSignature}`. The Op goes through the SDK's canonical decoder; nothing
 * here is trusted yet — verifyTronConsumerRequest re-derives everything.
 */
export function parseTronOpPayload(raw: string): TronOpPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TronVerifyError('not_tron_payload', 'TRON payload is not JSON');
  }
  if (!isPlainObject(parsed) || parsed.format !== TRON_OP_FORMAT) {
    throw new TronVerifyError(
      'not_tron_payload',
      'Payload is not an ssp-tron-op operation',
    );
  }
  if (parsed.version !== TRON_OP_VERSION) {
    throw new TronVerifyError(
      'bad_payload',
      `Unsupported ssp-tron-op version ${String(parsed.version)}`,
    );
  }
  const extra = Object.keys(parsed).filter((k) => !PAYLOAD_KEYS.includes(k));
  if (extra.length > 0) {
    throw new TronVerifyError(
      'bad_payload',
      `Unexpected ssp-tron-op field(s): ${extra.join(', ')}`,
    );
  }
  const { network, vault, signers, threshold, walletSignature } = parsed;
  if (typeof network !== 'string' || !T.isValidAddress(vault)) {
    throw new TronVerifyError('bad_payload', 'Invalid TRON network or vault');
  }
  if (
    !Array.isArray(signers) ||
    signers.length === 0 ||
    signers.length > T.MAX_SIGNERS ||
    !signers.every((s) => T.isValidAddress(s))
  ) {
    throw new TronVerifyError('bad_payload', 'Invalid TRON signers');
  }
  if (typeof threshold !== 'number' || !Number.isInteger(threshold)) {
    throw new TronVerifyError('bad_payload', 'Invalid TRON threshold');
  }
  if (
    typeof walletSignature !== 'string' ||
    !SIG_HEX_RE.test(walletSignature)
  ) {
    throw new TronVerifyError('bad_payload', 'Invalid wallet signature');
  }
  let op: T.Op;
  try {
    op = T.opFromJson(parsed.op);
  } catch (error) {
    throw new TronVerifyError(
      'bad_payload',
      `Invalid TRON operation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    network,
    vault,
    signers,
    threshold,
    op,
    walletSignature: T.hexToBytes(walletSignature),
  };
}

/** `typeIndex-addressIndex` of a consumer TRON vault: typeIndex is always 0. */
export function parseTronConsumerPath(path: string): {
  typeIndex: number;
  addressIndex: number;
} {
  const parts = path.split('-');
  const typeIndex = Number(parts[0]);
  const addressIndex = Number(parts[1]);
  if (
    parts.length !== 2 ||
    !/^\d+$/.test(parts[0] ?? '') ||
    !/^\d+$/.test(parts[1] ?? '') ||
    typeIndex !== 0 ||
    !Number.isSafeInteger(addressIndex) ||
    addressIndex >= 0x80000000
  ) {
    throw new TronVerifyError('bad_path', `Invalid TRON vault path ${path}`);
  }
  return { typeIndex, addressIndex };
}

function sameSigners(a: readonly string[], b: readonly string[]): boolean {
  // Base58 is case-sensitive: exact string equality, never lowercased.
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

export interface TronConsumerContext {
  xpubWallet: string;
  xpubKey: string;
  /** `0-{addressIndex}` from the relay action (never from the payload). */
  path: string;
  network: T.NetworkConfig;
  /** Unix seconds. */
  now: bigint;
}

export interface TronConsumerVerified {
  chain: string;
  network: T.NetworkConfig;
  payload: TronOpPayload;
  config: T.VaultConfig;
  vault: T.VaultInfo;
  digest: Uint8Array;
  display: T.OpDisplay;
  walletSigner: string;
  keySigner: string;
  typeIndex: number;
  addressIndex: number;
}

/**
 * Contract §5 rules 1–5 for a consumer `tx` payload. Runs at display time AND
 * again at signing time; throws on anything this device cannot vouch for.
 */
export function verifyTronConsumerRequest(
  rawTx: string,
  chain: string,
  ctx: TronConsumerContext,
): TronConsumerVerified {
  const { network } = ctx;
  requireTronLive(network);
  const { typeIndex, addressIndex } = parseTronConsumerPath(ctx.path);
  const payload = parseTronOpPayload(rawTx);
  if (!tronNetworkMatches(payload.network, network)) {
    throw new TronVerifyError(
      'wrong_network',
      `TRON operation is for ${payload.network}, not ${network.name}`,
    );
  }
  // Rule 1: derive, never trust.
  const own = tronConsumerVault(
    ctx.xpubWallet,
    ctx.xpubKey,
    typeIndex,
    addressIndex,
    chain,
    network,
  );
  if (
    payload.threshold !== own.config.threshold ||
    !sameSigners(payload.signers, own.config.signers) ||
    payload.vault !== own.vault.address
  ) {
    throw new TronVerifyError(
      'wrong_vault',
      `TRON operation is not for this device's vault at path ${ctx.path}`,
    );
  }
  // Rule 3–5: the consumer policy (transfers only), pinned collector, fee
  // token + ceiling, deadline window.
  const display = T.decodeOpForDisplay(payload.op, {
    policy: 'consumer',
    vault: own.vault.address,
    now: ctx.now,
    maxDeadlineSeconds: TRON_CONSUMER_MAX_DEADLINE_SECONDS,
    feeCollector: network.feeCollector,
    feeCeilings: tronFeeCeilings(network),
    tokens: tronDisplayTokens(chain, network),
  });
  // Rule 2: never sign an opaque hash.
  const digest = T.opDigest(network.chainId, own.vault.address, payload.op);
  let recovered: string;
  try {
    recovered = T.recoverSigner(digest, payload.walletSignature);
  } catch {
    throw new TronVerifyError(
      'bad_wallet_signature',
      'SSP Wallet signature is invalid',
    );
  }
  if (recovered !== own.walletSigner) {
    throw new TronVerifyError(
      'bad_wallet_signature',
      'SSP Wallet signature does not match this vault',
    );
  }
  return {
    chain,
    network,
    payload,
    config: own.config,
    vault: own.vault,
    digest,
    display,
    walletSigner: own.walletSigner,
    keySigner: own.keySigner,
    typeIndex,
    addressIndex,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Exact decimal rendering of base units (no float rounding). */
export function formatTronUnits(amount: bigint, decimals: number): string {
  if (decimals <= 0) return amount.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

export type TronCallViewKind =
  | 'trxTransfer'
  | 'trc20Transfer'
  | 'trc10Transfer'
  | 'approve'
  | 'selfCall'
  | 'unknown';

export interface TronCallView {
  index: number;
  kind: TronCallViewKind;
  /** Recipient (transfers), spender (approve) or target contract. */
  to: string;
  /** Human amount when decimals are known, otherwise base units. */
  amount: string;
  /** Raw base units, always. */
  amountBaseUnits: string;
  /** null when the token is not known on this device. */
  symbol: string | null;
  decimals: number | null;
  /** TRC-20 contract (trc20Transfer / approve) or TRC-10 id (trc10Transfer). */
  token?: string;
  unknownToken: boolean;
  toVault: boolean;
  unlimited?: boolean;
  /** selfCall action name (invalidateNonces, freezeBalanceV2, …). */
  action?: string;
  /**
   * selfCall: its decoded arguments (receiver / amount / resource / votes /
   * nonce word + mask), so nothing that matters is only in raw calldata.
   */
  detail?: string;
  /** Raw calldata (approve / unknown / selfCall), shown as-is. */
  data?: string;
}

export type TronFeeView =
  | { kind: 'none' }
  | {
      kind: 'trx' | 'trc20';
      amount: string;
      amountBaseUnits: string;
      symbol: string | null;
      token: string;
      recipient: string;
    };

export interface TronSelfPayAccount {
  /** This device's own TRON account (the key leaf address) that pays. */
  address: string;
  /** sun; null when it could not be read. */
  balanceSun: string | null;
  balance: string | null;
  minimumSun: string;
  minimum: string;
  sufficient: boolean;
}

export interface TronOpView {
  chain: string;
  vault: string;
  nonce: string;
  /** Unix seconds. */
  deadline: number;
  calls: TronCallView[];
  fee: TronFeeView;
  /** fee.amount == 0: this device submits and pays the network fee itself. */
  selfPay: boolean;
  isCancellation: boolean;
  warnings: string[];
  selfPayAccount?: TronSelfPayAccount;
}

/** Human text of a vault self-call's arguments (see TronCallView.detail). */
function selfCallDetail(
  c: Extract<T.DisplayCall, { kind: 'selfCall' }>,
  nativeSymbol: string,
): string {
  const trx = (amount: bigint) =>
    `${formatTronUnits(amount, TRX_DECIMALS)} ${nativeSymbol}`;
  switch (c.action) {
    case 'invalidateNonces':
      return `word ${c.word.toString()}, mask 0x${c.mask.toString(16)}`;
    case 'freezeBalanceV2':
    case 'unfreezeBalanceV2':
      return `${trx(c.amount)}, ${c.resource}`;
    case 'delegateResource':
    case 'undelegateResource':
      return `${c.receiver}: ${trx(c.amount)}, ${c.resource}`;
    case 'voteWitnesses':
      return c.votes
        .map((v) => `${v.witness}: ${v.count.toString()}`)
        .join(', ');
    default:
      return '';
  }
}

function callView(
  c: T.DisplayCall,
  chain: string,
  vault: string,
  warnings: readonly T.DisplayWarning[],
): TronCallView {
  const nativeSymbol = blockchains[chain]?.symbol ?? 'TRX';
  const unknownToken = warnings.some(
    (w) => w.code === 'UNKNOWN_TOKEN' && w.index === c.index,
  );
  switch (c.kind) {
    case 'trxTransfer':
      return {
        index: c.index,
        kind: c.kind,
        to: c.to,
        amount: formatTronUnits(c.amount, TRX_DECIMALS),
        amountBaseUnits: c.amount.toString(),
        symbol: nativeSymbol,
        decimals: TRX_DECIMALS,
        unknownToken: false,
        toVault: c.to === vault,
      };
    case 'trc20Transfer':
      return {
        index: c.index,
        kind: c.kind,
        to: c.to,
        amount:
          c.decimals === null
            ? c.amount.toString()
            : formatTronUnits(c.amount, c.decimals),
        amountBaseUnits: c.amount.toString(),
        symbol: c.symbol,
        decimals: c.decimals,
        token: c.token,
        unknownToken: unknownToken || c.symbol === null,
        toVault: c.to === vault,
      };
    case 'trc10Transfer':
      // TRC-10 decimals are not known on this device: raw units + token id.
      return {
        index: c.index,
        kind: c.kind,
        to: c.to,
        amount: c.amount.toString(),
        amountBaseUnits: c.amount.toString(),
        symbol: null,
        decimals: null,
        token: c.tokenId.toString(),
        unknownToken: true,
        toVault: c.to === vault,
      };
    case 'approve':
      return {
        index: c.index,
        kind: c.kind,
        to: c.spender,
        amount:
          c.decimals === null
            ? c.amount.toString()
            : formatTronUnits(c.amount, c.decimals),
        amountBaseUnits: c.amount.toString(),
        symbol: c.symbol,
        decimals: c.decimals,
        token: c.token,
        unknownToken: c.symbol === null,
        toVault: false,
        unlimited: c.unlimited,
        data: c.data,
      };
    case 'selfCall':
      return {
        index: c.index,
        kind: c.kind,
        to: vault,
        amount: '0',
        amountBaseUnits: '0',
        symbol: null,
        decimals: null,
        unknownToken: false,
        toVault: true,
        action: c.action,
        detail: selfCallDetail(c, nativeSymbol),
        data: T.to0x(T.encodeSelfCall(c)),
      };
    default:
      return {
        index: c.index,
        kind: 'unknown',
        to: c.to,
        amount: formatTronUnits(c.value, TRX_DECIMALS),
        amountBaseUnits: c.value.toString(),
        symbol: nativeSymbol,
        decimals: TRX_DECIMALS,
        unknownToken: false,
        toVault: c.to === vault,
        data: c.data,
      };
  }
}

/** The approval-screen view of a decoded (policy-checked) Op. */
export function tronOpView(display: T.OpDisplay, chain: string): TronOpView {
  let fee: TronFeeView = { kind: 'none' };
  if (display.fee.kind === 'trx') {
    fee = {
      kind: 'trx',
      amount: formatTronUnits(display.fee.amount, TRX_DECIMALS),
      amountBaseUnits: display.fee.amount.toString(),
      symbol: blockchains[chain]?.symbol ?? 'TRX',
      token: T.TRX_FEE_TOKEN,
      recipient: display.fee.recipient,
    };
  } else if (display.fee.kind === 'trc20') {
    fee = {
      kind: 'trc20',
      amount:
        display.fee.decimals === null
          ? display.fee.amount.toString()
          : formatTronUnits(display.fee.amount, display.fee.decimals),
      amountBaseUnits: display.fee.amount.toString(),
      symbol: display.fee.symbol,
      token: display.fee.token,
      recipient: display.fee.recipient,
    };
  }
  return {
    chain,
    vault: display.vault,
    nonce: display.nonce.toString(),
    deadline: Number(display.deadline),
    calls: display.calls.map((c) =>
      callView(c, chain, display.vault, display.warnings),
    ),
    fee,
    selfPay: display.fee.kind === 'none',
    isCancellation: display.isCancellation,
    warnings: display.warnings.map((w) => w.code),
  };
}

/**
 * What the approval screen showed: the chain, vault and Op digest. The digest
 * commits to (chainId, vault, calls, nonce, deadline, fee), so the signing
 * path signs only if its own re-verification of the payload yields exactly
 * this (a swapped payload can never be signed unseen).
 */
export interface TronApprovedSummary {
  chain: string;
  vault: string;
  digest: string;
}

export function tronApprovedSummary(
  verified: TronConsumerVerified,
): TronApprovedSummary {
  return {
    chain: verified.chain,
    vault: verified.vault.address,
    digest: T.to0x(verified.digest),
  };
}

/** Why `verified` differs from what was approved, or null when identical. */
export function tronApprovedSummaryMismatch(
  approved: TronApprovedSummary,
  verified: TronConsumerVerified,
): string | null {
  const now = tronApprovedSummary(verified);
  if (approved.chain !== now.chain) return 'chain differs';
  if (approved.vault !== now.vault) return 'vault differs';
  if (approved.digest !== now.digest) return 'operation differs';
  return null;
}

/** Human, stable text for a refusal reason (logs and toasts). */
export function tronErrorReason(error: unknown): string {
  if (error instanceof T.PolicyError) return `policy:${error.reason}`;
  if (error instanceof TronVerifyError) return error.reason;
  if (error instanceof TronNotLiveError) return 'not_live';
  return 'decode';
}

// ---------------------------------------------------------------------------
// Network (full-node HTTP through the ssp-backends-proxy Worker)
// ---------------------------------------------------------------------------

/** Whole node exchange (headers and body): a stalled node must not leave an approval spinning. */
export const TRON_NODE_TIMEOUT_MS = 30000;

/**
 * `fetchImpl` bounded by `timeoutMs`. The body is read inside the timeout too,
 * so a node that sends headers and then stalls fails as well.
 */
export function timedTronFetch(
  fetchImpl: typeof fetch,
  timeoutMs: number = TRON_NODE_TIMEOUT_MS,
): FetchLike {
  return async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        text: () => Promise.resolve(text),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function tronHttpClient(
  chain: string,
  fetchImpl?: FetchLike,
): TronHttpClient {
  return new TronHttpClient(
    `https://${backends()[chain].node}`,
    // Pass fetch explicitly: the lockdown runtime may not expose it on the
    // global the library looks at.
    fetchImpl ?? timedTronFetch((url, init) => fetch(url, init)),
  );
}

/** Balance (sun) of a TRON account; 0 for an account that was never activated. */
export async function fetchTronBalance(
  client: TronHttpClient,
  address: string,
): Promise<bigint> {
  const account = await client.getAccount(address);
  return account ? account.balance : 0n;
}

/** The self-pay account view: this device's own leaf account and its balance. */
export async function tronSelfPayAccount(
  address: string,
  getBalance: (address: string) => Promise<bigint>,
): Promise<TronSelfPayAccount> {
  let balance: bigint | null = null;
  try {
    balance = await getBalance(address);
  } catch {
    balance = null;
  }
  return {
    address,
    balanceSun: balance === null ? null : balance.toString(),
    balance: balance === null ? null : formatTronUnits(balance, TRX_DECIMALS),
    minimumSun: TRON_SELF_PAY_MIN_BALANCE_SUN.toString(),
    minimum: formatTronUnits(TRON_SELF_PAY_MIN_BALANCE_SUN, TRX_DECIMALS),
    sufficient: balance !== null && balance >= TRON_SELF_PAY_MIN_BALANCE_SUN,
  };
}

export function tronNowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

// ---------------------------------------------------------------------------
// Co-signed Ops that may still execute (CHN-9)
// ---------------------------------------------------------------------------
//
// Once this device co-signs a consumer Op, a fully signed Op exists and stays
// executable until its deadline (up to 2 h), whatever the broadcast answers:
// a sponsor refusal, any other relay error, a 5xx, a timeout or even a
// "success" txid that never lands all leave it with the relay (and, on the
// self-pay path, with the node that simulated or received it). If the user
// then sends again under a NEW nonce, a malicious relay could execute both (a
// double payment). So EVERY Op this device co-signs is recorded durably
// BEFORE the signed Op leaves the device, and its record is cleared only when
// this device's own TRON node shows the nonce used on-chain, or once its
// deadline plus clock skew has passed. While a record is outstanding, a
// consumer Op of the same vault must reuse its nonce (only one of them can
// ever execute; SSP Wallet does so) — a different nonce is refused. The
// records hold no secrets.

/** Storage key (historical name: records of earlier builds stay in force). */
export const TRON_COSIGNED_OPS_STORAGE_KEY = 'tronRefusedOps';
/** Side key: when a corrupt record blob was first seen (ms). */
export const TRON_COSIGNED_OPS_CORRUPT_SINCE_KEY =
  'tronRefusedOps.corruptSince';
/** Prefix of the key a corrupt blob is moved to once it is provably stale. */
export const TRON_COSIGNED_OPS_QUARANTINE_PREFIX = 'tronRefusedOps.corrupt.';
/**
 * At most this many live records. Each expires ≤ 2 h after it was made and a
 * vault holds one outstanding nonce at a time, so a full store means many
 * unconfirmed payments: co-signing then pauses (fails closed) rather than
 * forgetting one.
 */
export const TRON_COSIGNED_OPS_MAX = 128;
/**
 * Device ↔ chain clock skew allowed when deciding a deadline has passed. The
 * single TRON skew constant of this app; SSP Wallet uses the same 120 s.
 */
export const TRON_CLOCK_SKEW_SECONDS = 120n;

export interface TronCosignedOp {
  chain: string;
  vault: string;
  /** decimal string */
  nonce: string;
  /** unix seconds */
  deadline: number;
  /** opDigest (`0x` + 64 hex) of the co-signed Op; absent in older records. */
  digest?: string;
  recordedAtMs: number;
}

/** The co-signed-Op records cannot be read: fail closed (see readCosignedOps). */
export class TronCosignedOpsUnreadableError extends Error {
  constructor() {
    super('TRON co-signed payment records are unreadable');
    this.name = 'TronCosignedOpsUnreadableError';
  }
}

const DIGEST_RE = /^0x[0-9a-f]{64}$/;

function isCosignedOp(v: unknown): v is TronCosignedOp {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v).sort().join(',');
  return (
    (keys === 'chain,deadline,nonce,recordedAtMs,vault' ||
      (keys === 'chain,deadline,digest,nonce,recordedAtMs,vault' &&
        typeof v.digest === 'string' &&
        DIGEST_RE.test(v.digest))) &&
    typeof v.chain === 'string' &&
    T.isValidAddress(v.vault) &&
    typeof v.nonce === 'string' &&
    /^(0|[1-9][0-9]{0,77})$/.test(v.nonce) &&
    Number.isSafeInteger(v.deadline) &&
    (v.deadline as number) >= 0 &&
    Number.isSafeInteger(v.recordedAtMs)
  );
}

function corruptSince(): number | null {
  // '' = cleared (MMKV v4 has no portable delete across the mock and v4).
  const raw = storage.getString(TRON_COSIGNED_OPS_CORRUPT_SINCE_KEY);
  if (!raw || !/^\d{1,16}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Read every record. An unreadable blob fails CLOSED (throws) — never "no
 * outstanding Ops". It can only hold Ops whose deadline is at most 2 h after
 * they were recorded (the consumer deadline window), so once it has been seen
 * unreadable for longer than that window (+ skew) it is moved aside and reset.
 */
function readCosignedOps(nowMs: number): TronCosignedOp[] {
  const raw = storage.getString(TRON_COSIGNED_OPS_STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (Array.isArray(parsed) && parsed.every(isCosignedOp)) {
    return parsed;
  }
  const since = corruptSince();
  const windowMs =
    Number(TRON_CONSUMER_MAX_DEADLINE_SECONDS + TRON_CLOCK_SKEW_SECONDS) * 1000;
  if (since === null) {
    storage.set(TRON_COSIGNED_OPS_CORRUPT_SINCE_KEY, String(nowMs));
  } else if (nowMs - since >= windowMs) {
    storage.set(`${TRON_COSIGNED_OPS_QUARANTINE_PREFIX}${String(since)}`, raw);
    storage.set(TRON_COSIGNED_OPS_STORAGE_KEY, '[]');
    storage.set(TRON_COSIGNED_OPS_CORRUPT_SINCE_KEY, '');
    return [];
  }
  throw new TronCosignedOpsUnreadableError();
}

function writeCosignedOps(list: TronCosignedOp[]): void {
  storage.set(TRON_COSIGNED_OPS_STORAGE_KEY, JSON.stringify(list));
}

function isLive(e: TronCosignedOp, nowSec: bigint): boolean {
  return BigInt(e.deadline) + TRON_CLOCK_SKEW_SECONDS >= nowSec;
}

function sameOp(
  e: TronCosignedOp,
  chain: string,
  vault: string,
  nonce: string,
): boolean {
  return e.chain === chain && e.vault === vault && e.nonce === nonce;
}

/**
 * Durably record an Op this device co-signed, BEFORE the signed Op leaves the
 * device (relay broadcast, or the self-pay simulation / transaction). Throws
 * — and the caller then releases nothing — when the records are unreadable,
 * the store is full of live records, or the write does not read back.
 */
export function recordTronCosignedOp(
  op: {
    chain: string;
    vault: string;
    nonce: bigint;
    deadline: bigint;
    digest: string;
  },
  nowMs: number = Date.now(),
): void {
  if (!T.isValidAddress(op.vault) || !DIGEST_RE.test(op.digest)) {
    throw new TronVerifyError('bad_payload', 'Invalid TRON operation record');
  }
  // Unreadable: throws TronCosignedOpsUnreadableError (nothing is released).
  const list = readCosignedOps(nowMs);
  const nowSec = BigInt(Math.floor(nowMs / 1000));
  const nonce = op.nonce.toString();
  const deadline =
    op.deadline > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(op.deadline);
  const next = list.filter(
    (e) => isLive(e, nowSec) && !sameOp(e, op.chain, op.vault, nonce),
  );
  if (next.length >= TRON_COSIGNED_OPS_MAX) {
    throw new TronVerifyError(
      'bad_policy',
      'SSP Key holds too many TRON payments that are not confirmed on-chain yet; to avoid a double payment no TRON operation is signed until some of them are confirmed or expire (at most 2 hours)',
    );
  }
  const prev = list.find((e) => sameOp(e, op.chain, op.vault, nonce));
  next.push({
    chain: op.chain,
    vault: op.vault,
    nonce,
    // The same nonce co-signed twice: the later deadline governs.
    deadline: prev ? Math.max(prev.deadline, deadline) : deadline,
    digest: op.digest,
    recordedAtMs: nowMs,
  });
  writeCosignedOps(next);
  // Durable before release: the record must read back.
  const back = readCosignedOps(nowMs);
  if (
    !back.some(
      (e) =>
        sameOp(e, op.chain, op.vault, nonce) &&
        e.digest === op.digest &&
        e.deadline >= deadline,
    )
  ) {
    throw new TronVerifyError(
      'bad_policy',
      'SSP Key could not save its record of this TRON payment; nothing was signed',
    );
  }
}

/**
 * Co-signed Ops of `vault` on `chain` that may still execute (by deadline;
 * the chain is not asked). Throws TronCosignedOpsUnreadableError when the
 * records cannot be read.
 */
export function outstandingTronCosignedOps(
  chain: string,
  vault: string,
  nowSec: bigint = tronNowSeconds(),
): TronCosignedOp[] {
  return readCosignedOps(Number(nowSec) * 1000).filter(
    (e) => e.chain === chain && e.vault === vault && isLive(e, nowSec),
  );
}

/**
 * Display-time verdict for the approval screen (never throws): an earlier
 * co-signed Op of this vault under a DIFFERENT nonce that may still execute,
 * or records that cannot be read. Synchronous (no chain lookup): pair it with
 * pruneTronCosignedOps to drop records the chain already shows used.
 */
export function tronOutstandingOpWarning(
  view: Pick<TronOpView, 'chain' | 'vault' | 'nonce'>,
  nowSec: bigint = tronNowSeconds(),
): { kind: 'pending'; deadline: number } | { kind: 'unreadable' } | null {
  try {
    const other = outstandingTronCosignedOps(view.chain, view.vault, nowSec)
      .filter((e) => e.nonce !== view.nonce)
      .sort((a, b) => b.deadline - a.deadline)[0];
    return other ? { kind: 'pending', deadline: other.deadline } : null;
  } catch {
    return { kind: 'unreadable' };
  }
}

/**
 * The on-chain "is this nonce used?" lookup the records are cleared by, on
 * this device's own TRON node. A vault without code has used no nonce.
 */
export function tronNonceUsedLookup(
  client: Pick<TronHttpClient, 'hasCode' | 'isNonceUsed'>,
): (vault: string, nonce: bigint) => Promise<boolean> {
  return async (vault, nonce) =>
    (await client.hasCode(vault)) ? client.isNonceUsed(vault, nonce) : false;
}

/**
 * Drop every live record of `vault` (other than `exceptNonce`) whose nonce
 * this device's node shows used on-chain, and every expired record. Returns
 * the records of `vault` under another nonce that are still outstanding.
 * Throws when the records are unreadable or a lookup fails (fail closed).
 */
export async function pruneTronCosignedOps(opts: {
  chain: string;
  vault: string;
  exceptNonce?: string;
  /** unix seconds */
  now?: bigint;
  isNonceUsed: (vault: string, nonce: bigint) => Promise<boolean>;
}): Promise<TronCosignedOp[]> {
  const nowSec = opts.now ?? tronNowSeconds();
  const nowMs = Number(nowSec) * 1000;
  const list = readCosignedOps(nowMs);
  const live = list.filter((e) => isLive(e, nowSec));
  const candidates = live.filter(
    (e) =>
      e.chain === opts.chain &&
      e.vault === opts.vault &&
      e.nonce !== opts.exceptNonce,
  );
  const used = new Set<TronCosignedOp>();
  for (const e of candidates) {
    // A failed lookup throws: fail closed.
    if (await opts.isNonceUsed(e.vault, BigInt(e.nonce))) used.add(e);
  }
  const keep = live.filter((e) => !used.has(e));
  if (keep.length !== list.length) {
    // Re-read so a record written meanwhile is never lost.
    const fresh = readCosignedOps(nowMs);
    writeCosignedOps(
      fresh.filter(
        (e) =>
          isLive(e, nowSec) &&
          ![...used].some((u) => sameOp(e, u.chain, u.vault, u.nonce)),
      ),
    );
  }
  return candidates.filter((e) => !used.has(e));
}

/**
 * Sign-time gate (fails CLOSED): refuses to co-sign a consumer Op of `vault`
 * while an earlier Op this device co-signed can still execute under a
 * different nonce — whatever its broadcast answered. A record whose nonce is
 * already used on-chain is dropped (that Op, or something else, burned it).
 * An Op that reuses the outstanding nonce is fine: only one can execute.
 */
export async function assertNoOutstandingTronOp(opts: {
  chain: string;
  vault: string;
  nonce: bigint;
  /** unix seconds */
  now?: bigint;
  isNonceUsed: (vault: string, nonce: bigint) => Promise<boolean>;
}): Promise<void> {
  let still: TronCosignedOp[];
  try {
    still = await pruneTronCosignedOps({
      chain: opts.chain,
      vault: opts.vault,
      exceptNonce: opts.nonce.toString(),
      now: opts.now,
      isNonceUsed: opts.isNonceUsed,
    });
  } catch (error) {
    if (error instanceof TronCosignedOpsUnreadableError) {
      throw new TronVerifyError(
        'bad_policy',
        'SSP Key cannot read its record of co-signed TRON payments; to avoid a double payment no TRON operation is signed until it is readable again (at most 2 hours)',
      );
    }
    throw error;
  }
  if (still.length > 0) {
    const latest = still.reduce((a, b) => (b.deadline > a.deadline ? b : a));
    throw new TronVerifyError(
      'bad_policy',
      `An earlier payment from this vault that SSP Key co-signed (nonce ${latest.nonce}) is not confirmed on-chain and can still be executed until ${new Date(latest.deadline * 1000).toISOString()}. Send it again from SSP Wallet (it reuses that nonce, so only one of the two can execute) or wait until it is confirmed or expires.`,
    );
  }
}
