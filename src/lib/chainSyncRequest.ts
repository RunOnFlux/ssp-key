/**
 * Batch chain sync request ("chainsyncrequest" action) — parsing and
 * validation of the wallet-supplied payload.
 *
 * Protocol (version 1):
 *   payload = JSON.stringify({
 *     version: 1,
 *     chains: [{ chain: 'eth', xpubWallet: 'xpub...' }, ...],
 *   })
 *
 * The wallet posts this over the existing authenticated relay action
 * transport once identity pairing is complete. The key shows ONE approval
 * naming all requested chains, then answers per chain through the existing
 * POST /v1/sync mechanism — the response endpoint and payload are unchanged
 * so old wallets keep working (compatibility invariant: protocol changes are
 * versioned and safe in both mixed-version directions).
 *
 * Pure logic only — no crypto, no I/O — so it is fully unit-testable.
 */

import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../types';

export const CHAIN_SYNC_REQUEST_VERSION = 1;
export const CHAIN_SYNC_MAX_CHAINS = 20;
/**
 * Spacing between per-chain POST /v1/sync calls. The relay sync document is
 * last-write-wins keyed on walletIdentity and the wallet polls it every 1s —
 * posting faster than the poll interval could make the wallet miss a chain.
 */
export const CHAIN_SYNC_POST_SPACING_MS = 1500;

const MAX_XPUB_LENGTH = 3000; // solana pubkey arrays are ~950 chars; xpubs ~112

const xpubRegex = /^([a-zA-Z]{2}ub[1-9A-HJ-NP-Za-km-z]{79,140})$/;

// Solana repurposes the "xpub" field as a JSON-stringified array of 20
// unique base58-encoded Ed25519 leaf pubkeys.
function isSolanaPubkeyArrayString(input: string): boolean {
  try {
    const arr: unknown = JSON.parse(input.trim());
    if (!Array.isArray(arr) || arr.length !== 20) return false;
    const base58Pk = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const seen = new Set<string>();
    for (const pk of arr) {
      if (typeof pk !== 'string' || !base58Pk.test(pk)) return false;
      if (seen.has(pk)) return false;
      seen.add(pk);
    }
    return true;
  } catch {
    return false;
  }
}

export interface ChainSyncRequestEntry {
  chain: keyof cryptos;
  xpubWallet: string;
}

export interface ParsedChainSyncRequest {
  version: number;
  chains: ChainSyncRequestEntry[];
}

export type ChainSyncParseResult =
  | { status: 'ok'; request: ParsedChainSyncRequest }
  | { status: 'unsupported_version'; version: number }
  | { status: 'invalid'; reason: string };

/**
 * Parse and validate a chainsyncrequest payload.
 *
 * - version must be a positive integer; a version newer than what this build
 *   understands returns 'unsupported_version' so the caller can reject the
 *   request and the wallet falls back to per-chain QR sync.
 * - every chain must exist in the on-device chain registry (never trust the
 *   relay-supplied list blindly);
 * - the identity chain is never allowed — identity pairing is QR-only and a
 *   remote action must not be able to rewrite it;
 * - each wallet xpub must be well-formed for the chain type;
 * - duplicate chains are rejected (a well-formed wallet never sends them).
 */
export function parseChainSyncRequest(
  payload: string,
  identityChain: keyof cryptos,
): ChainSyncParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { status: 'invalid', reason: 'not_json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'invalid', reason: 'not_object' };
  }
  const obj = parsed as Record<string, unknown>;
  const version = obj.version;
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return { status: 'invalid', reason: 'bad_version' };
  }
  if (version > CHAIN_SYNC_REQUEST_VERSION) {
    return { status: 'unsupported_version', version };
  }
  const chains = obj.chains;
  if (!Array.isArray(chains) || chains.length < 1) {
    return { status: 'invalid', reason: 'no_chains' };
  }
  if (chains.length > CHAIN_SYNC_MAX_CHAINS) {
    return { status: 'invalid', reason: 'too_many_chains' };
  }
  const seen = new Set<string>();
  const seenXpubs = new Set<string>();
  const entries: ChainSyncRequestEntry[] = [];
  for (const item of chains) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { status: 'invalid', reason: 'bad_entry' };
    }
    const entry = item as Record<string, unknown>;
    const chain = entry.chain;
    const xpubWallet = entry.xpubWallet;
    if (typeof chain !== 'string' || !(chain in blockchains)) {
      return { status: 'invalid', reason: 'unknown_chain' };
    }
    if (chain === identityChain) {
      return { status: 'invalid', reason: 'identity_chain_not_allowed' };
    }
    if (seen.has(chain)) {
      return { status: 'invalid', reason: 'duplicate_chain' };
    }
    seen.add(chain);
    if (
      typeof xpubWallet !== 'string' ||
      xpubWallet.length === 0 ||
      xpubWallet.length > MAX_XPUB_LENGTH
    ) {
      return { status: 'invalid', reason: 'bad_xpub' };
    }
    const chainType = blockchains[chain as keyof cryptos].chainType;
    const xpubValid =
      chainType === 'sol'
        ? isSolanaPubkeyArrayString(xpubWallet)
        : xpubRegex.test(xpubWallet);
    if (!xpubValid) {
      return { status: 'invalid', reason: 'bad_xpub' };
    }
    // Each chain derives a distinct extended key; the same xpub on two
    // chains is never produced by a well-formed wallet.
    if (seenXpubs.has(xpubWallet)) {
      return { status: 'invalid', reason: 'duplicate_xpub' };
    }
    seenXpubs.add(xpubWallet);
    entries.push({
      chain: chain as keyof cryptos,
      xpubWallet,
    });
  }
  return { status: 'ok', request: { version, chains: entries } };
}

/**
 * Build the payload for a chainsyncrejected response action. Always carries
 * the key's own protocol version so a future wallet can distinguish "old key"
 * from "declined".
 */
export function buildChainSyncRejectionPayload(
  reason: 'declined' | 'unsupported_version' | 'invalid',
): string {
  return JSON.stringify({ version: CHAIN_SYNC_REQUEST_VERSION, reason });
}

/** "BTC, ETH, FLUX" style symbol list for the approval copy. */
export function chainSyncSymbols(chains: (keyof cryptos)[]): string {
  return chains
    .map((chain) => blockchains[chain]?.symbol ?? String(chain))
    .join(', ');
}
