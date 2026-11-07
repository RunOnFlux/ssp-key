/**
 * Consumer (2-of-2 wallet + key) signing guards shared by the approval
 * screens and the signing actions.
 *
 * Everything here is pure and fails CLOSED: a value this device cannot
 * positively validate throws, and callers treat a throw as "refuse to sign".
 * The same functions run when the request is DISPLAYED and again right
 * before it is SIGNED, so what is approved and what is signed are checked
 * against one rulebook.
 */
import BigNumber from 'bignumber.js';
import { Buffer } from 'buffer';

// ---------------------------------------------------------------------------
// KEY-8: consumer derivation paths
// ---------------------------------------------------------------------------

/** BIP32 non-hardened child indices are < 2^31. */
const MAX_NON_HARDENED_INDEX = 0x80000000;

export interface ConsumerDerivationPath {
  /** 0 = receive, 1 = change. Nothing else is a consumer spending path. */
  typeIndex: 0 | 1;
  addressIndex: number;
}

/**
 * Parse the wallet-supplied `typeIndex-addressIndex` path of a consumer
 * request. Only the receive (0) and change (1) branches are consumer
 * spending keys: 10 (WK identity), 11 (external identity), 12 (Flux node
 * identity) and anything else must never be reachable from a consumer
 * transaction or message signature, so they are refused.
 */
export function parseConsumerDerivationPath(
  path: unknown,
): ConsumerDerivationPath {
  if (typeof path !== 'string') {
    throw new Error('Invalid derivation path');
  }
  const match = /^(\d{1,10})-(\d{1,10})$/.exec(path);
  if (!match) {
    throw new Error('Invalid derivation path');
  }
  const typeIndex = Number(match[1]);
  const addressIndex = Number(match[2]);
  if (typeIndex !== 0 && typeIndex !== 1) {
    throw new Error(
      `Derivation branch ${typeIndex} is not a consumer spending branch`,
    );
  }
  if (
    !Number.isSafeInteger(addressIndex) ||
    addressIndex < 0 ||
    addressIndex >= MAX_NON_HARDENED_INDEX
  ) {
    throw new Error('Invalid address index');
  }
  return { typeIndex, addressIndex };
}

// ---------------------------------------------------------------------------
// Fee caps (H-2 / UTXO-4, CHN-7)
// ---------------------------------------------------------------------------

/**
 * Highest network fee, in USD, the key co-signs on a consumer transaction.
 * Mirrors SSP Wallet's default `sspConfig().maxTxFeeUSD` (its "absurd fee"
 * guard), which the wallet combines with the per-chain `maxFee` exactly as
 * `maxConsumerFee` does below.
 */
export const CONSUMER_MAX_FEE_USD = 100;

/**
 * Hard ceiling for the consumer Solana paymaster reimbursement: 0.05 SOL, the
 * same bound the enterprise Solana path applies. The relay's real schedule
 * tops out at ~0.0057 SOL (first send + recipient ATA rent).
 */
export const CONSUMER_SOL_MAX_FEE_LAMPORTS = '50000000';

/**
 * Hard per-chain ceilings (wei) for a consumer EVM operation's maximum gas
 * cost, (callGasLimit + verificationGasLimit + preVerificationGas) *
 * maxFeePerGas — what the account prefunds without a paymaster. The chain
 * spec has no EVM `maxFee`, so these play its role (absurd-fee protection,
 * far above normal use); CONSUMER_MAX_FEE_USD applies below them whenever a
 * rate is known. A chain without an entry is refused (fail closed).
 */
export const CONSUMER_EVM_MAX_FEE_WEI: Readonly<Record<string, string>> = {
  eth: '50000000000000000', // 0.05 ETH
  base: '10000000000000000', // 0.01 ETH
  polygon: '100000000000000000000', // 100 POL
  bsc: '100000000000000000', // 0.1 BNB
  avax: '3000000000000000000', // 3 AVAX
  sepolia: '1000000000000000000', // 1 TEST-ETH
  amoy: '100000000000000000000', // 100 TEST-POL
};

/**
 * min(hard per-chain cap, CONSUMER_MAX_FEE_USD worth of the native asset).
 * The USD leg only applies when a positive rate is known; the hard cap always
 * applies, so an unknown or manipulated rate can never raise the ceiling
 * above the chain constant. Result is in base units, rounded down.
 */
export function maxConsumerFee(
  hardCapBaseUnits: string | number,
  decimals: number,
  usdRate?: number,
): BigNumber {
  return feeCapWithUsdCeiling(
    hardCapBaseUnits,
    decimals,
    usdRate,
    CONSUMER_MAX_FEE_USD,
  );
}

/**
 * Enterprise UTXO vault fee ceiling (USD leg). Matches relay-enterprise's
 * proposer-fee ceiling (ENTERPRISE_MAX_FEE_USD default) — vault spends are
 * larger (M-of-N scripts, consolidations) than consumer 2-of-2 spends, so the
 * consumer $100 would refuse legitimate vault transactions. The per-chain
 * `maxFee` (the builder's own absurd-fee limit) always applies too.
 */
export const VAULT_MAX_FEE_USD = 1000;

/** min(hard per-chain cap, VAULT_MAX_FEE_USD worth of the native asset). */
export function maxVaultFee(
  hardCapBaseUnits: string | number,
  decimals: number,
  usdRate?: number,
): BigNumber {
  return feeCapWithUsdCeiling(
    hardCapBaseUnits,
    decimals,
    usdRate,
    VAULT_MAX_FEE_USD,
  );
}

function feeCapWithUsdCeiling(
  hardCapBaseUnits: string | number,
  decimals: number,
  usdRate: number | undefined,
  usdCeiling: number,
): BigNumber {
  const hardCap = new BigNumber(hardCapBaseUnits);
  if (!hardCap.isFinite() || hardCap.isNegative()) {
    throw new Error('Invalid fee cap configuration');
  }
  if (typeof usdRate === 'number' && Number.isFinite(usdRate) && usdRate > 0) {
    const usdCap = new BigNumber(usdCeiling)
      .dividedBy(usdRate)
      .multipliedBy(new BigNumber(10).pow(decimals))
      .integerValue(BigNumber.ROUND_FLOOR);
    if (usdCap.isFinite() && usdCap.isLessThan(hardCap)) {
      return usdCap;
    }
  }
  return hardCap;
}

// ---------------------------------------------------------------------------
// EVM call-safety rules (C-4 / EVM-1 / AA-5)
// ---------------------------------------------------------------------------

/** OZ UUPS `upgradeToAndCall(address,bytes)`. */
export const SELECTOR_UPGRADE_TO_AND_CALL = '0x4f1ef286';
/** Legacy UUPS `upgradeTo(address)`. */
export const SELECTOR_UPGRADE_TO = '0x3659cfe6';

const REFUSED_SELECTORS: Record<string, string> = {
  [SELECTOR_UPGRADE_TO_AND_CALL]: 'upgradeToAndCall',
  [SELECTOR_UPGRADE_TO]: 'upgradeTo',
};

/** True when the inner calldata is non-empty, i.e. this is a contract call. */
export function hasEvmCalldata(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  const trimmed = data.trim().toLowerCase();
  return trimmed !== '' && trimmed !== '0x';
}

/**
 * Apply the ecosystem-wide EVM call-safety rules to ONE inner call of a
 * smart-account operation. Throws on:
 *  - a call whose target is the account itself (`target == sender`) — the
 *    account authorises its own upgrades and role changes through self-calls,
 *    so a "send 1 wei to yourself" can replace the implementation;
 *  - the UUPS upgrade selectors, to ANY target.
 */
export function assertEvmCallSafe(
  call: { target: string; data: string },
  sender: string,
): void {
  if (typeof call.target !== 'string' || !call.target) {
    throw new Error('Contract call has no target');
  }
  if (
    typeof sender === 'string' &&
    sender &&
    call.target.toLowerCase() === sender.toLowerCase()
  ) {
    throw new Error(
      'Refused: the transaction calls your own account (self-call)',
    );
  }
  if (hasEvmCalldata(call.data)) {
    const selector = call.data.trim().slice(0, 10).toLowerCase();
    const name = REFUSED_SELECTORS[selector];
    if (name) {
      throw new Error(`Refused: ${name} (account upgrade) call`);
    }
  }
}

// ---------------------------------------------------------------------------
// AA-2: consumer personal_sign must be an EIP-191 message
// ---------------------------------------------------------------------------

/** EIP-191 version 0x45 prefix (ethers' `MessagePrefix`). */
export const EIP191_PREFIX = '\x19Ethereum Signed Message:\n';

/** A lone UTF-16 surrogate has no UTF-8 encoding. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function utf8ByteLength(text: string): number {
  if (LONE_SURROGATE.test(text)) {
    throw new Error('Message is not valid UTF-8 text');
  }
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Rebuild the EIP-191 preimage for `text`, exactly as SSP Wallet builds it
 * (prefix + UTF-8 byte length + text). The Schnorr SDK hashes this string as
 * keccak256(utf8(preimage)), which equals ethers' hashMessage(text).
 */
export function buildEip191Preimage(text: string): string {
  return `${EIP191_PREFIX}${utf8ByteLength(text)}${text}`;
}

/**
 * Parse the data a consumer EVM signing request asks the key to sign. The
 * ONLY accepted form is an EIP-191 personal message: the prefix, the decimal
 * UTF-8 byte length of the text, then the text. Returns the human-readable
 * text the approval screen must display.
 *
 * Anything else — raw strings (eth_sign), typed-data JSON, a string whose
 * bytes are an EIP-712 `\x19\x01…` preimage, a wrong length — throws: the key
 * would otherwise sign keccak256 of attacker-chosen bytes, which an ERC-1271
 * protocol may accept as authorisation.
 *
 * The split between length digits and text is unique: for a longer digit
 * prefix the declared length grows at least tenfold while the remaining text
 * shrinks, so at most one split can match.
 */
export function parseEip191Preimage(data: unknown): string {
  if (typeof data !== 'string' || !data.startsWith(EIP191_PREFIX)) {
    throw new Error('Not an EIP-191 personal message');
  }
  const rest = data.slice(EIP191_PREFIX.length);
  const digits = /^\d+/.exec(rest)?.[0] ?? '';
  if (!digits || (digits.length > 1 && digits.startsWith('0'))) {
    throw new Error('Not an EIP-191 personal message');
  }
  for (let k = 1; k <= digits.length; k += 1) {
    const declared = Number(digits.slice(0, k));
    const text = rest.slice(k);
    let length: number;
    try {
      length = utf8ByteLength(text);
    } catch {
      throw new Error('Message is not valid UTF-8 text');
    }
    if (length === declared && buildEip191Preimage(text) === data) {
      return text;
    }
  }
  throw new Error('EIP-191 length prefix does not match the message');
}
