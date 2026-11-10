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
 *
 * One signing session at a time (KAS-3): every Kaspa signing path runs its
 * whole open → reconcile → sign → flush inside `withKasLedgerLock`, so two
 * overlapping approvals can never start from the same snapshot. As a second
 * line, `flush()` re-reads the stored blob and merges this session's changes
 * on top; an outpoint another writer changed to a DIFFERENT amount since this
 * session opened is a conflict and fails closed.
 *
 * Poisoned entries (KAS-2): one lying UTXO answer used to block an outpoint
 * forever. `reconcileKasLedgerClaims` proves the real amount from the
 * outpoint's funding transaction (its ID commits to the amount, so a server
 * cannot forge it) and replaces a provably wrong entry; an entry the chain
 * proves right keeps refusing; an unprovable conflict can only be cleared by
 * an explicit, warned, per-outpoint reset (`resetKasLedgerOutpoints`).
 */
import type { SignedAmountLedger } from '@runonflux/kaspa-core';
import { storage } from '../store/index';

export const KAS_LEDGER_STORAGE_KEY = 'kasSignedAmounts';
/** Prefix of the key a quarantined (corrupt) ledger blob is moved to. */
export const KAS_LEDGER_QUARANTINE_PREFIX = 'kasSignedAmounts.corrupt.';
/** Prefix of the key the entries removed by a per-outpoint reset are kept under. */
export const KAS_LEDGER_RESET_PREFIX = 'kasSignedAmounts.reset.';
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

/** Another writer changed an outpoint this session signed (fail closed). */
export class KasLedgerConcurrentWriteError extends Error {
  constructor() {
    super(
      'Kaspa signed-amount ledger changed under this signing session; refusing to release the signatures',
    );
    this.name = 'KasLedgerConcurrentWriteError';
  }
}

/**
 * This device signed outpoints of the transaction under a different amount
 * (KAS-2), and the conflict could not be resolved by a proof:
 * - `refused`: the funding transaction proves the RECORDED amount right (or
 *   proves the claimed one wrong): the UTXO source is lying. Never resettable
 *   from here.
 * - `unprovable`: the real amount cannot be proven right now; only an
 *   explicit per-outpoint reset (`resetKasLedgerOutpoints`) clears it.
 */
export class KasLedgerConflictError extends Error {
  readonly refused: string[];
  readonly unprovable: string[];
  constructor(refused: string[], unprovable: string[]) {
    super(
      `Kaspa signed-amount conflict: ${String(refused.length)} outpoint(s) contradicted by a proof, ${String(unprovable.length)} unprovable`,
    );
    this.name = 'KasLedgerConflictError';
    this.refused = refused;
    this.unprovable = unprovable;
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

function readStored(): Map<string, LedgerEntry> {
  const raw = storage.getString(KAS_LEDGER_STORAGE_KEY);
  return raw ? parse(raw) : new Map<string, LedgerEntry>();
}

function sameEntry(a?: LedgerEntry, b?: LedgerEntry): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.amount === b.amount && a.at === b.at;
}

/**
 * Make room for `incoming` new entries: evict the least recently signed
 * entries that are at least KAS_LEDGER_MIN_AGE_MS old. Throws
 * KasLedgerFullError (refuse to sign) rather than drop a younger guard.
 * Returns the evicted keys.
 */
function evictFor(
  map: Map<string, LedgerEntry>,
  incoming: number,
  t: number,
): string[] {
  const excess = map.size + incoming - KAS_LEDGER_MAX_ENTRIES;
  if (excess <= 0) return [];
  const victims: string[] = [];
  for (const [k, e] of map) {
    if (victims.length >= excess) break;
    if (t - e.at >= KAS_LEDGER_MIN_AGE_MS) victims.push(k);
  }
  if (victims.length < excess) throw new KasLedgerFullError();
  victims.forEach((k) => map.delete(k));
  return victims;
}

/**
 * Load the ledger once for one signing operation. Throws
 * KasLedgerCorruptError on an unreadable blob (fail closed). Open it INSIDE
 * `withKasLedgerLock`.
 */
export function openKasLedger(now: () => number = Date.now): KasLedger {
  const map = readStored();
  // What this session saw, to recognise another writer's changes at flush.
  let baseline = new Map(map);
  // This session's changes: an entry it set, or null for one it evicted.
  const touched = new Map<string, LedgerEntry | null>();
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
      // Evict the least recently signed entries that are old enough.
      for (const k of evictFor(map, 1, t)) touched.set(k, null);
      const entry = { amount, at: t };
      map.set(key, entry);
      touched.set(key, entry);
      dirty = true;
    },
    flush(): void {
      if (!dirty) return;
      // Re-read and merge this session's changes on top (KAS-3).
      const fresh = readStored();
      for (const [k, mine] of touched) {
        const current = fresh.get(k);
        const changedSinceOpen = !sameEntry(baseline.get(k), current);
        if (mine === null) {
          // Only evict the entry this session saw; a re-signed one stays.
          if (!changedSinceOpen) fresh.delete(k);
          continue;
        }
        if (
          changedSinceOpen &&
          current !== undefined &&
          current.amount !== mine.amount
        ) {
          throw new KasLedgerConcurrentWriteError();
        }
        fresh.delete(k);
        fresh.set(k, mine);
      }
      // Another writer may have added entries: keep the size bound.
      if (fresh.size > KAS_LEDGER_MAX_ENTRIES) evictFor(fresh, 0, now());
      storage.set(KAS_LEDGER_STORAGE_KEY, serialize(fresh));
      baseline = new Map(fresh);
      touched.clear();
      dirty = false;
    },
  };
}

// ---------------------------------------------------------------------------
// One signing session at a time (KAS-3)
// ---------------------------------------------------------------------------

let ledgerLock: Promise<unknown> = Promise.resolve();

/**
 * Run one Kaspa signing session (open the ledger → reconcile → sign → flush)
 * with no other session in between. Every Kaspa signing path goes through
 * here; sessions queue in call order.
 */
export function withKasLedgerLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = ledgerLock.then(() => fn());
  ledgerLock = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Conflicts: prove, overwrite, or refuse (KAS-2)
// ---------------------------------------------------------------------------

/** An outpoint (`txid:index`) and the amount the transaction claims for it. */
export interface KasLedgerClaim {
  outpoint: string;
  amount: bigint;
}

/**
 * The real amount of output `index` of transaction `txid`, PROVEN by the
 * transaction's ID (lib/kaspa.ts `kasProveOutpointAmount`). Throws when it
 * cannot be proven.
 */
export type KasAmountProver = (txid: string, index: number) => Promise<bigint>;

/**
 * Before signing: for every claimed outpoint this device already signed
 * under a DIFFERENT amount, prove the real amount:
 * - proven ≠ recorded: the recorded signature can never verify on chain, so
 *   the entry is replaced by the PROVEN amount (`signTransaction` then signs
 *   only if the claim equals it; a claim that differs from the proof is a lie
 *   and is reported as `refused` too);
 * - proven = recorded: the claim is a lie — keep refusing (`refused`);
 * - not provable: `unprovable` (cleared only by an explicit reset).
 * Throws KasLedgerConflictError when anything is refused or unprovable, so
 * nothing is signed. Returns the outpoints whose entry was replaced.
 */
export async function reconcileKasLedgerClaims(
  ledger: KasLedger,
  claims: readonly KasLedgerClaim[],
  prove: KasAmountProver,
): Promise<string[]> {
  const refused: string[] = [];
  const unprovable: string[] = [];
  const overwritten: string[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    const outpoint = claim.outpoint.toLowerCase();
    if (seen.has(outpoint)) continue;
    seen.add(outpoint);
    const recorded = ledger.get(outpoint);
    if (recorded === undefined || recorded === claim.amount) continue;
    if (!OUTPOINT_RE.test(outpoint)) {
      unprovable.push(outpoint);
      continue;
    }
    const [txid, index] = outpoint.split(':');
    let proven: bigint;
    try {
      proven = await prove(txid, Number(index));
    } catch {
      unprovable.push(outpoint);
      continue;
    }
    if (proven === recorded) {
      refused.push(outpoint);
      continue;
    }
    ledger.set(outpoint, proven);
    overwritten.push(outpoint);
    if (proven !== claim.amount) refused.push(outpoint);
  }
  if (refused.length > 0 || unprovable.length > 0) {
    throw new KasLedgerConflictError(refused, unprovable);
  }
  return overwritten;
}

/**
 * Explicit, user-confirmed reset of single outpoints (an UNPROVABLE
 * conflict). The removed entries are kept under
 * `kasSignedAmounts.reset.<ms>` (never read again). Refuses (throws) for an
 * outpoint that is not in the ledger, and on an unreadable ledger. One
 * synchronous read-modify-write. Returns how many entries were removed.
 */
export function resetKasLedgerOutpoints(
  outpoints: readonly string[],
  now: () => number = Date.now,
): number {
  if (outpoints.length === 0) return 0;
  const map = readStored();
  const removed: Record<string, string> = {};
  for (const o of outpoints) {
    const key = o.toLowerCase();
    const e = map.get(key);
    if (!OUTPOINT_RE.test(key) || e === undefined) {
      throw new Error('Kaspa outpoint is not in the signed-amount ledger');
    }
    removed[key] = `${e.amount.toString()}@${String(e.at)}`;
  }
  Object.keys(removed).forEach((k) => map.delete(k));
  storage.set(
    `${KAS_LEDGER_RESET_PREFIX}${String(now())}`,
    JSON.stringify(removed),
  );
  storage.set(KAS_LEDGER_STORAGE_KEY, serialize(map));
  return Object.keys(removed).length;
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
