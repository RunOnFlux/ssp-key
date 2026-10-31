/**
 * KEY-3: legacy installs encrypt everything with enc_key = device UID, which
 * iOS backs up next to the MMKV ciphertexts (PoC: poc/legacy_uid_bruteforce.cjs
 * — only the app password stands between a backup and the seed).
 *
 * migrateLegacyEncKey rotates such installs to a random keychain-only key and
 * re-encrypts every blob. These tests pin: detection by enc_key === UID; that
 * afterwards nothing decrypts with the UID; idempotence; and crash safety at
 * each step (a "crash" = the run never finishing, then a fresh start that sees
 * only what was persisted).
 *
 * CryptoJS does not authenticate: a wrong key occasionally decrypts to a few
 * bytes of valid UTF-8 garbage instead of ''. Wrong-key checks therefore
 * assert "does not recover the plaintext", never "decrypts to ''".
 */
import * as CryptoJS from 'crypto-js';

const UID = 'F1E2D3C4-B5A6-4789-9ABC-DEF012345678';
const PASSWORD = 'correct horse battery staple';
const SEED =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HISTORY_SERVICE = 'sspkey_sign_history';

// ---- keychain (in memory, with fault injection) ----
// The access group each item was written to is tracked alongside, so calls
// naming another group — as lib/keychain's clean-up of an earlier build's
// copy does — leave it alone. Items seeded straight into the map sit in the
// app group: Startup moves everything there before the rotation runs.
const MOCK_APP_GROUP = 'group.io.runonflux.sspkey';
const mockKeychain = new Map<string, string>();
const mockKeychainGroups = new Map<string, string>();
const mockHangOn = new Set<string>();
const mockFailOn = new Set<string>();
type MockKeychainOptions = { service: string; accessGroup?: string };
jest.mock('react-native-keychain', () => {
  const inScope = ({ service, accessGroup }: MockKeychainOptions) =>
    mockKeychain.has(service) &&
    (accessGroup === undefined ||
      (mockKeychainGroups.get(service) ?? MOCK_APP_GROUP) === accessGroup);
  return {
    STORAGE_TYPE: { AES_GCM_NO_AUTH: 'AES_GCM_NO_AUTH' },
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    },
    getGenericPassword: jest.fn((opts: MockKeychainOptions) =>
      Promise.resolve(
        inScope(opts)
          ? { username: opts.service, password: mockKeychain.get(opts.service) }
          : false,
      ),
    ),
    setGenericPassword: jest.fn(
      (_user: string, value: string, opts: MockKeychainOptions) => {
        const { service } = opts;
        if (mockHangOn.has(service)) return new Promise(() => {});
        if (mockFailOn.has(service)) {
          return Promise.reject(new Error(`write failed: ${service}`));
        }
        mockKeychain.set(service, value);
        mockKeychainGroups.set(service, opts.accessGroup ?? 'default');
        return Promise.resolve(true);
      },
    ),
    resetGenericPassword: jest.fn((opts: MockKeychainOptions) => {
      if (inScope(opts)) {
        mockKeychain.delete(opts.service);
        mockKeychainGroups.delete(opts.service);
      }
      return Promise.resolve(true);
    }),
  };
});

jest.mock('react-native-device-info', () => ({
  getUniqueId: jest.fn(() => Promise.resolve(UID)),
}));

// ---- app state (the rotation only runs in the foreground) ----
let mockAppState = 'active';
// iOS: keychain reads and writes go through lib/keychain's app-group path.
jest.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return mockAppState;
    },
  },
  Platform: { OS: 'ios' },
}));

// ---- store: in-memory state + a separate "persisted" (MMKV) copy ----
type Chain = { xpubWallet: string; xpubKey: string; xprivKey: string };
interface FakeState {
  ssp: Record<string, string>;
  btc: Chain;
  eth: Chain;
}
let mockState: FakeState;
let mockPersisted: FakeState;
let mockFlushHangs = false;
let mockFlushFails = false;
const mockCompact = jest.fn();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

jest.mock('../../src/store/index', () => ({
  store: {
    getState: () => mockState,
    dispatch: (action: {
      type: string;
      payload: { ssp: Record<string, string>; chains: Record<string, Chain> };
    }) => {
      if (action.type !== 'ssp/replaceEncryptedBlobs') return;
      mockState = {
        ...mockState,
        ssp: { ...mockState.ssp, ...action.payload.ssp },
        btc: { ...mockState.btc, ...action.payload.chains.btc },
        eth: { ...mockState.eth, ...action.payload.chains.eth },
      };
    },
  },
  registeredChainKeys: ['btc', 'eth'],
  replaceEncryptedBlobs: (payload: unknown) => ({
    type: 'ssp/replaceEncryptedBlobs',
    payload,
  }),
  flushPersistedState: () => {
    if (mockFlushHangs) return new Promise(() => {});
    if (mockFlushFails) return Promise.reject(new Error('mmkv write failed'));
    mockPersisted = clone(mockState);
    return Promise.resolve();
  },
  readPersistedSlice: (slice: keyof FakeState) =>
    mockPersisted ? clone(mockPersisted[slice]) : undefined,
  compactPersistedStorage: () => mockCompact(),
}));

import {
  migrateLegacyEncKey,
  runEncKeyRotationGate,
  isEncKeyRotationPending,
} from '../../src/store/encKeyMigration';

const enc = (value: string, key: string) =>
  CryptoJS.AES.encrypt(value, key + PASSWORD).toString();
/** Raw AES decrypt; '' when the key is wrong and the bytes are not UTF-8. */
const decRaw = (blob: string, passphrase: string) => {
  try {
    return CryptoJS.AES.decrypt(blob, passphrase).toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
};
const dec = (blob: string, key: string) => decRaw(blob, key + PASSWORD);

const PLAIN = {
  seedPhrase: SEED,
  publicNonces: '[{"k":"1"}]',
  enterprisePublicNonces: '[{"k":"2"}]',
  xprivRecovery: 'xprv-recovery',
  xpubRecovery: 'xpub-recovery',
  btc: { xpubWallet: 'zpub-wallet', xpubKey: 'zpub-key', xprivKey: 'zprv-key' },
  eth: { xpubWallet: '', xpubKey: 'xpub-eth', xprivKey: 'xprv-eth' },
};

/** A legacy install: everything encrypted with UID + password. */
function seedLegacyInstall(encKey = UID) {
  mockKeychain.clear();
  mockKeychainGroups.clear();
  mockKeychain.set('enc_key', encKey);
  mockKeychain.set(
    'sspkey_pw',
    CryptoJS.AES.encrypt(PASSWORD, encKey).toString(),
  );
  mockKeychain.set(
    HISTORY_SERVICE,
    enc(JSON.stringify([{ id: '1', type: 'transaction' }]), encKey),
  );
  const chain = (c: Chain): Chain => ({
    xpubWallet: c.xpubWallet ? enc(c.xpubWallet, encKey) : '',
    xpubKey: c.xpubKey ? enc(c.xpubKey, encKey) : '',
    xprivKey: c.xprivKey ? enc(c.xprivKey, encKey) : '',
  });
  mockState = {
    ssp: {
      seedPhrase: enc(PLAIN.seedPhrase, encKey),
      publicNonces: enc(PLAIN.publicNonces, encKey),
      enterprisePublicNonces: enc(PLAIN.enterprisePublicNonces, encKey),
      xprivRecovery: enc(PLAIN.xprivRecovery, encKey),
      xpubRecovery: enc(PLAIN.xpubRecovery, encKey),
      sspWalletKeyInternalIdentity: 'bc1qwk', // plaintext, untouched
    },
    btc: chain(PLAIN.btc),
    eth: chain(PLAIN.eth),
  };
  mockPersisted = clone(mockState);
}

/** Simulates an app restart: memory is gone, only MMKV + keychain remain. */
function restart() {
  mockState = clone(mockPersisted);
  mockHangOn.clear();
  mockFailOn.clear();
  mockFlushHangs = false;
  mockFlushFails = false;
}

const settle = async () => {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

/** Everything decrypts with the CURRENT keychain enc_key + password. */
function expectConsistent(state: FakeState = mockState) {
  const key = mockKeychain.get('enc_key') as string;
  expect(decRaw(mockKeychain.get('sspkey_pw') as string, key)).toBe(PASSWORD);
  expect(dec(state.ssp.seedPhrase, key)).toBe(PLAIN.seedPhrase);
  expect(dec(state.ssp.publicNonces, key)).toBe(PLAIN.publicNonces);
  expect(dec(state.ssp.enterprisePublicNonces, key)).toBe(
    PLAIN.enterprisePublicNonces,
  );
  expect(dec(state.ssp.xprivRecovery, key)).toBe(PLAIN.xprivRecovery);
  expect(dec(state.ssp.xpubRecovery, key)).toBe(PLAIN.xpubRecovery);
  expect(dec(state.btc.xprivKey, key)).toBe(PLAIN.btc.xprivKey);
  expect(dec(state.btc.xpubWallet, key)).toBe(PLAIN.btc.xpubWallet);
  expect(dec(state.eth.xprivKey, key)).toBe(PLAIN.eth.xprivKey);
  expect(state.eth.xpubWallet).toBe('');
}

beforeEach(() => {
  mockHangOn.clear();
  mockFailOn.clear();
  mockFlushHangs = false;
  mockFlushFails = false;
  mockAppState = 'active';
  mockCompact.mockClear();
  seedLegacyInstall();
});

describe('migrateLegacyEncKey', () => {
  it('leaves a non-legacy install (random enc_key) alone', async () => {
    seedLegacyInstall('ab'.repeat(64));
    const before = clone(mockState);
    expect(await migrateLegacyEncKey()).toBe('not_legacy');
    expect(mockState).toEqual(before);
    expect(mockKeychain.get('enc_key')).toBe('ab'.repeat(64));
  });

  it('rotates a legacy install to a random key and re-encrypts everything', async () => {
    expect(await migrateLegacyEncKey()).toBe('migrated');
    const newKey = mockKeychain.get('enc_key') as string;
    expect(newKey).toMatch(/^[0-9a-f]{128}$/);
    expect(newKey).not.toBe(UID);
    expectConsistent();
    // persisted == in memory, and the UID no longer opens anything
    expect(mockPersisted).toEqual(mockState);
    expect(dec(mockPersisted.ssp.seedPhrase, UID)).not.toBe(SEED);
    expect(dec(mockPersisted.btc.xprivKey, UID)).not.toBe(PLAIN.btc.xprivKey);
    expect(decRaw(mockKeychain.get('sspkey_pw') as string, UID)).not.toBe(
      PASSWORD,
    );
    // plaintext fields untouched; staging item gone; history re-encrypted
    expect(mockState.ssp.sspWalletKeyInternalIdentity).toBe('bc1qwk');
    expect(mockKeychain.has('enc_key_migration')).toBe(false);
    expect(
      JSON.parse(dec(mockKeychain.get(HISTORY_SERVICE) as string, newKey)),
    ).toEqual([{ id: '1', type: 'transaction' }]);
  });

  it('rotates an install whose items are still in the default access group, into the app group', async () => {
    // e.g. the launch-time move to the app group failed
    for (const service of mockKeychain.keys()) {
      mockKeychainGroups.set(service, 'default');
    }
    expect(await migrateLegacyEncKey()).toBe('migrated');
    expect(mockKeychain.get('enc_key')).not.toBe(UID);
    expectConsistent();
    for (const service of ['enc_key', 'sspkey_pw', HISTORY_SERVICE]) {
      expect(mockKeychainGroups.get(service)).toBe(MOCK_APP_GROUP);
    }
  });

  it('is idempotent', async () => {
    await migrateLegacyEncKey();
    const key = mockKeychain.get('enc_key');
    const state = clone(mockState);
    expect(await migrateLegacyEncKey()).toBe('not_legacy');
    expect(mockKeychain.get('enc_key')).toBe(key);
    expect(mockState).toEqual(state);
  });

  it('changes nothing when a blob does not decrypt under the old key', async () => {
    mockState.btc.xprivKey = CryptoJS.AES.encrypt('x', 'other').toString();
    mockPersisted = clone(mockState);
    const before = clone(mockState);
    expect(await migrateLegacyEncKey()).toBe('failed');
    expect(mockState).toEqual(before);
    expect(mockKeychain.get('enc_key')).toBe(UID);
    expect(mockKeychain.has('enc_key_migration')).toBe(false);
  });

  it('crash after the new state was persisted, before the keychain swap: next start rolls forward', async () => {
    mockHangOn.add('sspkey_pw');
    void migrateLegacyEncKey();
    await settle();
    // the "dead" run left: staging item, new-key state on disk, old enc_key
    expect(mockKeychain.has('enc_key_migration')).toBe(true);
    expect(mockKeychain.get('enc_key')).toBe(UID);
    expect(dec(mockPersisted.ssp.seedPhrase, UID)).not.toBe(SEED);

    restart();
    expect(await migrateLegacyEncKey()).toBe('resumed_forward');
    expect(mockKeychain.get('enc_key')).not.toBe(UID);
    expect(mockKeychain.has('enc_key_migration')).toBe(false);
    expectConsistent();
  });

  it('crash after sspkey_pw was rewritten but before enc_key: next start rolls forward', async () => {
    mockHangOn.add('enc_key');
    void migrateLegacyEncKey();
    await settle();
    expect(mockKeychain.get('enc_key')).toBe(UID);

    restart();
    expect(await migrateLegacyEncKey()).toBe('resumed_forward');
    expectConsistent();
  });

  it('crash before the new state reached disk: next start finishes forward from the old-key blobs', async () => {
    mockFlushHangs = true;
    void migrateLegacyEncKey();
    await settle();
    // memory changed, disk did not
    expect(mockKeychain.has('enc_key_migration')).toBe(true);
    expect(dec(mockPersisted.ssp.seedPhrase, UID)).toBe(SEED);

    restart();
    expect(await migrateLegacyEncKey()).toBe('resumed_forward');
    expect(mockKeychain.get('enc_key')).not.toBe(UID);
    expect(mockKeychain.has('enc_key_migration')).toBe(false);
    expectConsistent();
    expect(mockPersisted).toEqual(mockState);
  });

  it('an MMKV write failure restores the old ciphertexts in-process', async () => {
    mockFlushFails = true;
    expect(await migrateLegacyEncKey()).toBe('failed');
    expect(mockKeychain.get('enc_key')).toBe(UID);
    expectConsistent();
  });

  it('a keychain write failure after the state verified finishes forward in-process', async () => {
    mockFailOn.add('enc_key');
    // the in-process reconcile retries the enc_key write — let that one land
    const keychain = jest.requireMock<{ setGenericPassword: jest.Mock }>(
      'react-native-keychain',
    );
    const realImpl = keychain.setGenericPassword.getMockImplementation() as (
      ...args: unknown[]
    ) => Promise<boolean>;
    let failures = 0;
    keychain.setGenericPassword.mockImplementation(
      (user: string, value: string, opts: { service: string }) => {
        if (opts.service === 'enc_key' && failures === 0) {
          failures += 1;
          return Promise.reject(new Error('transient'));
        }
        mockFailOn.delete('enc_key');
        return realImpl(user, value, opts);
      },
    );
    expect(await migrateLegacyEncKey()).toBe('failed');
    keychain.setGenericPassword.mockImplementation(realImpl);
    expect(mockKeychain.get('enc_key')).not.toBe(UID);
    expect(mockKeychain.has('enc_key_migration')).toBe(false);
    expectConsistent();
  });

  it('keeps an unreadable staging item, touches nothing and blocks Main when the state does not match the keychain', async () => {
    mockKeychain.set('enc_key_migration', '{garbage');
    // part of the state is under some other key (the lost staged key)
    mockState.ssp.seedPhrase = CryptoJS.AES.encrypt(
      SEED,
      'lost-key' + PASSWORD,
    ).toString();
    mockPersisted = clone(mockState);
    const before = clone(mockState);
    expect(await migrateLegacyEncKey()).toBe('failed');
    expect(mockKeychain.get('enc_key_migration')).toBe('{garbage');
    expect(mockKeychain.get('enc_key')).toBe(UID);
    expect(mockState).toEqual(before);
    expect(await runEncKeyRotationGate()).toBe('blocked');
  });

  it('drops an orphaned unreadable staging item when every blob decrypts under the keychain key, then rotates', async () => {
    mockKeychain.set('enc_key_migration', '{garbage');
    expect(await migrateLegacyEncKey()).toBe('migrated');
    expect(mockKeychain.has('enc_key_migration')).toBe(false);
    expect(mockKeychain.get('enc_key')).not.toBe(UID);
    expectConsistent();
  });

  it('compacts MMKV after the rotation verified, never on failure', async () => {
    mockFlushFails = true;
    expect(await migrateLegacyEncKey()).toBe('failed');
    expect(mockCompact).not.toHaveBeenCalled();
    // the restore flush failed too, so the staging item stayed: finish forward
    restart();
    expect(await migrateLegacyEncKey()).toBe('resumed_forward');
    expect(mockCompact).toHaveBeenCalledTimes(1);
    expectConsistent();
  });
});

describe('foreground-only rotation', () => {
  it('does nothing in the background and lets Startup wait', async () => {
    mockAppState = 'background';
    const before = clone(mockState);
    expect(await migrateLegacyEncKey()).toBe('deferred');
    expect(await runEncKeyRotationGate()).toBe('wait');
    expect(mockState).toEqual(before);
    expect(mockKeychain.get('enc_key')).toBe(UID);
    expect(mockKeychain.has('enc_key_migration')).toBe(false);

    mockAppState = 'active';
    expect(await runEncKeyRotationGate()).toBe('proceed');
    expect(mockKeychain.get('enc_key')).not.toBe(UID);
    expectConsistent();
  });

  it('lets Startup proceed for a non-legacy install', async () => {
    seedLegacyInstall('ab'.repeat(64));
    expect(await runEncKeyRotationGate()).toBe('proceed');
  });
});

describe('interrupted rotation: Startup gate and per-blob resume', () => {
  it('a keychain write that keeps failing after the blob flush blocks Main until a retry finishes forward', async () => {
    mockFailOn.add('sspkey_pw');
    expect(await runEncKeyRotationGate()).toBe('blocked');
    // disk is new-key, the keychain still says UID, the staging item stays
    expect(dec(mockPersisted.ssp.seedPhrase, UID)).not.toBe(SEED);
    expect(mockKeychain.get('enc_key')).toBe(UID);
    expect(await isEncKeyRotationPending()).toBe(true);
    // still failing on the next foreground: still blocked, nothing lost
    expect(await runEncKeyRotationGate()).toBe('blocked');
    expect(mockCompact).not.toHaveBeenCalled();

    // the keychain recovers: the retry finishes forward
    mockFailOn.clear();
    expect(await runEncKeyRotationGate()).toBe('proceed');
    expect(await isEncKeyRotationPending()).toBe(false);
    expectConsistent();
    expect(mockPersisted).toEqual(mockState);
    expect(mockCompact).toHaveBeenCalledTimes(1);
  });

  it('resume recovers mixed-key blobs (written under the old key after the flush) and re-encrypts all under the new key', async () => {
    mockFailOn.add('sspkey_pw');
    expect(await migrateLegacyEncKey()).toBe('failed');
    const staged = JSON.parse(mockKeychain.get('enc_key_migration') as string);
    expect(dec(mockPersisted.ssp.seedPhrase, staged.new)).toBe(SEED);

    // What an unguarded Main would have done next: write blobs under the
    // keychain's (old) enc_key next to the new-key ones.
    mockPersisted.btc.xpubWallet = enc(PLAIN.btc.xpubWallet, UID);
    mockPersisted.ssp.publicNonces = enc(PLAIN.publicNonces, UID);
    restart();
    expect(dec(mockState.btc.xpubWallet, staged.new)).not.toBe(
      PLAIN.btc.xpubWallet,
    );
    expect(dec(mockState.btc.xprivKey, UID)).not.toBe(PLAIN.btc.xprivKey);

    expect(await migrateLegacyEncKey()).toBe('resumed_forward');
    expect(mockKeychain.get('enc_key')).toBe(staged.new);
    expect(mockKeychain.has('enc_key_migration')).toBe(false);
    expectConsistent();
    expectConsistent(mockPersisted);
    // nothing decrypts with the UID any more
    expect(dec(mockPersisted.btc.xpubWallet, UID)).not.toBe(
      PLAIN.btc.xpubWallet,
    );
    expect(dec(mockPersisted.ssp.publicNonces, UID)).not.toBe(
      PLAIN.publicNonces,
    );
  });

  it('resume with the password item still under the old key and every blob under the new one', async () => {
    mockHangOn.add('sspkey_pw');
    void migrateLegacyEncKey();
    await settle();
    restart();
    // sspkey_pw was never rewritten: it is still under the UID
    expect(decRaw(mockKeychain.get('sspkey_pw') as string, UID)).toBe(PASSWORD);
    expect(await migrateLegacyEncKey()).toBe('resumed_forward');
    expectConsistent();
  });

  it('keeps the staging item (and the old key) when a blob decrypts under neither key', async () => {
    mockFailOn.add('sspkey_pw');
    expect(await migrateLegacyEncKey()).toBe('failed');
    const stagedRaw = mockKeychain.get('enc_key_migration');
    mockPersisted.eth.xprivKey = CryptoJS.AES.encrypt(
      'xprv-eth',
      'unrelated' + PASSWORD,
    ).toString();
    restart();
    const before = clone(mockState);
    expect(await runEncKeyRotationGate()).toBe('blocked');
    expect(mockKeychain.get('enc_key_migration')).toBe(stagedRaw);
    expect(mockKeychain.get('enc_key')).toBe(UID);
    expect(mockState).toEqual(before);
  });

  it('never drops the staging item when the resumed state does not reach disk', async () => {
    mockFailOn.add('sspkey_pw');
    expect(await migrateLegacyEncKey()).toBe('failed');
    mockPersisted.btc.xpubWallet = enc(PLAIN.btc.xpubWallet, UID); // mixed
    restart();
    mockFlushFails = true;
    expect(await runEncKeyRotationGate()).toBe('blocked');
    expect(mockKeychain.get('enc_key')).toBe(UID);
    expect(mockKeychain.has('enc_key_migration')).toBe(true);
    mockFlushFails = false;
    expect(await runEncKeyRotationGate()).toBe('proceed');
    expectConsistent();
    expectConsistent(mockPersisted);
  });
});
