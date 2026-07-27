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

import type { publicPrivateNonce } from '../../src/types';
import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import { checkAndReplenishEnterpriseNonces } from '../../src/screens/Home/actions/nonceActions';

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

jest.mock('../../src/store/ssp', () => ({
  setSspKeyEnterprisePublicNonces: (data: string) => ({
    type: 'ssp/setSspKeyEnterprisePublicNonces',
    payload: data,
  }),
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
    ...overrides,
  } as unknown as HomeActionContext;
  return { ctx, dispatch };
};

describe('checkAndReplenishEnterpriseNonces', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNonceCounter = 0;
    withCredentials();
    mockedAxios.get.mockResolvedValue({
      data: { data: { key: { available: 0 }, replenishNeeded: { key: true } } },
    });
    mockedAxios.post.mockResolvedValue({ data: { data: { purged: 0 } } });
  });

  it('reports the submitted count on a successful forced sync', async () => {
    const { ctx, dispatch } = makeCtx();
    const result = await checkAndReplenishEnterpriseNonces(ctx, true);

    expect(result).toEqual({ ok: true, generated: 50 });
    const submit = mockedAxios.post.mock.calls.find((call) =>
      String(call[0]).endsWith('/v1/nonces'),
    );
    expect(submit).toBeDefined();
    expect((submit?.[1] as { nonces: unknown[] }).nonces).toHaveLength(50);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(ctx.nonceReplenishInProgressRef.current).toBe(false);
  });

  it('reports failure when the mandatory nonce submission fails', async () => {
    // THE BUG: this rejection is swallowed internally, so the caller used to
    // see a clean resolve and tell the user + the wallet the sync worked.
    mockedAxios.post.mockImplementation((url: string) =>
      String(url).endsWith('/v1/nonces')
        ? Promise.reject(new Error('relay unreachable'))
        : Promise.resolve({ data: { data: { purged: 0 } } }),
    );
    const { ctx, dispatch } = makeCtx();

    const result = await checkAndReplenishEnterpriseNonces(ctx, true);

    expect(result).toEqual({
      ok: false,
      generated: 0,
      reason: 'submit_failed',
    });
    // nothing was stored locally either — the pools stay consistent
    expect(dispatch).not.toHaveBeenCalled();
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
    const { ctx, dispatch } = makeCtx();

    expect(await checkAndReplenishEnterpriseNonces(ctx)).toEqual({
      ok: true,
      generated: 0,
      reason: 'not_needed',
    });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
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
    const { ctx, dispatch } = makeCtx({
      enterprisePublicNonces: CryptoJS.AES.encrypt(
        JSON.stringify(existing),
        ENC_KEY + PASSWORD,
      ).toString(),
    });

    expect(await checkAndReplenishEnterpriseNonces(ctx)).toEqual({
      ok: true,
      generated: 0,
      reason: 'not_needed',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
