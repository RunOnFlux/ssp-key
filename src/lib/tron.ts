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

export function tronHttpClient(
  chain: string,
  fetchImpl?: FetchLike,
): TronHttpClient {
  return new TronHttpClient(
    `https://${backends()[chain].node}`,
    // Pass fetch explicitly: the lockdown runtime may not expose it on the
    // global the library looks at.
    fetchImpl ?? ((url, init) => fetch(url, init)),
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
