/**
 * Regression tests for the enterprise key-nonce replenish outcome.
 *
 * `checkAndReplenishEnterpriseNonces` wraps its whole body — including the
 * mandatory `POST /v1/nonces` — in a swallow-all handler so the background
 * pull-to-refresh path can never break Home, and it also returns early at
 * several guards. The manual "Sync Nonces" action in Home was written as if
 * the function could reject: it showed the success toast and told SSP Wallet
 * `enterprisekeynoncesynced` whenever no error was thrown, which was ALWAYS —
 * even when zero nonces reached the relay.
 *
 * The invariant asserted here: the function reports whether nonces were
 * actually submitted, so the caller can tell success from silence.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import axios from 'axios';
import { createMMKV } from 'react-native-mmkv';

import type { publicPrivateNonce } from '../../src/types';
import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import {
  checkAndReplenishEnterpriseNonces,
  isEnterpriseReplenishInFlight,
} from '../../src/screens/Home/actions/nonceActions';
import { burnEnterpriseNonce } from '../../src/lib/enterpriseNoncePool';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
}));

jest.mock('@storage/ssp', () => ({
  sspConfig: () => ({ relay: 'relay.example.com' }),
}));

// The real generator is exercised by tests/lib/wallet.test.ts; stub it so the
// 50-nonce loop is instant and the bookkeeping is the only thing under test.
let mockNonceCounter = 0;
jest.mock('../../src/lib/wallet', () => ({
  generatePublicNonce: (): publicPrivateNonce => {
    mockNonceCounter += 1;
    return {
      k: `k-${mockNonceCounter}`,
      kTwo: `kTwo-${mockNonceCounter}`,
      kPublic: `kPublic-${mockNonceCounter}`,
      kTwoPublic: `kTwoPublic-${mockNonceCounter}`,
    };
  },
}));

// RA-4 read-auth headers for the status GET (built from the store in the app).
const mockReadHeaders = jest.fn<
  Promise<Record<string, string> | null>,
  [string, string]
>(() => Promise.resolve({ 'x-ssp-signature': 'read-sig' }));
jest.mock('../../src/hooks/useRelayAuth', () => ({
  createReadAuthHeadersFromStore: (path: string, identity: string) =>
    mockReadHeaders(path, identity),
}));

// The pool lives in the persisted store; the replenish re-reads it at write
// time (K2) and flushes it (K4), so the test drives a fake store + persistor.
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

const mockedAxios = axios as unknown as {
  get: jest.Mock;
  post: jest.Mock;
};
const mockedKeychain = Keychain as unknown as {
  getGenericPassword: jest.Mock;
};

const ENC_KEY = 'enc-key-material';
const PASSWORD = 'user-password';

const withCredentials = () => {
  mockedKeychain.getGenericPassword.mockImplementation(
    (options?: { service?: string }) => {
      if (options?.service === 'enc_key') {
        return Promise.resolve({ password: ENC_KEY });
      }
      if (options?.service === 'sspkey_pw') {
        return Promise.resolve({
          password: CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString(),
        });
      }
      return Promise.resolve(false);
    },
  );
};

const makeCtx = (
  overrides: Partial<HomeActionContext> = {},
): { ctx: HomeActionContext; dispatch: jest.Mock } => {
  const dispatch = jest.fn();
  const ctx = {
    sspWalletKeyInternalIdentity: 'wk-identity',
    enterprisePublicNonces: '',
    nonceReplenishInProgressRef: { current: false },
    dispatch,
    createWkAuth: jest.fn(() =>
      Promise.resolve({ signature: 'sig', message: 'msg', publicKey: 'pk' }),
    ),
    ...overrides,
  } as unknown as HomeActionContext;
  return { ctx, dispatch };
};

const PW = ENC_KEY + PASSWORD;
const storedPool = (): publicPrivateNonce[] =>
  mockCipher
    ? (JSON.parse(
        CryptoJS.AES.decrypt(mockCipher, PW).toString(CryptoJS.enc.Utf8),
      ) as publicPrivateNonce[])
    : [];
const setStoredPool = (nonces: publicPrivateNonce[]) => {
  mockCipher = CryptoJS.AES.encrypt(JSON.stringify(nonces), PW).toString();
};

describe('checkAndReplenishEnterpriseNonces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNonceCounter = 0;
    mockCipher = '';
    createMMKV().clearAll();
    mockFlush.mockImplementation(() => Promise.resolve());
    withCredentials();
    mockedAxios.get.mockResolvedValue({
      data: { data: { key: { available: 0 }, replenishNeeded: { key: true } } },
    });
    mockedAxios.post.mockResolvedValue({ data: { data: { purged: 0 } } });
  });

  it('reports the submitted count on a successful forced sync', async () => {
    const { ctx } = makeCtx();
    const result = await checkAndReplenishEnterpriseNonces(ctx, true);

    expect(result).toEqual({ ok: true, generated: 50 });
    const submit = mockedAxios.post.mock.calls.find((call) =>
      String(call[0]).endsWith('/v1/nonces'),
    );
    expect(submit).toBeDefined();
    expect((submit?.[1] as { nonces: unknown[] }).nonces).toHaveLength(50);
    // stored in the persisted pool and flushed to disk
    expect(storedPool()).toHaveLength(50);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(ctx.nonceReplenishInProgressRef.current).toBe(false);
    expect(isEnterpriseReplenishInFlight()).toBe(false);
  });

  it('signs the status read with read-auth headers from createReadAuthHeadersFromStore (RA-4)', async () => {
    const { ctx } = makeCtx();
    await checkAndReplenishEnterpriseNonces(ctx, true);
    expect(mockReadHeaders).toHaveBeenCalledWith(
      '/v1/nonces/status/wk-identity',
      'wk-identity',
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://relay.example.com/v1/nonces/status/wk-identity',
      { headers: { 'x-ssp-signature': 'read-sig' } },
    );
  });

  it('fails closed when WK auth is unavailable: nothing is posted or stored', async () => {
    const { ctx } = makeCtx({
      createWkAuth: jest.fn(() => Promise.resolve(null)),
    });

    expect(await checkAndReplenishEnterpriseNonces(ctx, true)).toEqual({
      ok: false,
      generated: 0,
      reason: 'no_auth',
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockCipher).toBe('');
    expect(isEnterpriseReplenishInFlight()).toBe(false);
  });

  it('fails closed when signing throws, and also skips an unsigned reconcile', async () => {
    setStoredPool([
      {
        k: 'k-1',
        kTwo: 'kTwo-1',
        kPublic: 'kPublic-1',
        kTwoPublic: 'kTwoPublic-1',
      },
    ]);
    const before = mockCipher;
    const { ctx } = makeCtx({
      createWkAuth: jest.fn(() => Promise.reject(new Error('locked'))),
    });

    expect(await checkAndReplenishEnterpriseNonces(ctx, true)).toEqual({
      ok: false,
      generated: 0,
      reason: 'no_auth',
    });
    // neither the reconcile nor the submission went out unsigned
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockCipher).toBe(before);
  });

  it('signs the nonce submission with the WK identity (RA-2)', async () => {
    const { ctx } = makeCtx();
    await checkAndReplenishEnterpriseNonces(ctx, true);

    const submit = mockedAxios.post.mock.calls.find((call) =>
      String(call[0]).endsWith('/v1/nonces'),
    );
    const body = submit?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({
      wkIdentity: 'wk-identity',
      source: 'key',
      signature: 'sig',
      message: 'msg',
      publicKey: 'pk',
    });
    // the signature binds the body without the auth fields
    expect(ctx.createWkAuth).toHaveBeenCalledWith(
      'action',
      'wk-identity',
      expect.objectContaining({ wkIdentity: 'wk-identity', source: 'key' }),
    );
  });

  it('K2: a nonce burned by a signature during the relay round-trip is not written back', async () => {
    const existing = [
      {
        k: 'k-old',
        kTwo: 'kTwo-old',
        kPublic: 'kPublic-old',
        kTwoPublic: 'kTwoPublic-old',
      },
      {
        k: 'k-keep',
        kTwo: 'kTwo-keep',
        kPublic: 'kPublic-keep',
        kTwoPublic: 'kTwoPublic-keep',
      },
    ];
    setStoredPool(existing);
    mockedAxios.post.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/v1/nonces')) {
        // a vault signature consumes kPublic-old while the POST is in flight
        await burnEnterpriseNonce(
          { kPublic: 'kPublic-old', kTwoPublic: 'kTwoPublic-old' },
          PW,
        );
      }
      return { data: { data: { purged: 0 } } };
    });
    const { ctx } = makeCtx();

    const result = await checkAndReplenishEnterpriseNonces(ctx, true);

    expect(result.ok).toBe(true);
    const kPublics = storedPool().map((n) => n.kPublic);
    expect(kPublics).not.toContain('kPublic-old');
    expect(kPublics).toContain('kPublic-keep');
    expect(kPublics).toHaveLength(1 + (result.generated ?? 0));
  });

  it('K2: only one replenish runs at a time, across Home instances', async () => {
    let release: () => void = () => undefined;
    mockedAxios.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              data: {
                data: { key: { available: 0 }, replenishNeeded: { key: true } },
              },
            });
        }),
    );
    const first = checkAndReplenishEnterpriseNonces(makeCtx().ctx);
    // a remounted Home has a fresh ref, but the module lock still holds
    const second = await checkAndReplenishEnterpriseNonces(makeCtx().ctx);
    expect(second).toEqual({ ok: false, generated: 0, reason: 'busy' });
    release();
    expect((await first).ok).toBe(true);
    expect(isEnterpriseReplenishInFlight()).toBe(false);
  });

  it('reports failure when the mandatory nonce submission fails', async () => {
    // THE BUG: this rejection is swallowed internally, so the caller used to
    // see a clean resolve and tell the user + the wallet the sync worked.
    mockedAxios.post.mockImplementation((url: string) =>
      String(url).endsWith('/v1/nonces')
        ? Promise.reject(new Error('relay unreachable'))
        : Promise.resolve({ data: { data: { purged: 0 } } }),
    );
    const { ctx } = makeCtx();

    const result = await checkAndReplenishEnterpriseNonces(ctx, true);

    expect(result).toEqual({
      ok: false,
      generated: 0,
      reason: 'submit_failed',
    });
    // nothing was stored locally either — the pools stay consistent
    expect(mockCipher).toBe('');
    expect(ctx.nonceReplenishInProgressRef.current).toBe(false);
  });

  it('reports failure when the key material cannot be decrypted', async () => {
    mockedKeychain.getGenericPassword.mockResolvedValue(false);
    const { ctx } = makeCtx();

    const result = await checkAndReplenishEnterpriseNonces(ctx, true);

    expect(result).toEqual({
      ok: false,
      generated: 0,
      reason: 'no_credentials',
    });
    expect(mockedAxios.post).not.toHaveBeenCalledWith(
      expect.stringContaining('/v1/nonces'),
      expect.anything(),
    );
    expect(ctx.nonceReplenishInProgressRef.current).toBe(false);
  });

  it('reports failure when no wallet is synced yet', async () => {
    const { ctx } = makeCtx({ sspWalletKeyInternalIdentity: '' });

    expect(await checkAndReplenishEnterpriseNonces(ctx, true)).toEqual({
      ok: false,
      generated: 0,
      reason: 'no_identity',
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('reports failure when another replenish is already running', async () => {
    const { ctx } = makeCtx({
      nonceReplenishInProgressRef: { current: true },
    });

    expect(await checkAndReplenishEnterpriseNonces(ctx)).toEqual({
      ok: false,
      generated: 0,
      reason: 'busy',
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    // the in-flight replenish owns the guard — do not release it here
    expect(ctx.nonceReplenishInProgressRef.current).toBe(true);
  });

  it('reports a no-op background check as ok with nothing generated', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        data: { key: { available: 50 }, replenishNeeded: { key: false } },
      },
    });
    const { ctx } = makeCtx();

    expect(await checkAndReplenishEnterpriseNonces(ctx)).toEqual({
      ok: true,
      generated: 0,
      reason: 'not_needed',
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockCipher).toBe('');
    expect(ctx.nonceReplenishInProgressRef.current).toBe(false);
  });

  it('reports a full pool as ok with nothing generated', async () => {
    const existing: publicPrivateNonce[] = Array.from(
      { length: 50 },
      (_unused, index) => ({
        k: `k-${index}`,
        kTwo: `kTwo-${index}`,
        kPublic: `kPublic-${index}`,
        kTwoPublic: `kTwoPublic-${index}`,
      }),
    );
    mockedAxios.get.mockResolvedValue({
      data: {
        data: { key: { available: 50 }, replenishNeeded: { key: true } },
      },
    });
    setStoredPool(existing);
    const before = mockCipher;
    const { ctx } = makeCtx();

    expect(await checkAndReplenishEnterpriseNonces(ctx)).toEqual({
      ok: true,
      generated: 0,
      reason: 'not_needed',
    });
    expect(mockCipher).toBe(before);
  });
});
