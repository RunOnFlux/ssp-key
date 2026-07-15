/**
 * EVM calldata human decode — PRESENTATION LAYER ONLY.
 *
 * Recognizes the most common ERC-20 selectors and returns structured,
 * plain-language data for the approval screen. This never changes what gets
 * signed — the approval always signs the exact original payload; this helper
 * only re-presents bytes that were previously shown as raw hex.
 *
 * Fail-closed contract: anything unexpected (unknown selector, wrong length,
 * malformed hex, non-standard address padding) returns null and the UI falls
 * back to a generic action + raw hex behind "Advanced". Token symbol/decimals
 * are only attached when confidently known from the on-device token registry
 * (storage/blockchains) — never guessed.
 */

import { getAddress } from 'viem';
import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';

// 4-byte function selectors (keccak256 of the canonical signature)
const SELECTOR_TRANSFER = 'a9059cbb'; // transfer(address,uint256)
const SELECTOR_APPROVE = '095ea7b3'; // approve(address,uint256)
const SELECTOR_TRANSFER_FROM = '23b872dd'; // transferFrom(address,address,uint256)

const WORD_HEX_LEN = 64; // 32 bytes
const SELECTOR_HEX_LEN = 8; // 4 bytes

const MAX_UINT256 = (1n << 256n) - 1n;

export type DecodedCalldataKind = 'transfer' | 'approve' | 'transferFrom';

export interface DecodedCalldata {
  kind: DecodedCalldataKind;
  /** Token contract the calldata targets (as supplied by the caller). */
  contract: string;
  /**
   * The counterparty to show as the recipient card:
   * transfer / transferFrom → tokens recipient, approve → the spender.
   */
  counterparty: string;
  /** transferFrom only — the address tokens are pulled from. */
  from?: string;
  /** Raw amount in base units, decimal string. Always present. */
  amountRaw: string;
  /** Human amount — only when decimals are confidently known on-device. */
  amount?: string;
  /** Token symbol — only when known from the on-device registry. */
  tokenSymbol?: string;
  /** Known token decimals used to compute `amount`. */
  tokenDecimals?: number;
  /** True when amount is the max-uint256 sentinel (unlimited approval). */
  unlimited: boolean;
  /** Plain-English fallback summary (UI prefers i18n from structured fields). */
  summary: string;
}

/** Format a base-unit bigint to a human decimal string. */
function formatUnits(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  if (frac === 0n) {
    return whole.toString();
  }
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

/**
 * Parse an ABI-encoded address word. Returns a checksummed address, or null
 * when the word is not a canonically padded address (12 zero bytes prefix) —
 * a non-canonical word on a signing screen is suspicious, so fail closed.
 */
function parseAddressWord(word: string): string | null {
  if (word.length !== WORD_HEX_LEN) {
    return null;
  }
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(word)) {
    return null;
  }
  try {
    return getAddress(`0x${word.slice(24)}`);
  } catch {
    return null;
  }
}

/** Parse an ABI-encoded uint256 word. */
function parseUintWord(word: string): bigint | null {
  if (word.length !== WORD_HEX_LEN || !/^[0-9a-fA-F]{64}$/.test(word)) {
    return null;
  }
  return BigInt(`0x${word}`);
}

/** Look up a token in the on-device registry by contract address. */
function findRegistryToken(
  contract: string,
  chain?: keyof cryptos,
): { symbol: string; decimals: number } | null {
  if (
    !chain ||
    !blockchains[chain] ||
    !Array.isArray(blockchains[chain].tokens)
  ) {
    return null;
  }
  const needle = contract.toLowerCase();
  const token = blockchains[chain].tokens.find(
    (candidate) =>
      candidate.contract && candidate.contract.toLowerCase() === needle,
  );
  if (!token || !token.symbol || typeof token.decimals !== 'number') {
    return null;
  }
  return { symbol: token.symbol, decimals: token.decimals };
}

/**
 * Decode ERC-20 transfer / approve / transferFrom calldata into
 * plain-language display data. Returns null for anything unrecognized.
 */
export function decodeErc20Calldata(
  data: string,
  contract: string,
  chain?: keyof cryptos,
): DecodedCalldata | null {
  if (typeof data !== 'string' || typeof contract !== 'string' || !contract) {
    return null;
  }
  const trimmed = data.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(trimmed)) {
    return null;
  }
  const hex = trimmed.slice(2);
  if (hex.length < SELECTOR_HEX_LEN) {
    return null;
  }
  const selector = hex.slice(0, SELECTOR_HEX_LEN).toLowerCase();
  const argsHex = hex.slice(SELECTOR_HEX_LEN);

  let kind: DecodedCalldataKind;
  let wordCount: number;
  if (selector === SELECTOR_TRANSFER) {
    kind = 'transfer';
    wordCount = 2;
  } else if (selector === SELECTOR_APPROVE) {
    kind = 'approve';
    wordCount = 2;
  } else if (selector === SELECTOR_TRANSFER_FROM) {
    kind = 'transferFrom';
    wordCount = 3;
  } else {
    return null;
  }

  // Exact canonical length only — extra or missing bytes on a signing screen
  // mean we do not understand the payload well enough to summarize it.
  if (argsHex.length !== wordCount * WORD_HEX_LEN) {
    return null;
  }
  const words: string[] = [];
  for (let i = 0; i < wordCount; i += 1) {
    words.push(argsHex.slice(i * WORD_HEX_LEN, (i + 1) * WORD_HEX_LEN));
  }

  let counterparty: string | null;
  let from: string | undefined;
  let amountBig: bigint | null;
  if (kind === 'transferFrom') {
    const fromAddr = parseAddressWord(words[0]);
    counterparty = parseAddressWord(words[1]);
    amountBig = parseUintWord(words[2]);
    if (!fromAddr) {
      return null;
    }
    from = fromAddr;
  } else {
    counterparty = parseAddressWord(words[0]);
    amountBig = parseUintWord(words[1]);
  }
  if (!counterparty || amountBig === null) {
    return null;
  }

  const unlimited = amountBig === MAX_UINT256;
  const registry = findRegistryToken(contract, chain);
  const amount =
    registry && !unlimited
      ? formatUnits(amountBig, registry.decimals)
      : undefined;
  const tokenSymbol = registry?.symbol;

  const amountText = unlimited
    ? 'unlimited'
    : amount && tokenSymbol
      ? `${amount} ${tokenSymbol}`
      : `${amountBig.toString()} base units of token ${contract}`;
  let summary: string;
  if (kind === 'transfer') {
    summary = `Transfer ${amountText} to ${counterparty}`;
  } else if (kind === 'approve') {
    summary = `Approve spender ${counterparty} for ${amountText}`;
  } else {
    summary = `Transfer ${amountText} from ${from ?? ''} to ${counterparty}`;
  }

  return {
    kind,
    contract,
    counterparty,
    from,
    amountRaw: amountBig.toString(),
    amount,
    tokenSymbol,
    tokenDecimals: registry?.decimals,
    unlimited,
    summary,
  };
}
