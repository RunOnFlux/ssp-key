import * as K from '@runonflux/kaspa-core';
import {
  KAS_LEDGER_MAX_ENTRIES,
  KAS_LEDGER_MIN_AGE_MS,
  KAS_LEDGER_QUARANTINE_PREFIX,
  KAS_LEDGER_RESET_PREFIX,
  KAS_LEDGER_STORAGE_KEY,
  KasLedgerConcurrentWriteError,
  KasLedgerConflictError,
  KasLedgerCorruptError,
  KasLedgerFullError,
  isKasLedgerCorrupt,
  openKasLedger,
  quarantineCorruptKasLedger,
  reconcileKasLedgerClaims,
  resetKasLedgerOutpoints,
  withKasLedgerLock,
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

describe('flush merges with the stored blob (KAS-3)', () => {
  it('keeps entries another session flushed after this one opened', () => {
    const a = openKasLedger(() => 10);
    const b = openKasLedger(() => 20);
    a.set(op(1), 1n);
    b.set(op(2), 2n);
    a.flush();
    b.flush(); // the old whole-blob overwrite lost op(1) here
    expect(stored()).toEqual({ [op(1)]: '1@10', [op(2)]: '2@20' });
  });

  it('fails closed when another session recorded a DIFFERENT amount for the same outpoint', () => {
    const a = openKasLedger(() => 10);
    const b = openKasLedger(() => 20);
    a.set(op(1), 1n);
    b.set(op(1), 2n);
    a.flush();
    expect(() => b.flush()).toThrow(KasLedgerConcurrentWriteError);
    expect(stored()).toEqual({ [op(1)]: '1@10' });
  });

  it('the same amount from two sessions is not a conflict', () => {
    const a = openKasLedger(() => 10);
    const b = openKasLedger(() => 20);
    a.set(op(1), 1n);
    b.set(op(1), 1n);
    a.flush();
    b.flush();
    expect(stored()).toEqual({ [op(1)]: '1@20' });
  });

  it('flush fails closed on a blob that became unreadable', () => {
    const a = openKasLedger();
    a.set(op(1), 1n);
    storage.set(KAS_LEDGER_STORAGE_KEY, '{oops');
    expect(() => a.flush()).toThrow(KasLedgerCorruptError);
    expect(raw()).toBe('{oops');
  });
});

describe('withKasLedgerLock (KAS-3)', () => {
  it('serialises overlapping sessions so no entry is lost', async () => {
    const order: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = withKasLedgerLock(async () => {
      const ledger = openKasLedger(() => 1);
      order.push('first:open');
      await gate; // a network await between snapshot and flush
      ledger.set(op(1), 1n);
      ledger.flush();
      order.push('first:flush');
    });
    const second = withKasLedgerLock(() => {
      const ledger = openKasLedger(() => 2);
      order.push('second:open');
      ledger.set(op(2), 2n);
      ledger.flush();
      order.push('second:flush');
      return Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['first:open']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual([
      'first:open',
      'first:flush',
      'second:open',
      'second:flush',
    ]);
    expect(Object.keys(stored()).sort()).toEqual([op(1), op(2)]);
  });

  it('a failing session does not block the next one', async () => {
    await expect(
      withKasLedgerLock(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    await expect(withKasLedgerLock(() => Promise.resolve(7))).resolves.toBe(7);
  });
});

describe('reconcileKasLedgerClaims + resetKasLedgerOutpoints (KAS-2)', () => {
  const split = (o: string) => {
    const [txid, index] = o.split(':');
    return { txid, index: Number(index) };
  };

  it('does nothing (and proves nothing) without a conflict', async () => {
    storage.set(KAS_LEDGER_STORAGE_KEY, JSON.stringify({ [op(1)]: '5@1' }));
    const ledger = openKasLedger();
    const prove = jest.fn();
    await expect(
      reconcileKasLedgerClaims(
        ledger,
        [
          { outpoint: op(1), amount: 5n },
          { outpoint: op(2), amount: 9n },
        ],
        prove,
      ),
    ).resolves.toEqual([]);
    expect(prove).not.toHaveBeenCalled();
  });

  it('replaces an entry the proof shows wrong, refuses one it shows right, flags the unprovable', async () => {
    storage.set(
      KAS_LEDGER_STORAGE_KEY,
      JSON.stringify({ [op(1)]: '99@1', [op(2)]: '7@1', [op(3)]: '1@1' }),
    );
    const real: Record<string, bigint> = { [op(1)]: 100n, [op(2)]: 7n };
    const prove = jest.fn((txid: string, index: number) => {
      const v = real[`${txid}:${String(index)}`];
      return v === undefined
        ? Promise.reject(new Error('unprovable'))
        : Promise.resolve(v);
    });
    // op(1): poisoned (99) — claim 100 is the truth → replaced
    const l1 = openKasLedger();
    await expect(
      reconcileKasLedgerClaims(l1, [{ outpoint: op(1), amount: 100n }], prove),
    ).resolves.toEqual([op(1)]);
    expect(l1.get(op(1))).toBe(100n);
    expect(prove).toHaveBeenCalledWith(split(op(1)).txid, 0);
    // all three at once: op(2) proven right (refused), op(3) unprovable
    const l2 = openKasLedger();
    const err = await reconcileKasLedgerClaims(
      l2,
      [
        { outpoint: op(1), amount: 100n },
        { outpoint: op(2), amount: 8n },
        { outpoint: op(3), amount: 2n },
      ],
      prove,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KasLedgerConflictError);
    expect((err as KasLedgerConflictError).refused).toEqual([op(2)]);
    expect((err as KasLedgerConflictError).unprovable).toEqual([op(3)]);
    expect(l2.get(op(2))).toBe(7n);
    expect(l2.get(op(3))).toBe(1n);
  });

  it('a claim that differs from the proof is refused even after the stale entry is replaced', async () => {
    storage.set(KAS_LEDGER_STORAGE_KEY, JSON.stringify({ [op(1)]: '99@1' }));
    const ledger = openKasLedger();
    const err = await reconcileKasLedgerClaims(
      ledger,
      [{ outpoint: op(1), amount: 98n }],
      () => Promise.resolve(100n),
    ).catch((e: unknown) => e);
    expect((err as KasLedgerConflictError).refused).toEqual([op(1)]);
    expect(ledger.get(op(1))).toBe(100n); // the proven amount is safe to keep
  });

  it('resets only the named outpoints, keeps a copy, refuses unknown ones', () => {
    storage.set(
      KAS_LEDGER_STORAGE_KEY,
      JSON.stringify({ [op(1)]: '99@1', [op(2)]: '7@1' }),
    );
    expect(() => resetKasLedgerOutpoints([op(9)])).toThrow(/not in the/);
    expect(stored()).toEqual({ [op(1)]: '99@1', [op(2)]: '7@1' });
    expect(resetKasLedgerOutpoints([op(1).toUpperCase()], () => 77)).toBe(1);
    expect(stored()).toEqual({ [op(2)]: '7@1' });
    expect(
      JSON.parse(storage.getString(`${KAS_LEDGER_RESET_PREFIX}77`) as string),
    ).toEqual({ [op(1)]: '99@1' });
    storage.set(KAS_LEDGER_STORAGE_KEY, '{oops');
    expect(() => resetKasLedgerOutpoints([op(2)])).toThrow(
      KasLedgerCorruptError,
    );
  });

  /**
   * Regression of poc/kas-poc-ledger-poison.mjs with the real signing code:
   * session 1 signs under a backend's lie, sessions 2 and 3 (truth) used to
   * be refused forever.
   */
  it('poc/kas-poc-ledger-poison: a one-off lie no longer locks the outpoint', async () => {
    const k1 = new Uint8Array(32);
    k1[31] = 1;
    const k2 = new Uint8Array(32);
    k2[31] = 2;
    const wallet = K.localSigner(k1);
    const key = K.localSigner(k2);
    const vault = K.multisigSpend(
      [wallet.xOnlyPublicKey, key.xOnlyPublicKey],
      2,
    );
    const spk = K.spendScriptPublicKey(vault);
    const outpoint = { transactionId: new Uint8Array(32).fill(9), index: 0 };
    const opKey = `${K.bytesToHex(outpoint.transactionId)}:0`;
    const REAL = 1_000_000_000_000n;
    const LIE = REAL - 1n;
    const recipient = K.addressToScriptPublicKey(
      'kaspa:qr0lr4ml9fn3chekrqmjdkergxl93l4wrk3dankcgvjq776s9wn9jkdskewva',
      'kaspa',
    );
    const session = async (
      amount: bigint,
      prove: (t: string, i: number) => Promise<bigint>,
    ) =>
      withKasLedgerLock(async () => {
        const ledger = openKasLedger();
        const input = {
          outpoint,
          entry: {
            amount,
            scriptPublicKey: spk,
            blockDaaScore: 0n,
            isCoinbase: false,
          },
          spend: vault,
        };
        const plan = K.planTransaction(
          [input],
          [{ scriptPublicKey: recipient, amount: 100_000_000n }],
          { feeRate: 100n, changeSpend: vault, allowChain: false },
        );
        await reconcileKasLedgerClaims(
          ledger,
          [{ outpoint: opKey, amount }],
          prove,
        );
        const partials = await K.signTransaction(
          plan.final.tx,
          plan.final.inputs,
          [key],
          { onlyScripts: [spk], signedAmounts: ledger },
        );
        ledger.flush();
        return partials.length;
      });
    const truth = () => Promise.resolve(REAL);
    const offline = () => Promise.reject(new Error('unprovable'));
    // session 1: the backend lies once — the ledger records the lie
    expect(await session(LIE, truth)).toBe(1);
    expect(openKasLedger().get(opKey)).toBe(LIE);
    // session 2: the truth, unprovable right now → refused, resettable
    const err = await session(REAL, offline).catch((e: unknown) => e);
    expect((err as KasLedgerConflictError).unprovable).toEqual([opKey]);
    // session 3: the truth, proven → the poisoned entry is replaced, signed
    expect(await session(REAL, truth)).toBe(1);
    expect(openKasLedger().get(opKey)).toBe(REAL);
    // and a later lie is refused, because the chain proves the ledger right
    const lie = await session(LIE, truth).catch((e: unknown) => e);
    expect((lie as KasLedgerConflictError).refused).toEqual([opKey]);
    wallet.destroy();
    key.destroy();
  });
});
