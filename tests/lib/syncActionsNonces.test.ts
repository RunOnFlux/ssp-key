/**
 * Regression tests for the batch chain-sync nonce pool.
 *
 * The Schnorr public-nonce pool is PER-INSTALL, not per-chain: one redux slot
 * on this device (store/ssp publicNonces) and one localForage key in SSP
 * Wallet, drawn from by every EVM send regardless of chain. A batch sync that
 * regenerated the pool for every EVM chain it answered left this device holding
 * only the LAST chain's pool while the wallet kept an earlier one — every
 * subsequent EVM send then used a nonce the other side never had and the wallet
 * waited forever with no error.
 *
 * The invariant asserted here: after a batch sync, the pool this device kept is
 * exactly the pool reported to the wallet for EVERY EVM chain of that batch.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import axios from 'axios';

import type { publicPrivateNonce, syncSSPRelay } from '../../src/types';
import type { HomeActionContext } from '../../src/screens/Home/actions/types';

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn(() => Promise.resolve({ data: {} })) },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
}));

jest.mock('@storage/ssp', () => ({
  sspConfig: () => ({ relay: 'relay.example.com' }),
}));

// no 3s spacing between the per-chain posts in tests
jest.mock('../../src/lib/chainSyncRequest', () => ({
  CHAIN_SYNC_POST_SPACING_MS: 0,
}));

jest.mock('../../src/lib/fcmHelper', () => ({
  getFCMToken: jest.fn(() => Promise.resolve('fcm-token')),
}));

// the store is only used for the per-chain encrypted key material + setters
const storeState: Record<string, { xpubKey: string; xprivKey: string }> = {};
jest.mock('../../src/store', () => ({
  __esModule: true,
  store: { getState: () => storeState },
  storage: { getString: () => undefined },
  setXpubKey: jest.fn(),
  setXprivKey: jest.fn(),
  setXpubWallet: jest.fn(),
  setXpubWalletIdentity: jest.fn(),
}));

// Crypto is exercised by tests/lib/wallet.test.ts — here it is stubbed so the
// batch loop runs fast and the nonce bookkeeping is the only thing under test.
let mockNonceCounter = 0;
const mockGeneratePublicNonce = jest.fn((): publicPrivateNonce => {
  mockNonceCounter += 1;
  return {
    k: `k${mockNonceCounter}`,
    kTwo: `kTwo${mockNonceCounter}`,
    kPublic: `kPublic${mockNonceCounter}`,
    kTwoPublic: `kTwoPublic${mockNonceCounter}`,
  };
});
jest.mock('../../src/lib/wallet', () => ({
  getMasterXpriv: jest.fn(() => 'xpriv'),
  getMasterXpub: jest.fn(() => 'xpub'),
  generateMultisigAddress: jest.fn((_w: string, _k: string, _t, _a, chain) => ({
    address: `address-${chain}`,
    redeemScript: `redeem-${chain}`,
    witnessScript: `witness-${chain}`,
  })),
  generateInternalIdentityAddress: jest.fn(() => 'identity'),
  generateAddressKeypair: jest.fn(() => ({ privKey: '0x1', pubKey: '0x2' })),
  generatePublicNonce: () => mockGeneratePublicNonce(),
  generateSolanaPubkeyArray: jest.fn(() => []),
}));

import {
  processChainSyncBatch,
  syncChainToRelay,
} from '../../src/screens/Home/actions/syncActions';

const ENC_KEY = 'enc-key';
const PASSWORD = 'password';
const PW_FOR_ENCRYPTION = ENC_KEY + PASSWORD;

const encrypt = (value: string) =>
  CryptoJS.AES.encrypt(value, PW_FOR_ENCRYPTION).toString();

const decryptPool = (encrypted: string): publicPrivateNonce[] =>
  JSON.parse(
    CryptoJS.AES.decrypt(encrypted, PW_FOR_ENCRYPTION).toString(
      CryptoJS.enc.Utf8,
    ),
  ) as publicPrivateNonce[];

const buildContext = (
  chains: { chain: string; xpubWallet: string }[],
  dispatch: jest.Mock,
) =>
  ({
    chainSyncData: { version: 1, chains },
    seedPhrase: encrypt('seed phrase'),
    sspWalletInternalIdentity: 'walletIdentity',
    sspWalletKeyInternalIdentity: 'wkIdentity',
    sspKeyInternalIdentity: 'keyIdentity',
    dispatch,
    displayMessage: jest.fn(),
    t: ((key: string) => key) as unknown as HomeActionContext['t'],
    setChainSyncProgress: jest.fn(),
    setActivityStatus: jest.fn(),
    setChainSyncData: jest.fn(),
    setBatchVerifyWords: jest.fn(),
    identityVerifyEntryRef: { current: null },
  }) as unknown as HomeActionContext;

const postedSyncData = () =>
  (axios.post as jest.Mock).mock.calls.map((call) => call[1] as syncSSPRelay);

const dispatchedPools = (dispatch: jest.Mock) =>
  dispatch.mock.calls
    .map((call) => call[0] as { type: string; payload: string })
    .filter((action) => action.type === 'seedphrase/setSspKeyPublicNonces');

beforeEach(() => {
  jest.clearAllMocks();
  mockNonceCounter = 0;
  for (const chain of Object.keys(storeState)) {
    delete storeState[chain];
  }
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(
    ({ service }: { service: string }) =>
      Promise.resolve(
        service === 'enc_key'
          ? { password: ENC_KEY }
          : { password: CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString() },
      ),
  );
  (axios.post as jest.Mock).mockResolvedValue({ data: {} });
});

const seedChain = (chain: string) => {
  storeState[chain] = {
    xpubKey: encrypt(`xpubKey-${chain}`),
    xprivKey: encrypt(`xprivKey-${chain}`),
  };
};

describe('processChainSyncBatch public nonces', () => {
  it('generates ONE pool for the whole batch and reports it for every EVM chain', async () => {
    seedChain('eth');
    seedChain('polygon');
    const dispatch = jest.fn();
    await processChainSyncBatch(
      buildContext(
        [
          { chain: 'eth', xpubWallet: 'xpubWallet-eth' },
          { chain: 'polygon', xpubWallet: 'xpubWallet-polygon' },
        ],
        dispatch,
      ),
    );
    // one pool of 50, not one per chain
    expect(mockGeneratePublicNonce).toHaveBeenCalledTimes(50);
    const pools = dispatchedPools(dispatch);
    expect(pools).toHaveLength(1);
    // both chains reported the SAME pool to the wallet…
    const posted = postedSyncData();
    expect(posted).toHaveLength(2);
    expect(posted[0].publicNonces).toHaveLength(50);
    expect(posted[1].publicNonces).toEqual(posted[0].publicNonces);
    // …and it is exactly the pool this device kept (public parts of it)
    const kept = decryptPool(pools[0].payload);
    expect(
      kept.map((nonce) => ({
        kPublic: nonce.kPublic,
        kTwoPublic: nonce.kTwoPublic,
      })),
    ).toEqual(posted[0].publicNonces);
  });

  it('never touches the pool for a batch without EVM chains', async () => {
    seedChain('flux');
    seedChain('ltc');
    const dispatch = jest.fn();
    await processChainSyncBatch(
      buildContext(
        [
          { chain: 'flux', xpubWallet: 'xpubWallet-flux' },
          { chain: 'ltc', xpubWallet: 'xpubWallet-ltc' },
        ],
        dispatch,
      ),
    );
    expect(mockGeneratePublicNonce).not.toHaveBeenCalled();
    expect(dispatchedPools(dispatch)).toHaveLength(0);
    const posted = postedSyncData();
    expect(posted).toHaveLength(2);
    expect(posted[0].publicNonces).toBeUndefined();
    expect(posted[1].publicNonces).toBeUndefined();
  });

  it('generates the pool once for a mixed batch, only for the EVM chain', async () => {
    seedChain('flux');
    seedChain('eth');
    const dispatch = jest.fn();
    await processChainSyncBatch(
      buildContext(
        [
          { chain: 'flux', xpubWallet: 'xpubWallet-flux' },
          { chain: 'eth', xpubWallet: 'xpubWallet-eth' },
        ],
        dispatch,
      ),
    );
    expect(mockGeneratePublicNonce).toHaveBeenCalledTimes(50);
    expect(dispatchedPools(dispatch)).toHaveLength(1);
    const posted = postedSyncData();
    expect(posted[0].publicNonces).toBeUndefined();
    expect(posted[1].publicNonces).toHaveLength(50);
  });
});

describe('syncChainToRelay public nonces (single-chain flow unchanged)', () => {
  it('generates and stores its own pool when none is supplied', async () => {
    const dispatch = jest.fn();
    await syncChainToRelay(
      buildContext([], dispatch),
      'eth',
      'xpubWallet-eth',
      PW_FOR_ENCRYPTION,
      encrypt('xpubKey-eth'),
      encrypt('xprivKey-eth'),
    );
    expect(mockGeneratePublicNonce).toHaveBeenCalledTimes(50);
    const pools = dispatchedPools(dispatch);
    expect(pools).toHaveLength(1);
    const posted = postedSyncData();
    expect(
      decryptPool(pools[0].payload).map((nonce) => ({
        kPublic: nonce.kPublic,
        kTwoPublic: nonce.kTwoPublic,
      })),
    ).toEqual(posted[0].publicNonces);
  });

  it('reuses a supplied pool without regenerating or overwriting', async () => {
    const dispatch = jest.fn();
    const supplied = [{ kPublic: 'kPublicX', kTwoPublic: 'kTwoPublicX' }];
    await syncChainToRelay(
      buildContext([], dispatch),
      'eth',
      'xpubWallet-eth',
      PW_FOR_ENCRYPTION,
      encrypt('xpubKey-eth'),
      encrypt('xprivKey-eth'),
      () => supplied,
    );
    expect(mockGeneratePublicNonce).not.toHaveBeenCalled();
    expect(dispatchedPools(dispatch)).toHaveLength(0);
    expect(postedSyncData()[0].publicNonces).toEqual(supplied);
  });
});
