/**
 * KEY-3 support in the real store: all ciphertexts are replaced in ONE state
 * transition (so the persisted root is never a mix of old- and new-key blobs),
 * plaintext fields are untouched, and the persisted copy can be read back.
 */
import {
  PERSIST_ROOT_KEY,
  readPersistedSlice,
  registeredChainKeys,
  replaceEncryptedBlobs,
  storage,
  store,
} from '../../src/store';
import {
  setSeedPhrase,
  setSspWalletKeyInternalIdentity,
} from '../../src/store/ssp';

describe('replaceEncryptedBlobs', () => {
  it('swaps every ciphertext in one dispatch and leaves plaintext alone', () => {
    store.dispatch(setSeedPhrase('old-seed-blob'));
    store.dispatch(setSspWalletKeyInternalIdentity('bc1qwk'));
    const notifications: number[] = [];
    const unsubscribe = store.subscribe(() => notifications.push(1));
    store.dispatch(
      replaceEncryptedBlobs({
        ssp: {
          seedPhrase: 'new-seed-blob',
          publicNonces: 'new-nonces',
          enterprisePublicNonces: '',
          xprivRecovery: 'new-xpriv-recovery',
          xpubRecovery: 'new-xpub-recovery',
        },
        chains: {
          btc: { xpubWallet: 'w', xpubKey: 'k', xprivKey: 'p' },
          eth: { xpubWallet: '', xpubKey: 'ek', xprivKey: 'ep' },
        },
      }),
    );
    unsubscribe();
    expect(notifications).toHaveLength(1);
    const state = store.getState();
    expect(state.ssp.seedPhrase).toBe('new-seed-blob');
    expect(state.ssp.xprivRecovery).toBe('new-xpriv-recovery');
    expect(state.ssp.sspWalletKeyInternalIdentity).toBe('bc1qwk');
    expect(state.btc).toEqual({ xpubWallet: 'w', xpubKey: 'k', xprivKey: 'p' });
    expect(state.eth.xprivKey).toBe('ep');
  });

  it('registers every chain slice', () => {
    expect(registeredChainKeys).toEqual(
      expect.arrayContaining(['btc', 'eth', 'flux', 'solMainnet']),
    );
  });
});

describe('readPersistedSlice', () => {
  it('reads one slice of the redux-persist root from MMKV', () => {
    storage.set(
      PERSIST_ROOT_KEY,
      JSON.stringify({ ssp: JSON.stringify({ seedPhrase: 'persisted' }) }),
    );
    expect(readPersistedSlice<{ seedPhrase: string }>('ssp')).toEqual({
      seedPhrase: 'persisted',
    });
    expect(readPersistedSlice('btc')).toBeUndefined();
  });

  it('returns undefined for an unreadable root', () => {
    storage.set(PERSIST_ROOT_KEY, '{broken');
    expect(readPersistedSlice('ssp')).toBeUndefined();
  });
});
