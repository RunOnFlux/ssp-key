/**
 * H-7 / KEY-1 at sign time: handleSignWkAction re-checks the request right
 * before the identity key signs — the message classification AND the
 * walletSignature against the paired wallet's /10/0 key, which the Key derives
 * from the wallet identity xpub it stored at pairing. A relay or extension
 * without the wallet identity key cannot get anything signed, and a vault-xpub
 * attestation is refused even when the wallet signed it.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { HDKey } from '@scure/bip32';

import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import { handleSignWkAction } from '../../src/screens/Home/actions/signingActions';

jest.mock('react-native-keychain', () => ({ getGenericPassword: jest.fn() }));

const { fluxnode } = jest.requireActual<{
  fluxnode: {
    signMessage: (
      message: string,
      privKeyHex: string,
      compressed: boolean,
      prefix: string,
    ) => string;
  };
}>('@runonflux/flux-sdk');

const BTC_VERSIONS = { public: 0x02aa7ed3, private: 0x02aa7a99 };
const BTC_PREFIX = '\x18Bitcoin Signed Message:\n';
const ENC_KEY = 'enc-key';
const PASSWORD = 'pw';
const PW = ENC_KEY + PASSWORD;
const WK = 'bc1qpairedwkidentity';

const account = (seedByte: number) =>
  HDKey.fromMasterSeed(new Uint8Array(32).fill(seedByte), BTC_VERSIONS);
const wallet = account(1);
const key = account(2);
const attacker = account(3);
const leafPriv = (hd: HDKey) =>
  Buffer.from(
    hd.deriveChild(10).deriveChild(0).privateKey as Uint8Array,
  ).toString('hex');
const leafPub = (hd: HDKey) =>
  Buffer.from(
    hd.deriveChild(10).deriveChild(0).publicKey as Uint8Array,
  ).toString('hex');

const LOGIN = `1760000000000:SSP_ENTERPRISE_LOGIN:${'ab'.repeat(16)}:https://enterprise.sspwallet.com`;

const buildContext = (wkSigningData: Record<string, unknown>) =>
  ({
    wkSigningData,
    identityChain: 'btc',
    identityChainState: {
      xpubWallet: CryptoJS.AES.encrypt(wallet.publicExtendedKey, PW).toString(),
      xprivKey: CryptoJS.AES.encrypt(key.privateExtendedKey, PW).toString(),
    },
    sspWalletKeyInternalIdentity: WK,
    sspWalletKeyInternalIdentityPubKey: leafPub(key),
    postAction: jest.fn(() => Promise.resolve({})),
    displayMessage: jest.fn(),
    t: ((k: string) => k) as unknown as HomeActionContext['t'],
    setWkSigningData: jest.fn(),
    clearWkSigningRequest: jest.fn(),
  }) as unknown as HomeActionContext;

const request = (message: string, signer: HDKey = wallet) => ({
  message,
  walletSignature: fluxnode.signMessage(
    message,
    leafPriv(signer),
    true,
    BTC_PREFIX,
  ),
  walletPubKey: leafPub(signer),
  wkIdentity: WK,
  requestId: 'req-1',
});

beforeEach(() => {
  jest.clearAllMocks();
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(
    ({ service }: { service: string }) =>
      Promise.resolve(
        service === 'enc_key'
          ? { password: ENC_KEY }
          : { password: CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString() },
      ),
  );
});

const postedActions = (ctx: HomeActionContext) =>
  (ctx.postAction as jest.Mock).mock.calls.map((call) => call[0] as string);

describe('handleSignWkAction', () => {
  it('signs a login challenge the paired wallet signed', async () => {
    const ctx = buildContext(request(LOGIN));
    await handleSignWkAction(ctx);
    expect(postedActions(ctx)).toEqual(['wksigned']);
    const payload = JSON.parse(
      (ctx.postAction as jest.Mock).mock.calls[0][1] as string,
    );
    expect(payload).toMatchObject({ message: LOGIN, requestId: 'req-1' });
    expect(ctx.setWkSigningData).toHaveBeenCalledWith(null);
  });

  it('refuses a request signed by any other key (relay injection)', async () => {
    const ctx = buildContext(request(LOGIN, attacker));
    await handleSignWkAction(ctx);
    expect(postedActions(ctx)).toEqual(['wksigningrejected']);
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_wk_request_refused',
    );
  });

  it('refuses a vault-xpub attestation even with a valid wallet signature', async () => {
    const ctx = buildContext(
      request(`SSP_VAULT_XPUB:key:xpub${'a'.repeat(100)}:eth:150`),
    );
    await handleSignWkAction(ctx);
    expect(postedActions(ctx)).toEqual(['wksigningrejected']);
  });

  it('refuses a request for another wkIdentity', async () => {
    const ctx = buildContext({ ...request(LOGIN), wkIdentity: 'bc1qother' });
    await handleSignWkAction(ctx);
    expect(postedActions(ctx)).toEqual(['wksigningrejected']);
  });
});
