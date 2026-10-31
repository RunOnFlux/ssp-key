/**
 * K2 / K4 regression tests for the Key's enterprise Schnorr nonce pool.
 *
 * K2: replenish read the pool (a render-time snapshot), awaited the relay,
 * then wrote `[...snapshot, ...new]` — resurrecting any nonce a vault
 * signature consumed meanwhile. Three signatures with one nonce pair leak
 * the private key.
 * K4: the burned pool was dispatched to Redux with no flush before the
 * partial signature left the device, so a crash could bring it back.
 */
import * as CryptoJS from 'crypto-js';
import { createMMKV } from 'react-native-mmkv';

import type { publicPrivateNonce } from '../../src/types';
import {
  EnterpriseNonceError,
  addEnterpriseNonces,
  burnEnterpriseNonce,
  findEnterpriseNonce,
  readEnterpriseNonces,
  withEnterpriseNonceLock,
} from '../../src/lib/enterpriseNoncePool';
import {
  MAX_TOMBSTONES,
  isNonceTombstoned,
  readUsedNonceTombstones,
  recordUsedNonce,
} from '../../src/lib/enterpriseNonceLedger';

let mockCipher = '';
const mockFlush = jest.fn((): Promise<void> => Promise.resolve());
jest.mock('../../src/store', () => ({
  store: {
    getState: () => ({ ssp: { enterprisePublicNonces: mockCipher } }),
    dispatch: (action: { payload: string }) => {
      mockCipher = action.payload;
    },
  },
  persistor: { flush: () => mockFlush() },
}));

const PW = 'enc-key+password';
const nonce = (i: number): publicPrivateNonce => ({
  k: `k-${i}`,
  kTwo: `kTwo-${i}`,
  kPublic: `kPublic-${i}`,
  kTwoPublic: `kTwoPublic-${i}`,
});
const ref = (n: publicPrivateNonce) => ({
  kPublic: n.kPublic,
  kTwoPublic: n.kTwoPublic,
});
const setPool = (nonces: publicPrivateNonce[]) => {
  mockCipher = CryptoJS.AES.encrypt(JSON.stringify(nonces), PW).toString();
};
const pool = (): publicPrivateNonce[] =>
  mockCipher
    ? (JSON.parse(
        CryptoJS.AES.decrypt(mockCipher, PW).toString(CryptoJS.enc.Utf8),
      ) as publicPrivateNonce[])
    : [];

beforeEach(() => {
  createMMKV().clearAll();
  mockCipher = '';
  mockFlush.mockReset();
  mockFlush.mockImplementation(() => Promise.resolve());
});

describe('burnEnterpriseNonce (K4)', () => {
  it('removes the nonce, records it as used and flushes BEFORE resolving', async () => {
    setPool([nonce(1), nonce(2), nonce(3)]);
    let stateAtFlush: { pool: string[]; tombstoned: boolean } | null = null;
    mockFlush.mockImplementation(() => {
      stateAtFlush = {
        pool: pool().map((n) => n.kPublic),
        tombstoned: isNonceTombstoned('kPublic-2'),
      };
      return Promise.resolve();
    });

    const burned = await burnEnterpriseNonce(ref(nonce(2)), PW);

    expect(burned).toEqual(nonce(2));
    expect(mockFlush).toHaveBeenCalledTimes(1);
    // at the moment of the flush the burn was already complete
    expect(stateAtFlush).toEqual({
      pool: ['kPublic-1', 'kPublic-3'],
      tombstoned: true,
    });
    expect(pool().map((n) => n.kPublic)).toEqual(['kPublic-1', 'kPublic-3']);
  });

  it('rejects (so the caller never signs) when the flush fails', async () => {
    setPool([nonce(1)]);
    mockFlush.mockImplementation(() => Promise.reject(new Error('disk full')));

    await expect(burnEnterpriseNonce(ref(nonce(1)), PW)).rejects.toMatchObject({
      code: 'persist_failed',
    });
    // the ledger entry stays: the nonce is never offered again
    expect(isNonceTombstoned('kPublic-1')).toBe(true);
  });

  it('refuses a nonce this device already used, even if the pool still has it', async () => {
    setPool([nonce(1), nonce(2)]);
    recordUsedNonce('kPublic-1');

    await expect(burnEnterpriseNonce(ref(nonce(1)), PW)).rejects.toMatchObject({
      code: 'already_used',
    });
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it('reports an unknown nonce and an unreadable pool', async () => {
    setPool([nonce(1)]);
    await expect(burnEnterpriseNonce(ref(nonce(9)), PW)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      burnEnterpriseNonce(ref(nonce(1)), 'wrong-password'),
    ).rejects.toBeInstanceOf(EnterpriseNonceError);
  });

  it('a nonce can be burned only once', async () => {
    setPool([nonce(1)]);
    await burnEnterpriseNonce(ref(nonce(1)), PW);
    await expect(burnEnterpriseNonce(ref(nonce(1)), PW)).rejects.toMatchObject({
      code: 'already_used',
    });
  });
});

describe('addEnterpriseNonces (K2)', () => {
  it('a replenish that overlaps a signature never brings the burned nonce back', async () => {
    setPool([nonce(1), nonce(2)]);
    // Replenish took its snapshot (with nonce 1) before going to the relay…
    const snapshot = readEnterpriseNonces(PW);
    expect(snapshot.map((n) => n.kPublic)).toContain('kPublic-1');
    // …a vault signature burns nonce 1 while the POST is in flight…
    await burnEnterpriseNonce(ref(nonce(1)), PW);
    // …then replenish writes. It re-reads the pool instead of the snapshot.
    await addEnterpriseNonces([nonce(3), nonce(4)], PW);

    expect(pool().map((n) => n.kPublic)).toEqual([
      'kPublic-2',
      'kPublic-3',
      'kPublic-4',
    ]);
  });

  it('concurrent burn and replenish are serialised and both take effect', async () => {
    setPool([nonce(1), nonce(2)]);
    await Promise.all([
      addEnterpriseNonces([nonce(5)], PW),
      burnEnterpriseNonce(ref(nonce(2)), PW),
      addEnterpriseNonces([nonce(6)], PW),
    ]);
    expect(pool().map((n) => n.kPublic)).toEqual([
      'kPublic-1',
      'kPublic-5',
      'kPublic-6',
    ]);
  });

  it('drops used nonces even when a stale pool was written back', async () => {
    setPool([nonce(1), nonce(2)]);
    const staleCipher = mockCipher;
    await burnEnterpriseNonce(ref(nonce(1)), PW);
    // some other stale writer restores the old pool
    mockCipher = staleCipher;

    expect(findEnterpriseNonce(ref(nonce(1)), PW)).toBeUndefined();
    expect(readEnterpriseNonces(PW).map((n) => n.kPublic)).toEqual([
      'kPublic-2',
    ]);
    await addEnterpriseNonces([nonce(3), nonce(3)], PW);
    // used nonce filtered, duplicate collapsed
    expect(pool().map((n) => n.kPublic)).toEqual(['kPublic-2', 'kPublic-3']);
    expect(mockFlush).toHaveBeenCalled();
  });

  it('replaces an unreadable pool with the fresh nonces', async () => {
    mockCipher = 'garbage';
    await addEnterpriseNonces([nonce(7)], PW);
    expect(pool().map((n) => n.kPublic)).toEqual(['kPublic-7']);
  });
});

describe('withEnterpriseNonceLock', () => {
  it('runs critical sections one at a time, even after a failure', async () => {
    const order: string[] = [];
    const slow = withEnterpriseNonceLock(async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a:end');
    });
    const failing = withEnterpriseNonceLock(() => {
      order.push('b');
      throw new Error('boom');
    });
    const last = withEnterpriseNonceLock(() => {
      order.push('c');
    });
    await slow;
    await expect(failing).rejects.toThrow('boom');
    await last;
    expect(order).toEqual(['a:start', 'a:end', 'b', 'c']);
  });
});

describe('used-nonce ledger', () => {
  it('records durably, keeps the most recent entries and refuses a corrupt ledger', () => {
    recordUsedNonce('first');
    expect(readUsedNonceTombstones()).toEqual(['first']);
    for (let i = 0; i < MAX_TOMBSTONES; i++) {
      recordUsedNonce(`n-${i}`);
    }
    const all = readUsedNonceTombstones();
    expect(all).toHaveLength(MAX_TOMBSTONES);
    expect(all).not.toContain('first');
    expect(all[all.length - 1]).toBe(`n-${MAX_TOMBSTONES - 1}`);
    expect(() => recordUsedNonce('')).toThrow();

    createMMKV().set('enterpriseUsedKPublic', '{corrupt');
    expect(() => readUsedNonceTombstones()).toThrow();
  });
});
