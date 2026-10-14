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
 * Stored in MMKV under its own key. It holds no secrets — only public
 * outpoints and amounts — so it is not encrypted, and it is never cleared on
 * wallet reset: dropping it only removes protection.
 *
 * Per-signing snapshot: `openKasLedger()` reads and parses the blob ONCE;
 * `get` answers from memory and `set` only buffers. The caller MUST `flush()`
 * after `signTransaction` and BEFORE the signatures leave the device
 * (broadcast or relay post), so a crash can never lose an entry for a
 * signature that was released. A failed flush aborts the release. (Reading
 * and writing per call cost an 80-input consolidation ~160 full parses of up
 * to 1.8 MB.)
 *
 * Values are `amount@signedAtMs`; a legacy bare `amount` still reads (as
 * signed at time 0). Keys stay lowercase `txid:index`.
 *
 * Eviction (bounded size): past KAS_LEDGER_MAX_ENTRIES only entries older
 * than KAS_LEDGER_MIN_AGE_MS are dropped, least recently signed first. If the
 * ledger is full of younger entries, `set` throws KasLedgerFullError and the
 * signature is refused — a fresh guard is never silently dropped (flooding
 * the ledger with dust inputs to evict a guard is exactly the attack).
 *
 * A blob that cannot be read fails CLOSED (KasLedgerCorruptError): signing
 * stops until the user explicitly resets it (`quarantineCorruptKasLedger`,
 * which keeps the bad blob under another key and starts empty).
 */
import type { SignedAmountLedger } from '@runonflux/kaspa-core';
import { storage } from '../store/index';

export const KAS_LEDGER_STORAGE_KEY = 'kasSignedAmounts';
/** Prefix of the key a quarantined (corrupt) ledger blob is moved to. */
export const KAS_LEDGER_QUARANTINE_PREFIX = 'kasSignedAmounts.corrupt.';
/** Maximum number of outpoints kept. */
export const KAS_LEDGER_MAX_ENTRIES = 20000;
/** Entries younger than this are never evicted (30 days). */
export const KAS_LEDGER_MIN_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const OUTPOINT_RE = /^[0-9a-f]{64}:\d{1,10}$/;
const VALUE_RE = /^(\d+)(?:@(\d{1,16}))?$/;

export class KasLedgerCorruptError extends Error {
  constructor() {
    super('Kaspa signed-amount ledger is corrupt');
    this.name = 'KasLedgerCorruptError';
  }
}

export class KasLedgerFullError extends Error {
  constructor() {
    super(
      'Kaspa signed-amount ledger is full of recent entries; refusing to sign until older entries age out',
    );
    this.name = 'KasLedgerFullError';
  }
}

interface LedgerEntry {
  amount: bigint;
  at: number;
}

/** The ledger one signing operation uses. `flush()` persists buffered sets. */
export interface KasLedger extends SignedAmountLedger {
  flush(): void;
}

function parse(raw: string): Map<string, LedgerEntry> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new KasLedgerCorruptError();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new KasLedgerCorruptError();
  }
  const map = new Map<string, LedgerEntry>();
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const m = typeof v === 'string' ? VALUE_RE.exec(v) : null;
    if (!OUTPOINT_RE.test(k) || !m) throw new KasLedgerCorruptError();
    map.set(k, { amount: BigInt(m[1]), at: m[2] ? Number(m[2]) : 0 });
  }
  return map;
}

function serialize(map: Map<string, LedgerEntry>): string {
  const out: Record<string, string> = {};
  for (const [k, e] of map) out[k] = `${e.amount.toString()}@${String(e.at)}`;
  return JSON.stringify(out);
}

/**
 * Load the ledger once for one signing operation. Throws
 * KasLedgerCorruptError on an unreadable blob (fail closed).
 */
export function openKasLedger(now: () => number = Date.now): KasLedger {
  const raw = storage.getString(KAS_LEDGER_STORAGE_KEY);
  const map = raw ? parse(raw) : new Map<string, LedgerEntry>();
  let dirty = false;
  return {
    get(outpoint: string): bigint | undefined {
      return map.get(outpoint.toLowerCase())?.amount;
    },
    set(outpoint: string, amount: bigint): void {
      const key = outpoint.toLowerCase();
      if (!OUTPOINT_RE.test(key)) {
        throw new Error('Invalid Kaspa outpoint for the signed-amount ledger');
      }
      const t = now();
      map.delete(key); // re-insert so insertion order tracks recency
      if (map.size >= KAS_LEDGER_MAX_ENTRIES) {
        // Evict the least recently signed entries that are old enough.
        const excess = map.size - KAS_LEDGER_MAX_ENTRIES + 1;
        const victims: string[] = [];
        for (const [k, e] of map) {
          if (victims.length >= excess) break;
          if (t - e.at >= KAS_LEDGER_MIN_AGE_MS) victims.push(k);
        }
        if (victims.length < excess) throw new KasLedgerFullError();
        victims.forEach((k) => map.delete(k));
      }
      map.set(key, { amount, at: t });
      dirty = true;
    },
    flush(): void {
      if (!dirty) return;
      storage.set(KAS_LEDGER_STORAGE_KEY, serialize(map));
      dirty = false;
    },
  };
}

/** True if a ledger blob exists and cannot be read. */
export function isKasLedgerCorrupt(): boolean {
  const raw = storage.getString(KAS_LEDGER_STORAGE_KEY);
  if (!raw) return false;
  try {
    parse(raw);
    return false;
  } catch {
    return true;
  }
}

/**
 * Recovery for a corrupt ledger — ONLY after an explicit user confirmation
 * (lib/kaspaLedgerRecovery.ts). Moves the unreadable blob to
 * `kasSignedAmounts.corrupt.<ms>` (kept for diagnosis, never read again) and
 * starts an empty ledger. Refuses (returns false) when the ledger is
 * readable, so it can never be used to wipe a healthy ledger.
 */
export function quarantineCorruptKasLedger(
  now: () => number = Date.now,
): boolean {
  if (!isKasLedgerCorrupt()) return false;
  const raw = storage.getString(KAS_LEDGER_STORAGE_KEY) as string;
  storage.set(`${KAS_LEDGER_QUARANTINE_PREFIX}${String(now())}`, raw);
  storage.set(KAS_LEDGER_STORAGE_KEY, '{}');
  return true;
}
