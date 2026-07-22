// Mock keychain with an in-memory store keyed by `service`.
// Prefixed `mock` so jest.mock's factory is allowed to reference it.
const mockKeychainStore = new Map<string, string>();

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn((opts?: { service?: string }) => {
    const service = opts?.service ?? 'default';
    if (!mockKeychainStore.has(service)) {
      return Promise.resolve(false);
    }
    return Promise.resolve({
      username: service,
      password: mockKeychainStore.get(service),
    });
  }),
  setGenericPassword: jest.fn(
    (_username: string, password: string, opts?: { service?: string }) => {
      const service = opts?.service ?? 'default';
      mockKeychainStore.set(service, password);
      return Promise.resolve(true);
    },
  ),
  resetGenericPassword: jest.fn((opts?: { service?: string }) => {
    const service = opts?.service ?? 'default';
    mockKeychainStore.delete(service);
    return Promise.resolve(true);
  }),
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'AESGCMNoAuth' },
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' },
}));

import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import {
  SIGN_HISTORY_SERVICE,
  MAX_SIGN_HISTORY_ENTRIES,
  deriveHistoryPassword,
  loadSignHistory,
  appendSignHistory,
  clearSignHistory,
  recordSignAction,
  type SignHistoryEntry,
} from '../../src/lib/signHistory';

const PW = 'test-pw-for-encryption';

function makeEntry(over: Partial<SignHistoryEntry> = {}): SignHistoryEntry {
  return {
    id: 'id-1',
    type: 'transaction',
    chain: 'btc',
    wkIdentity: 'wk-abc',
    timestamp: 1_700_000_000_000,
    ...over,
  };
}

// Seed the enc_key + sspkey_pw material the way Startup.tsx does so that
// deriveHistoryPassword() reproduces the real app derivation.
function seedAppKeys(encKey = 'enc-key-xyz', rawPw = 'user-password') {
  const encryptedPw = CryptoJS.AES.encrypt(rawPw, encKey).toString();
  mockKeychainStore.set('enc_key', encKey);
  mockKeychainStore.set('sspkey_pw', encryptedPw);
  return encKey + rawPw; // == pwForEncryption
}

beforeEach(() => {
  mockKeychainStore.clear();
  jest.clearAllMocks();
});

describe('signHistory storage', () => {
  it('uses a dedicated new keychain service key', () => {
    expect(SIGN_HISTORY_SERVICE).toBe('sspkey_sign_history');
  });

  it('returns an empty list when nothing is stored', async () => {
    expect(await loadSignHistory(PW)).toEqual([]);
  });

  it('persists encrypted (not plaintext) and round-trips entries', async () => {
    const entry = makeEntry();
    await appendSignHistory(entry, PW);

    const rawBlob = mockKeychainStore.get(SIGN_HISTORY_SERVICE) ?? '';
    // The stored blob must not contain any of the plaintext fields.
    expect(rawBlob).not.toContain('wk-abc');
    expect(rawBlob).not.toContain('transaction');

    const loaded = await loadSignHistory(PW);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(entry);
  });

  it('writes only under the dedicated service and never touches existing keys', async () => {
    const pw = seedAppKeys();
    const before = new Map(mockKeychainStore);
    await appendSignHistory(makeEntry(), pw);
    // enc_key + sspkey_pw untouched
    expect(mockKeychainStore.get('enc_key')).toBe(before.get('enc_key'));
    expect(mockKeychainStore.get('sspkey_pw')).toBe(before.get('sspkey_pw'));
    // setGenericPassword only ever called for the history service
    for (const call of (Keychain.setGenericPassword as jest.Mock).mock.calls) {
      expect(call[2].service).toBe(SIGN_HISTORY_SERVICE);
    }
  });

  it('prepends newest-first', async () => {
    await appendSignHistory(makeEntry({ id: 'a', timestamp: 1 }), PW);
    await appendSignHistory(makeEntry({ id: 'b', timestamp: 2 }), PW);
    const loaded = await loadSignHistory(PW);
    expect(loaded.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('caps at MAX_SIGN_HISTORY_ENTRIES, dropping oldest', async () => {
    for (let i = 0; i < MAX_SIGN_HISTORY_ENTRIES + 5; i++) {
      await appendSignHistory(makeEntry({ id: `id-${i}`, timestamp: i }), PW);
    }
    const loaded = await loadSignHistory(PW);
    expect(loaded).toHaveLength(MAX_SIGN_HISTORY_ENTRIES);
    // newest kept, oldest dropped
    expect(loaded[0].id).toBe(`id-${MAX_SIGN_HISTORY_ENTRIES + 4}`);
    expect(loaded.some((e) => e.id === 'id-0')).toBe(false);
  });

  it('fails soft on a wrong decryption password', async () => {
    await appendSignHistory(makeEntry(), PW);
    expect(await loadSignHistory('wrong-pw')).toEqual([]);
  });

  it('fails soft on a corrupt blob', async () => {
    mockKeychainStore.set(SIGN_HISTORY_SERVICE, 'not-valid-ciphertext');
    expect(await loadSignHistory(PW)).toEqual([]);
  });

  it('clearSignHistory removes the stored blob', async () => {
    await appendSignHistory(makeEntry(), PW);
    expect(mockKeychainStore.has(SIGN_HISTORY_SERVICE)).toBe(true);
    await clearSignHistory();
    expect(mockKeychainStore.has(SIGN_HISTORY_SERVICE)).toBe(false);
  });
});

describe('deriveHistoryPassword', () => {
  it('reconstructs enc_key + decrypted password', async () => {
    const expected = seedAppKeys('ek', 'pw123');
    expect(await deriveHistoryPassword()).toBe(expected);
  });

  it('returns null when material is missing', async () => {
    expect(await deriveHistoryPassword()).toBeNull();
  });
});

describe('recordSignAction (postAction choke-point hook)', () => {
  it('records known successful co-sign actions', async () => {
    const pw = seedAppKeys();
    await recordSignAction('txid', 'btc', 'wk-1', 'the-txid');
    const loaded = await loadSignHistory(pw);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({
      type: 'transaction',
      chain: 'btc',
      wkIdentity: 'wk-1',
      ref: 'the-txid',
    });
  });

  it('maps each supported action string to its type', async () => {
    const pw = seedAppKeys();
    const cases: Array<[string, string]> = [
      ['evmsigned', 'evm_message'],
      ['wksigned', 'wk_message'],
      ['enterprisevaultsigned', 'vault_transaction'],
      ['enterprisevaultxpubsigned', 'vault_xpub'],
      ['publicnonces', 'public_nonces'],
      ['recoveryresponse', 'recovery'],
      ['enterprisekeynoncesynced', 'key_nonce_sync'],
    ];
    for (const [action] of cases) {
      await recordSignAction(action, 'flux', 'wk-x');
    }
    const loaded = await loadSignHistory(pw);
    expect(loaded).toHaveLength(cases.length);
    const types = loaded.map((e) => e.type).sort();
    expect(types).toEqual(cases.map(([, t]) => t).sort());
  });

  it('ignores rejected / ambiguous actions (never logs failures as signs)', async () => {
    const pw = seedAppKeys();
    for (const action of [
      'txrejected',
      'evmsigningrejected',
      'wksigningrejected',
      'enterprisefluxnodestarted', // ambiguous: also posted on error/reject
      'chainsyncrejected',
      'recoverydenied',
    ]) {
      await recordSignAction(action, 'btc', 'wk-1');
    }
    expect(await loadSignHistory(pw)).toEqual([]);
  });

  it('never stores a signature payload — only public metadata + optional txid ref', async () => {
    const pw = seedAppKeys();
    await recordSignAction('txid', 'btc', 'wk-1', 'txid-abc');
    const loaded = await loadSignHistory(pw);
    // ref is the only reference and equals the public txid we passed
    expect(loaded[0].ref).toBe('txid-abc');
    // entry shape has no payload/signature field
    expect(Object.keys(loaded[0]).sort()).toEqual(
      ['chain', 'id', 'ref', 'timestamp', 'type', 'wkIdentity'].sort(),
    );
  });

  it('does not throw when keychain material is unavailable', async () => {
    // no app keys seeded
    await expect(
      recordSignAction('txid', 'btc', 'wk-1'),
    ).resolves.toBeUndefined();
    expect(mockKeychainStore.has(SIGN_HISTORY_SERVICE)).toBe(false);
  });
});
