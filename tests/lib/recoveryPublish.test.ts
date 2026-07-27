/**
 * The message signed when publishing the recovery account xpub.
 *
 * SSP Wallet rebuilds this exact string to verify the record it fetches from
 * the relay (ssp-wallet/src/lib/recoveryXpubVerify.ts), so the two builders are
 * byte-identical and both repos pin the same expectations. Drift here would
 * make the wallet reject genuine records.
 *
 * The signature itself is produced through lib/relayAuth.ts signMessage, whose
 * flux-sdk backend the global jest.setup.js mocks — the cross-repo signature
 * vector is asserted on the wallet side, where the real verifier runs.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import axios from 'axios';

import { recoveryXpubMessage } from '../../src/lib/recoveryPublish';
import { publishRecoveryXpub } from '../../src/screens/Home/actions/recoveryActions';
import type { HomeActionContext } from '../../src/screens/Home/actions/types';

jest.mock('react-native-keychain', () => ({ getGenericPassword: jest.fn() }));
jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../src/lib/recoveryPublish', () => {
  const actual = jest.requireActual('../../src/lib/recoveryPublish');
  return { ...actual, signRecoveryXpub: jest.fn(() => 'detached-signature') };
});

const mockedKeychain = Keychain as jest.Mocked<typeof Keychain>;
const mockedAxios = axios as jest.Mocked<typeof axios>;

const ENC_KEY = 'enc-key';
const PASSWORD = 'pw';
const PW = ENC_KEY + PASSWORD;

const WK = 'bc1qexamplewkidentity000000000000000000000';
const XPUB =
  'Zpub74BWc4YJJs2zaF4x2W8PUFKZyQxkxkgPuDCNKymYBADpqYbXGWj95kPE346PUFcpeGUivfougEkNvGcbnLhWwBD1rJ2q7gsfGcSHpW87L4p';

describe('recoveryXpubMessage', () => {
  it('is domain-separated and newline-delimited', () => {
    expect(recoveryXpubMessage('bc1qwk', 'Zpub123')).toBe(
      'ssp-recovery-xpub\nbc1qwk\nZpub123',
    );
  });

  it('binds the record to one identity', () => {
    // A record signed for one wkIdentity must not verify under another, so the
    // identity has to be inside the signed bytes.
    expect(recoveryXpubMessage(WK, XPUB)).not.toBe(
      recoveryXpubMessage('bc1qsomeoneelse', XPUB),
    );
    expect(recoveryXpubMessage(WK, XPUB)).toContain(WK);
  });

  it('binds the xpub itself', () => {
    expect(recoveryXpubMessage(WK, XPUB)).not.toBe(
      recoveryXpubMessage(WK, XPUB.slice(0, -1) + 'q'),
    );
    expect(recoveryXpubMessage(WK, XPUB)).toContain(XPUB);
  });

  it('matches the vector the wallet spec verifies against', () => {
    expect(recoveryXpubMessage(WK, XPUB)).toBe(
      `ssp-recovery-xpub\n${WK}\n${XPUB}`,
    );
  });
});
/**
 * The POST itself. The relay requires wkIdentity auth on this route, so the
 * body has to carry auth fields — a publish without them is rejected and the
 * record never appears, which no other test would notice.
 */
describe('publishRecoveryXpub', () => {
  const buildCtx = (overrides: Partial<HomeActionContext> = {}) => {
    const createWkAuth = jest.fn(() =>
      Promise.resolve({
        signature: 'auth-sig',
        message: 'auth-msg',
        publicKey: 'auth-pub',
        witnessScript: 'auth-witness',
      }),
    );
    return {
      ctx: {
        xpubRecovery: CryptoJS.AES.encrypt('Zpub-recovery', PW).toString(),
        identityChainState: {
          xprivKey: CryptoJS.AES.encrypt('xprv-identity', PW).toString(),
        },
        identityChain: 'btc',
        sspWalletKeyInternalIdentity: 'bc1qwkidentity',
        createWkAuth,
        ...overrides,
      } as unknown as HomeActionContext,
      createWkAuth,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedKeychain.getGenericPassword.mockImplementation(
      (options?: { service?: string }) =>
        Promise.resolve({
          service: options?.service ?? '',
          username: options?.service ?? '',
          password:
            options?.service === 'enc_key'
              ? ENC_KEY
              : CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString(),
        } as unknown as Awaited<
          ReturnType<typeof Keychain.getGenericPassword>
        >),
    );
    mockedAxios.post.mockResolvedValue({ data: {} });
  });

  it('posts the record with auth fields, and reports success', async () => {
    const { ctx, createWkAuth } = buildCtx();

    await expect(publishRecoveryXpub(ctx)).resolves.toBe(true);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, body] = mockedAxios.post.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(url).toMatch(/\/v1\/recoverypub$/);
    // The signed field travels as xpubSignature: `signature` belongs to the
    // relay's auth envelope and is stripped from bodies before a handler runs.
    expect(body).toMatchObject({
      wkIdentity: 'bc1qwkidentity',
      recoveryXpub: 'Zpub-recovery',
      xpubSignature: 'detached-signature',
      chain: 'btc',
      signature: 'auth-sig',
      message: 'auth-msg',
      publicKey: 'auth-pub',
      witnessScript: 'auth-witness',
    });

    // Auth is bound to the body, so a swapped xpub invalidates the signature.
    const [, wkIdentity, signedBody] = createWkAuth.mock
      .calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(wkIdentity).toBe('bc1qwkidentity');
    expect(signedBody).toMatchObject({ recoveryXpub: 'Zpub-recovery' });
  });

  it('does not post unsigned when auth is unavailable', async () => {
    const { ctx } = buildCtx();
    (ctx.createWkAuth as jest.Mock).mockResolvedValue(null);

    await expect(publishRecoveryXpub(ctx)).resolves.toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('reports failure when the relay rejects it, so the caller can retry', async () => {
    mockedAxios.post.mockRejectedValue(new Error('401'));
    const { ctx } = buildCtx();

    await expect(publishRecoveryXpub(ctx)).resolves.toBe(false);
  });

  it('does nothing before the recovery account is provisioned', async () => {
    const { ctx } = buildCtx({ xpubRecovery: '' });

    await expect(publishRecoveryXpub(ctx)).resolves.toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
