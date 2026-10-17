/**
 * Chain-sync attestation (CS-1), refusal of silent re-pairing (CS-3 / KEY-7)
 * and signed /v1/sync posts (RA-2) on the SSP Key side.
 *
 * KEY-7: a relay-injected `chainsyncrequest` for an already-paired chain used
 * to overwrite the stored wallet xpub unconditionally, with the verification
 * words shown only after the commit. WEXT-2: nothing bound a synced key xpub
 * to the Key, so a relay could substitute it. These tests pin:
 *   - every non-identity sync carries keyXpubSignature over
 *     `SSP_CHAIN_SYNC:<chain>:<walletXpub>:<keyXpub>` by the identity key;
 *   - a different stored wallet xpub is never overwritten without an explicit
 *     confirmation, which is raised (with words) BEFORE anything is saved;
 *   - every POST /v1/sync is signed, and never sent unsigned.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import axios from 'axios';

import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import {
  chainSyncAttestationMessage,
  type ParsedChainSyncRequest,
} from '../../src/lib/chainSyncRequest';
import { sessionVerificationWords } from '../../src/lib/pairingVerification';

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

jest.mock('../../src/lib/chainSyncRequest', () => ({
  ...jest.requireActual('../../src/lib/chainSyncRequest'),
  CHAIN_SYNC_POST_SPACING_MS: 0,
}));

jest.mock('../../src/lib/fcmHelper', () => ({
  getFCMToken: jest.fn(() => Promise.resolve('fcm-token')),
}));

// Deterministic "signatures" so the signed bytes can be asserted.
jest.mock('../../src/lib/relayAuth', () => ({
  signMessage: jest.fn(
    (message: string, priv: string) => `sig(${priv}|${message})`,
  ),
  computeBodyHash: jest.fn(() => 'body-hash'),
  createMultisigAuth: jest.fn(
    (
      action: string,
      wkIdentity: string,
      _xpriv: string,
      witnessScript: string,
      publicKey: string,
    ) => ({
      signature: `multisig-sig(${action}|${wkIdentity})`,
      message: 'signed-payload',
      publicKey,
      witnessScript,
    }),
  ),
}));

const mockStoreState: Record<
  string,
  { xpubWallet?: string; xpubKey: string; xprivKey: string }
> = {};
jest.mock('../../src/store', () => ({
  __esModule: true,
  store: { getState: () => mockStoreState },
  storage: { getString: () => undefined },
  setXpubKey: jest.fn(),
  setXprivKey: jest.fn(),
  setXpubWallet: jest.fn(),
  setXpubWalletIdentity: jest.fn(),
}));

jest.mock('../../src/lib/wallet', () => ({
  getMasterXpriv: jest.fn(() => 'xpriv'),
  getMasterXpub: jest.fn(() => 'xpub'),
  generateMultisigAddress: jest.fn(
    (_w: string, _k: string, typeIndex: number, _a: number, chain: string) => ({
      address: `address-${chain}-${typeIndex}`,
      redeemScript: undefined,
      witnessScript: `witness-${chain}-${typeIndex}`,
    }),
  ),
  generateInternalIdentityAddress: jest.fn(
    (xpub: string) => `identity-of-${xpub}`,
  ),
  generateAddressKeypair: jest.fn(
    (xpriv: string, typeIndex: number, addressIndex: number) => ({
      privKey: `priv(${xpriv}/${typeIndex}/${addressIndex})`,
      pubKey: `pub(${xpriv}/${typeIndex}/${addressIndex})`,
    }),
  ),
  generatePublicNonce: jest.fn(() => ({
    k: 'k',
    kTwo: 'kTwo',
    kPublic: 'kPublic',
    kTwoPublic: 'kTwoPublic',
  })),
  generateSolanaPubkeyArray: jest.fn(() => []),
}));

import {
  generateAddressesForActiveChain,
  generateAddressesForSyncIdentity,
  processChainSyncBatch,
  storedPairingChange,
  syncChainToRelay,
} from '../../src/screens/Home/actions/syncActions';
import { setXpubWallet, setXpubWalletIdentity } from '../../src/store';
import { createMultisigAuth, signMessage } from '../../src/lib/relayAuth';

const ENC_KEY = 'enc-key';
const PASSWORD = 'password';
const PW = ENC_KEY + PASSWORD;
const encrypt = (value: string) => CryptoJS.AES.encrypt(value, PW).toString();

const WK = 'bc1qwk';
const posted = () =>
  (axios.post as jest.Mock).mock.calls.map(
    (call) => call[1] as Record<string, unknown>,
  );

const buildContext = (overrides: Record<string, unknown> = {}) =>
  ({
    chainSyncData: null,
    seedPhrase: encrypt('seed phrase'),
    sspWalletInternalIdentity: 'walletIdentity',
    sspWalletKeyInternalIdentity: WK,
    sspKeyInternalIdentity: 'keyIdentity',
    identityChain: 'btc',
    identityChainState: {
      xpubWallet: encrypt('identity-wallet-xpub'),
      xpubKey: encrypt('identity-key-xpub'),
      xprivKey: encrypt('identity-key-xpriv'),
    },
    xpubRecovery: '',
    xpubKey: encrypt('active-key-xpub'),
    xprivKey: encrypt('active-key-xpriv'),
    dispatch: jest.fn(),
    displayMessage: jest.fn(),
    t: ((key: string) => key) as unknown as HomeActionContext['t'],
    setChainSyncProgress: jest.fn(),
    setActivityStatus: jest.fn(),
    setChainSyncData: jest.fn(),
    setBatchVerifyWords: jest.fn(),
    setSyncReq: jest.fn(),
    setSyncSuccessOpen: jest.fn(),
    setActiveChain: jest.fn(),
    identityVerifyEntryRef: { current: null },
    createWkAuth: jest.fn(() =>
      Promise.resolve({
        signature: 'wk-sig',
        message: 'wk-msg',
        publicKey: 'key-identity-pub',
        witnessScript: 'identity-witness-script',
      }),
    ),
    ...overrides,
  }) as unknown as HomeActionContext;

const pair = (chain: string, walletXpub?: string) => {
  mockStoreState[chain] = {
    ...(walletXpub ? { xpubWallet: encrypt(walletXpub) } : {}),
    xpubKey: encrypt(`key-xpub-${chain}`),
    xprivKey: encrypt(`key-xpriv-${chain}`),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const chain of Object.keys(mockStoreState)) {
    delete mockStoreState[chain];
  }
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(
    ({ service }: { service: string }) =>
      Promise.resolve(
        service === 'enc_key'
          ? { password: ENC_KEY }
          : { password: CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString() },
      ),
  );
});

describe('storedPairingChange', () => {
  it('distinguishes new, same and replace', () => {
    expect(storedPairingChange('eth', 'xpub-a', PW)).toBe('new');
    pair('eth', 'xpub-a');
    expect(storedPairingChange('eth', 'xpub-a', PW)).toBe('same');
    expect(storedPairingChange('eth', 'xpub-b', PW)).toBe('replace');
  });

  it('treats a stored blob it cannot decrypt as a different pairing', () => {
    mockStoreState.eth = {
      xpubWallet: CryptoJS.AES.encrypt('xpub-a', 'other-key').toString(),
      xpubKey: '',
      xprivKey: '',
    };
    expect(storedPairingChange('eth', 'xpub-a', PW)).toBe('replace');
  });
});

describe('syncChainToRelay (CS-1 attestation + RA-2 auth)', () => {
  it('attests (chain, walletXpub, keyXpub) with the identity key and signs the post', async () => {
    const ctx = buildContext();
    await syncChainToRelay(
      ctx,
      'flux',
      'wallet-xpub-flux',
      PW,
      encrypt('key-xpub-flux'),
      encrypt('key-xpriv-flux'),
    );
    const [body] = posted();
    // identity key m/…/10/0 derived from the IDENTITY xpriv, not the chain's
    expect(signMessage).toHaveBeenCalledWith(
      chainSyncAttestationMessage('flux', 'wallet-xpub-flux', 'key-xpub-flux'),
      'priv(identity-key-xpriv/10/0)',
      'btc',
    );
    expect(body.keyXpubSignature).toBe(
      `sig(priv(identity-key-xpriv/10/0)|SSP_CHAIN_SYNC:flux:wallet-xpub-flux:key-xpub-flux)`,
    );
    // wkIdentity auth over the body WITHOUT any auth fields
    expect(ctx.createWkAuth).toHaveBeenCalledWith(
      'sync',
      WK,
      expect.not.objectContaining({ signature: expect.anything() }),
    );
    const signedBody = (ctx.createWkAuth as jest.Mock).mock.calls[0][2];
    expect(signedBody.keyXpubSignature).toBe(body.keyXpubSignature);
    // The address-0 script travels as chainWitnessScript so it cannot collide
    // with the auth witnessScript; the relay stores it back as witnessScript.
    expect(signedBody.witnessScript).toBeUndefined();
    expect(signedBody.chainWitnessScript).toBe('witness-flux-0');
    expect(body).toMatchObject({
      chain: 'flux',
      wkIdentity: WK,
      keyXpub: 'key-xpub-flux',
      walletXpub: 'wallet-xpub-flux',
      signature: 'wk-sig',
      message: 'wk-msg',
      publicKey: 'key-identity-pub',
      // the relay's multisig auth needs the IDENTITY script in this field
      witnessScript: 'identity-witness-script',
    });
    expect(setXpubWallet).toHaveBeenCalledWith('flux', expect.any(String));
  });

  it('never posts an unsigned sync', async () => {
    const ctx = buildContext({
      createWkAuth: jest.fn(() => Promise.resolve(null)),
    });
    await expect(
      syncChainToRelay(
        ctx,
        'flux',
        'wallet-xpub-flux',
        PW,
        encrypt('key-xpub-flux'),
        encrypt('key-xpriv-flux'),
      ),
    ).rejects.toThrow('Relay authentication unavailable');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('omits the attestation (wallet then requires the code) when the identity key is unavailable', async () => {
    const ctx = buildContext({ identityChainState: {} });
    await syncChainToRelay(
      ctx,
      'flux',
      'wallet-xpub-flux',
      PW,
      encrypt('key-xpub-flux'),
      encrypt('key-xpriv-flux'),
    );
    expect(posted()[0].keyXpubSignature).toBeUndefined();
  });
});

describe('processChainSyncBatch (CS-3)', () => {
  const batch = (chains: { chain: string; xpubWallet: string }[]) =>
    ({ version: 1, chains }) as unknown as ParsedChainSyncRequest;

  it('raises a re-pair confirmation with words BEFORE saving anything', async () => {
    pair('eth', 'old-wallet-xpub-eth');
    pair('flux'); // not paired yet
    const onRePairRequired = jest.fn();
    const request = batch([
      { chain: 'eth', xpubWallet: 'attacker-xpub-eth' },
      { chain: 'flux', xpubWallet: 'wallet-xpub-flux' },
    ]);
    await processChainSyncBatch(buildContext({ chainSyncData: request }), {
      onRePairRequired,
    });
    expect(axios.post).not.toHaveBeenCalled();
    expect(setXpubWallet).not.toHaveBeenCalled();
    expect(onRePairRequired).toHaveBeenCalledTimes(1);
    const raised = onRePairRequired.mock.calls[0][0];
    expect(raised).toMatchObject({ kind: 'batch', chains: ['eth'], request });
    // the words are the session code of the NEW pairing — what this device
    // will show after the sync and what SSP Wallet must show
    expect(raised.words).toEqual(
      sessionVerificationWords([
        {
          chain: 'eth',
          walletXpub: 'attacker-xpub-eth',
          keyXpub: 'key-xpub-eth',
        },
        {
          chain: 'flux',
          walletXpub: 'wallet-xpub-flux',
          keyXpub: 'key-xpub-flux',
        },
      ]),
    );
  });

  it('fails closed when nobody can confirm', async () => {
    pair('eth', 'old-wallet-xpub-eth');
    const ctx = buildContext({
      chainSyncData: batch([{ chain: 'eth', xpubWallet: 'attacker-xpub' }]),
    });
    await processChainSyncBatch(ctx);
    expect(axios.post).not.toHaveBeenCalled();
    expect(setXpubWallet).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_sync_failed',
    );
  });

  it('re-syncs the SAME pairing without asking', async () => {
    pair('eth', 'wallet-xpub-eth');
    const onRePairRequired = jest.fn();
    await processChainSyncBatch(
      buildContext({
        chainSyncData: batch([{ chain: 'eth', xpubWallet: 'wallet-xpub-eth' }]),
      }),
      { onRePairRequired },
    );
    expect(onRePairRequired).not.toHaveBeenCalled();
    expect(posted()).toHaveLength(1);
  });

  it('replaces only after explicit confirmation, replaying the held request', async () => {
    pair('eth', 'old-wallet-xpub-eth');
    const request = batch([
      { chain: 'eth', xpubWallet: 'new-wallet-xpub-eth' },
    ]);
    const ctx = buildContext({ chainSyncData: null });
    await processChainSyncBatch(ctx, { confirmedRePair: true, request });
    expect(setXpubWallet).toHaveBeenCalledWith('eth', expect.any(String));
    const stored = (setXpubWallet as jest.Mock).mock.calls[0][1] as string;
    expect(CryptoJS.AES.decrypt(stored, PW).toString(CryptoJS.enc.Utf8)).toBe(
      'new-wallet-xpub-eth',
    );
    expect(posted()[0]).toMatchObject({
      chain: 'eth',
      walletXpub: 'new-wallet-xpub-eth',
    });
    expect(ctx.setBatchVerifyWords).toHaveBeenCalled();
  });
});

describe('single-chain QR sync (CS-3)', () => {
  it('raises a confirmation instead of overwriting another wallet xpub', async () => {
    pair('eth', 'old-wallet-xpub-eth');
    const onRePairRequired = jest.fn();
    const ctx = buildContext({
      xpubKey: encrypt('key-xpub-eth'),
      xprivKey: encrypt('key-xpriv-eth'),
    });
    await generateAddressesForActiveChain(ctx, 'new-wallet-xpub-eth', 'eth', {
      onRePairRequired,
    });
    expect(setXpubWallet).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(onRePairRequired).toHaveBeenCalledWith({
      kind: 'single',
      chains: ['eth'],
      chain: 'eth',
      xpubWallet: 'new-wallet-xpub-eth',
      words: sessionVerificationWords([
        {
          chain: 'eth',
          walletXpub: 'new-wallet-xpub-eth',
          keyXpub: 'key-xpub-eth',
        },
      ]),
    });
  });

  it('saves after confirmation', async () => {
    pair('eth', 'old-wallet-xpub-eth');
    const ctx = buildContext({
      xpubKey: encrypt('key-xpub-eth'),
      xprivKey: encrypt('key-xpriv-eth'),
    });
    await generateAddressesForActiveChain(ctx, 'new-wallet-xpub-eth', 'eth', {
      confirmedRePair: true,
    });
    expect(setXpubWallet).toHaveBeenCalledWith('eth', expect.any(String));
    expect(ctx.setSyncSuccessOpen).toHaveBeenCalledWith(true);
  });

  it('re-pairing the identity chain to another wallet needs confirmation too', async () => {
    pair('btc', 'old-identity-wallet-xpub');
    const onRePairRequired = jest.fn();
    const ctx = buildContext({
      xpubKey: encrypt('identity-key-xpub'),
      xprivKey: encrypt('identity-key-xpriv'),
    });
    await generateAddressesForSyncIdentity(ctx, 'new-identity-wallet-xpub', {
      onRePairRequired,
    });
    expect(setXpubWalletIdentity).not.toHaveBeenCalled();
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
    expect(onRePairRequired.mock.calls[0][0]).toMatchObject({
      kind: 'single',
      chain: 'btc',
      chains: ['btc'],
    });
  });

  it('first identity pairing posts a sync signed as the new wkIdentity', async () => {
    const ctx = buildContext({
      xpubKey: encrypt('identity-key-xpub'),
      xprivKey: encrypt('identity-key-xpriv'),
    });
    await generateAddressesForSyncIdentity(ctx, 'identity-wallet-xpub');
    expect(setXpubWalletIdentity).toHaveBeenCalled();
    expect(createMultisigAuth).toHaveBeenCalledWith(
      'sync',
      'address-btc-10',
      'identity-key-xpriv',
      'witness-btc-10',
      'pub(identity-key-xpriv/10/0)',
      'btc',
      'body-hash',
    );
    expect(posted()[0]).toMatchObject({
      wkIdentity: 'address-btc-10',
      signature: 'multisig-sig(sync|address-btc-10)',
      witnessScript: 'witness-btc-10',
    });
    expect(ctx.setSyncSuccessOpen).toHaveBeenCalledWith(true);
  });
});
