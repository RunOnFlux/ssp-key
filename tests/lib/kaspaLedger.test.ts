import {
  KAS_LEDGER_MAX_ENTRIES,
  KAS_LEDGER_MIN_AGE_MS,
  KAS_LEDGER_QUARANTINE_PREFIX,
  KAS_LEDGER_STORAGE_KEY,
  KasLedgerCorruptError,
  KasLedgerFullError,
  isKasLedgerCorrupt,
  openKasLedger,
  quarantineCorruptKasLedger,
} from '../../src/lib/kaspaLedger';
import { storage } from '../../src/store/index';

/**
 * Persistent signed-amount ledger (contract §4.3): one parse per signing
 * operation, buffered writes flushed once, fail closed on corruption with an
 * explicit quarantine reset, and age-guarded eviction.
 */

const op = (n: number, index = 0) =>
  `${n.toString(16).padStart(64, '0')}:${String(index)}`;

const raw = () => storage.getString(KAS_LEDGER_STORAGE_KEY);
const stored = () => JSON.parse(raw() as string) as Record<string, string>;

// The jest MMKV mock exposes `delete`; the real v4 instance `remove`.
const mmkv = storage as unknown as {
  delete?: (k: string) => void;
  remove?: (k: string) => boolean;
};
const del = (k: string) => {
  if (typeof mmkv.remove === 'function') mmkv.remove(k);
  else mmkv.delete?.(k);
};

beforeEach(() => {
  for (const k of storage.getAllKeys()) {
    if (k.startsWith(KAS_LEDGER_STORAGE_KEY)) del(k);
  }
});

describe('openKasLedger (per-signing snapshot)', () => {
  it('reads the blob once, answers get from memory and writes once on flush', () => {
    storage.set(
      KAS_LEDGER_STORAGE_KEY,
      JSON.stringify({ [op(1)]: '100@1', [op(2)]: '200' }), // legacy value too
    );
    const getString = jest.spyOn(storage, 'getString');
    const set = jest.spyOn(storage, 'set');
    const ledger = openKasLedger(() => 5000);
    expect(getString).toHaveBeenCalledTimes(1);
    // 80-input consolidation: 80 gets + 80 sets, no storage traffic
    for (let i = 10; i < 90; i += 1) {
      expect(ledger.get(op(i))).toBeUndefined();
      ledger.set(op(i), BigInt(i));
    }
    expect(ledger.get(op(1))).toBe(100n);
    expect(ledger.get(op(2))).toBe(200n);
    expect(ledger.get(op(50).toUpperCase())).toBe(50n); // case-insensitive
    expect(getString).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    ledger.flush();
    expect(set).toHaveBeenCalledTimes(1);
    ledger.flush(); // nothing new: no second write
    expect(set).toHaveBeenCalledTimes(1);
    getString.mockRestore();
    set.mockRestore();
    // same key format, amount@signedAt values, legacy entries preserved
    const s = stored();
    expect(Object.keys(s)).toHaveLength(82);
    expect(s[op(1)]).toBe('100@1');
    expect(s[op(2)]).toBe('200@0');
    expect(s[op(10)]).toBe('10@5000');
    // a later session reads what was flushed
    expect(openKasLedger().get(op(89))).toBe(89n);
  });

  it('buffers nothing to storage without a flush (caller must flush)', () => {
    const ledger = openKasLedger();
    ledger.set(op(1), 1n);
    expect(raw()).toBeUndefined();
  });

  it('refuses malformed outpoints', () => {
    expect(() => openKasLedger().set('nope', 1n)).toThrow(/Invalid Kaspa/);
  });
});

describe('corrupt ledger: fail closed + explicit quarantine', () => {
  it.each([
    ['not JSON', '{oops'],
    ['an array', '[1,2]'],
    ['a bad amount', JSON.stringify({ [op(1)]: 'x' })],
    ['a bad key', JSON.stringify({ nope: '1' })],
  ])('refuses %s instead of treating it as empty', (_label, blob) => {
    storage.set(KAS_LEDGER_STORAGE_KEY, blob);
    expect(() => openKasLedger()).toThrow(KasLedgerCorruptError);
    expect(isKasLedgerCorrupt()).toBe(true);
  });

  it('quarantine moves the corrupt blob aside and starts empty', () => {
    storage.set(KAS_LEDGER_STORAGE_KEY, '{oops');
    expect(quarantineCorruptKasLedger(() => 42)).toBe(true);
    expect(storage.getString(`${KAS_LEDGER_QUARANTINE_PREFIX}42`)).toBe(
      '{oops',
    );
    expect(raw()).toBe('{}');
    expect(isKasLedgerCorrupt()).toBe(false);
    expect(openKasLedger().get(op(1))).toBeUndefined();
  });

  it('quarantine never wipes a readable ledger', () => {
    storage.set(KAS_LEDGER_STORAGE_KEY, JSON.stringify({ [op(1)]: '5@1' }));
    expect(quarantineCorruptKasLedger()).toBe(false);
    expect(openKasLedger().get(op(1))).toBe(5n);
    expect(
      storage
        .getAllKeys()
        .some((k) => k.startsWith(KAS_LEDGER_QUARANTINE_PREFIX)),
    ).toBe(false);
  });
});

describe('eviction', () => {
  const NOW = 100 * KAS_LEDGER_MIN_AGE_MS;

  function fill(at: (i: number) => number) {
    const blob: Record<string, string> = {};
    for (let i = 0; i < KAS_LEDGER_MAX_ENTRIES; i += 1) {
      blob[op(i + 1)] = `${String(i + 1)}@${String(at(i))}`;
    }
    storage.set(KAS_LEDGER_STORAGE_KEY, JSON.stringify(blob));
  }

  it('evicts the least recently signed entry older than 30 days', () => {
    fill(() => NOW - KAS_LEDGER_MIN_AGE_MS - 1); // all old enough
    const ledger = openKasLedger(() => NOW);
    ledger.set(op(999999), 7n);
    expect(ledger.get(op(1))).toBeUndefined(); // oldest insertion evicted
    expect(ledger.get(op(2))).toBe(2n);
    expect(ledger.get(op(999999))).toBe(7n);
    ledger.flush();
    expect(Object.keys(stored())).toHaveLength(KAS_LEDGER_MAX_ENTRIES);
  });

  it('skips fresh entries and evicts an older one further in', () => {
    // first 10 insertions are fresh (re-signed recently), the 11th is old
    fill((i) => (i === 10 ? 0 : NOW - 1000));
    const ledger = openKasLedger(() => NOW);
    ledger.set(op(999999), 7n);
    expect(ledger.get(op(1))).toBe(1n); // fresh: kept
    expect(ledger.get(op(11))).toBeUndefined(); // old: evicted
  });

  it('refuses to sign rather than evict entries younger than 30 days', () => {
    fill(() => NOW - KAS_LEDGER_MIN_AGE_MS + 1);
    const ledger = openKasLedger(() => NOW);
    expect(() => ledger.set(op(999999), 7n)).toThrow(KasLedgerFullError);
    expect(ledger.get(op(1))).toBe(1n);
    // re-signing an outpoint already present never needs eviction
    expect(() => ledger.set(op(5), 5n)).not.toThrow();
  });
});
