/**
 * Persistent Kaspa signed-amount ledger (outpoint → amount in sompi).
 *
 * Kaspa's signature hash commits only to the amount of the input being
 * signed, so a lying co-signer or UTXO source could collect signatures for
 * different inputs across separate sessions — each lying about a different
 * input — and combine them into one transaction with a huge real fee. The
 * ledger lets kaspa-core refuse to sign an outpoint again under a different
 * amount (KASPA_SSP_CONTRACT.md §4.3, kaspa-core SECURITY.md).
 *
 * Stored in MMKV under its own key and written synchronously on every
 * `set`, so it survives app restarts and crashes (redux-persist writes are
 * debounced and could lose the last entry). It holds no secrets — only
 * public outpoints and amounts — so it is not encrypted, and it is never
 * cleared on wallet reset: dropping it only removes protection.
 */
import type { SignedAmountLedger } from '@runonflux/kaspa-core';
import { storage } from '../store/index';

export const KAS_LEDGER_STORAGE_KEY = 'kasSignedAmounts';
/**
 * Oldest entries are dropped past this size. Every entry is a spent-or-soon-
 * spent outpoint, so only a UTXO that stays unspent across this many later
 * signatures loses its guard.
 */
export const KAS_LEDGER_MAX_ENTRIES = 20000;

const OUTPOINT_RE = /^[0-9a-f]{64}:\d{1,10}$/;

type LedgerMap = Record<string, string>;

function load(): LedgerMap {
  const raw = storage.getString(KAS_LEDGER_STORAGE_KEY);
  if (!raw) return {};
  // A corrupt ledger must not silently turn into an empty one (that would
  // remove every guard): refuse to sign until it is readable.
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Kaspa signed-amount ledger is corrupt');
  }
  return parsed as LedgerMap;
}

export const kasSignedAmountLedger: SignedAmountLedger = {
  get(outpoint: string): bigint | undefined {
    const v = load()[outpoint.toLowerCase()];
    if (v === undefined) return undefined;
    if (!/^\d+$/.test(v)) {
      throw new Error('Kaspa signed-amount ledger is corrupt');
    }
    return BigInt(v);
  },
  set(outpoint: string, amount: bigint): void {
    const key = outpoint.toLowerCase();
    if (!OUTPOINT_RE.test(key)) {
      throw new Error('Invalid Kaspa outpoint for the signed-amount ledger');
    }
    const map = load();
    delete map[key]; // re-insert so insertion order tracks recency
    map[key] = amount.toString();
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length - KAS_LEDGER_MAX_ENTRIES; i += 1) {
      delete map[keys[i]];
    }
    storage.set(KAS_LEDGER_STORAGE_KEY, JSON.stringify(map));
  },
};
