/**
 * Contract for the request-approval surfaces on SSP Key.
 *
 * Two things are pinned:
 *
 * 1. Reporting. Approving a wallet recovery request reports exactly one
 *    translated, actionable message on failure — never raw internal exception
 *    text — and confirms on success.
 *
 * 2. Copy. Each request type states its own consequence, Refresh distinguishes
 *    "nothing pending" from "cannot reach the relay", and the app describes
 *    itself the same way everywhere. The key -> string mapping itself is
 *    compile-checked (t() keys are typed against the en locale, so a missing or
 *    renamed key fails `tsc`), which is why these tests assert the copy's
 *    CONTENT rather than re-checking the mapping.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';

import { approveRecoveryRequest } from '../../src/screens/Home/actions/recoveryActions';
import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import homeEn from '../../src/translations/resources/en/home.json';
import createRestoreEn from '../../src/translations/resources/en/createrestore.json';

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
}));

jest.mock('../../src/lib/recoveryHandler', () => ({
  buildRecoveryResponse: jest.fn(() => ({
    transit: 'deadbeef',
    nonce: 'nonce',
    timestamp: 1,
  })),
}));

const mockedKeychain = Keychain as jest.Mocked<typeof Keychain>;

type KeychainResult = Awaited<ReturnType<typeof Keychain.getGenericPassword>>;

const ENC_KEY = 'enc-key';
const PASSWORD = 'pw';

describe('approveRecoveryRequest reporting', () => {
  const buildCtx = (overrides: Partial<HomeActionContext> = {}) => {
    const displayMessage = jest.fn();
    const postAction = jest.fn(() => Promise.resolve({}));
    const clearRecoveryRequest = jest.fn();
    const ctx = {
      recoveryRequest: { pkEph: '02aa', nonce: 'nonce', timestamp: 1 },
      identityChainState: { xprivKey: 'encrypted-xpriv' },
      // The recovery account m/48'/coin'/99'/scriptType' — the key this flow
      // releases. approveRecoveryRequest declines without it, so any fixture
      // expecting a response must provide it.
      xprivRecovery: CryptoJS.AES.encrypt(
        'xprv-recovery-account',
        ENC_KEY + PASSWORD,
      ).toString(),
      identityChain: 'btc',
      sspWalletKeyInternalIdentity: 'wkidentity',
      // t() is identity-mapped here, matching the react-i18next mock in
      // jest.setup.js — the assertions are on the KEY that reaches the toast
      t: ((key: string) => key) as unknown as HomeActionContext['t'],
      displayMessage,
      postAction,
      clearRecoveryRequest,
      ...overrides,
    } as unknown as HomeActionContext;
    return { ctx, displayMessage, postAction, clearRecoveryRequest };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports one actionable, translated error instead of internal text', async () => {
    // nothing in the keychain — the first internal throw
    mockedKeychain.getGenericPassword.mockResolvedValue(false);
    const { ctx, displayMessage, postAction, clearRecoveryRequest } =
      buildCtx();

    await approveRecoveryRequest(ctx);

    expect(postAction).not.toHaveBeenCalled();
    expect(displayMessage).toHaveBeenCalledTimes(1);
    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_recovery_failed',
    );
    expect(clearRecoveryRequest).toHaveBeenCalled();
  });

  it('does not leak the raw exception message to the user', async () => {
    mockedKeychain.getGenericPassword.mockResolvedValue({
      service: 'enc_key',
      username: 'enc_key',
      password: ENC_KEY,
    } as unknown as KeychainResult);
    // the stored xpriv is present but cannot be decrypted with that password —
    // the throw whose message names internal key material
    const { ctx, displayMessage } = buildCtx();

    await approveRecoveryRequest(ctx);

    const reported = displayMessage.mock.calls.map((call) => call[1]);
    for (const message of reported) {
      expect(message).not.toMatch(/xpriv/i);
      expect(message).not.toMatch(/decrypt/i);
    }
    expect(reported).toEqual(['home:err_recovery_failed']);
  });

  it('confirms on success, so the approval is not silent', async () => {
    mockedKeychain.getGenericPassword.mockImplementation(
      (options?: { service?: string }) =>
        Promise.resolve({
          service: options?.service ?? '',
          username: options?.service ?? '',
          // sspkey_pw holds the password encrypted with enc_key
          password:
            options?.service === 'enc_key'
              ? ENC_KEY
              : CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString(),
        } as unknown as KeychainResult),
    );
    const xprivEncrypted = CryptoJS.AES.encrypt(
      'xprv-identity',
      ENC_KEY + PASSWORD,
    ).toString();
    const { ctx, displayMessage, postAction, clearRecoveryRequest } = buildCtx({
      identityChainState: { xprivKey: xprivEncrypted },
    });

    await approveRecoveryRequest(ctx);

    expect(postAction).toHaveBeenCalledWith(
      'recoveryresponse',
      expect.any(String),
      'btc',
      '',
      'wkidentity',
    );
    expect(displayMessage).toHaveBeenCalledWith(
      'success',
      'home:recovery_request_approved_info',
    );
    expect(clearRecoveryRequest).toHaveBeenCalled();
  });
});

describe('approval gate copy', () => {
  it('states the consequence for a wallet recovery', () => {
    expect(homeEn.auth_recovery_info).toMatch(/recovery key/i);
    // it must not fall back to the generic sensitive-information wording
    expect(homeEn.auth_recovery_info).not.toBe(homeEn.auth_sensitive_inf);
    expect(homeEn.auth_recovery_info).not.toMatch(/view/i);
  });

  it('states the consequence for a flux node start', () => {
    expect(homeEn.auth_flux_node_start_info).toMatch(/flux node/i);
    expect(homeEn.auth_flux_node_start_info).toMatch(/sign/i);
    expect(homeEn.auth_confirm_flux_node_start).toMatch(/flux node/i);
    // the old biometric prompt claimed the user was about to VIEW information
    expect(homeEn.auth_confirm_flux_node_start).not.toBe(
      homeEn.auth_sensitive_information,
    );
    expect(homeEn.auth_flux_node_start_info).not.toMatch(/view/i);
  });

  it('spells sensitive correctly in the biometric prompt', () => {
    expect(homeEn.auth_sensitive_information).not.toMatch(/senstivie/);
  });
});

describe('refresh feedback copy', () => {
  it('separates an unreachable relay from an empty queue', () => {
    // the relay 404s when nothing is pending, so the error branch is also the
    // normal branch — the two outcomes must not share one message
    expect(homeEn.err_relay_unreachable).toMatch(/relay/i);
    expect(homeEn.err_relay_unreachable).not.toBe(homeEn.no_pending_actions);
    expect(homeEn.err_refresh_failed).not.toBe(homeEn.no_pending_actions);
    expect(homeEn.err_refresh_failed).not.toBe(homeEn.err_relay_unreachable);
  });
});

describe('product definition copy', () => {
  it('describes SSP Key the same way everywhere', () => {
    expect(homeEn.ssp_key_info).toBe(homeEn.ssp_help_about);
    expect(createRestoreEn.ssp_key_2fa).toBe(homeEn.ssp_key_info);
    // the Help string used to be ungrammatical: "Your Second Key Factor
    // authentication for your SSP Wallet."
    expect(homeEn.ssp_help_about).toMatch(/^SSP Key is /);
  });
});
