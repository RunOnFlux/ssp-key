/**
 * Persistent record of enterprise Schnorr nonces this device has used.
 *
 * MuSig2 partial signatures leak the private key once the same nonce pair
 * signs three different messages (see the 2026-09 nonce-reuse audit). The
 * nonce pool itself is rewritten by two writers — vault signing removes a
 * nonce, replenish appends new ones — so a pool write built from a stale
 * snapshot could bring a used nonce back (K2). This ledger is the backstop:
 * an append-only list of used public nonces (kPublic) kept OUTSIDE the pool,
 * written synchronously to its own MMKV store before a partial signature is
 * produced, and consulted on every pool read and write.
 *
 * Public nonces are public (the relay holds them), so the ledger is stored in
 * the clear. It keeps the most recent MAX_TOMBSTONES entries; older ones can
 * only matter if a pool snapshot older than thousands of signatures were
 * written back, which the locked re-read in enterpriseNoncePool rules out.
 */
import { createMMKV } from 'react-native-mmkv';

const LEDGER_KEY = 'enterpriseUsedKPublic';
export const MAX_TOMBSTONES = 5000;

let ledgerStore: ReturnType<typeof createMMKV> | null = null;
const ledger = () => {
  if (!ledgerStore) {
    ledgerStore = createMMKV({ id: 'ssp-enterprise-nonce-ledger' });
  }
  return ledgerStore;
};

/** Every used kPublic currently recorded, oldest first. */
export function readUsedNonceTombstones(): string[] {
  const raw = ledger().getString(LEDGER_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : [];
  } catch {
    // A corrupt ledger must never be silently treated as "nothing used":
    // refuse, so the caller aborts instead of signing.
    throw new Error('Enterprise nonce ledger is unreadable');
  }
}

/** True when this public nonce has already been used by this device. */
export function isNonceTombstoned(kPublic: string): boolean {
  return readUsedNonceTombstones().includes(kPublic);
}

/** Removes every nonce whose kPublic is recorded as used. */
export function withoutTombstoned<T extends { kPublic: string }>(
  nonces: T[],
): T[] {
  const used = new Set(readUsedNonceTombstones());
  return nonces.filter((n) => !used.has(n.kPublic));
}

/**
 * Records a public nonce as used. Synchronous and verified: it throws unless
 * the entry reads back from storage, so a caller that proceeds to sign knows
 * the burn is on disk.
 */
export function recordUsedNonce(kPublic: string): void {
  if (typeof kPublic !== 'string' || !kPublic) {
    throw new Error('Cannot record an empty nonce as used');
  }
  const used = readUsedNonceTombstones();
  if (!used.includes(kPublic)) {
    used.push(kPublic);
  }
  const trimmed =
    used.length > MAX_TOMBSTONES ? used.slice(-MAX_TOMBSTONES) : used;
  ledger().set(LEDGER_KEY, JSON.stringify(trimmed));
  if (!readUsedNonceTombstones().includes(kPublic)) {
    throw new Error('Failed to persist the used enterprise nonce');
  }
}
