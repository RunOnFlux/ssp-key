/**
 * Kaspa wiring in the Home actions:
 *  - approveTransaction (consumer): requires the displayed summary, passes
 *    min($100, 5 KAS) as maxFee and a flushable ledger, posts the txid of a
 *    maybe-broadcast and never reports it as a success, and offers the
 *    guarded reset on a corrupt ledger;
 *  - handleVaultSignAction (enterprise): the fail-closed decode gate, the kas
 *    co-sign branch and the wallet_only pass-through;
 *  - handleFluxNodeStart: refuses every chain but flux.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { Alert } from 'react-native';

import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import type { KasApprovedSummary } from '../../src/lib/kaspa';

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
}));

jest.mock('@storage/ssp', () => ({
  sspConfig: () => ({ relay: 'relay.example.com' }),
}));

const mockRate = jest.fn<Promise<number>, [string]>(() => Promise.resolve(0));
jest.mock('../../src/lib/rates', () => ({
  getCryptoUsdRate: (chain: string) => mockRate(chain),
}));

const mockCosign = jest.fn();
jest.mock('../../src/lib/constructTx', () => {
  const actual = jest.requireActual('../../src/lib/constructTx');
  return {
    ...actual,
    cosignAndBroadcastKASTransaction: (opts: unknown) => mockCosign(opts),
  };
});

jest.mock('../../src/lib/kaspa', () => {
  const actual = jest.requireActual('../../src/lib/kaspa');
  return { ...actual, kasVaultSpend: jest.fn(() => ({ kind: 'mock' })) };
});

const mockSignVault = jest.fn();
jest.mock('../../src/lib/kaspaVault', () => ({
  signKasVaultBundle: (opts: unknown) => mockSignVault(opts),
}));

jest.mock('../../src/lib/wallet', () => ({
  getMasterXpriv: jest.fn(() => 'vault-xpriv'),
  getMasterXpub: jest.fn(() => 'xpub'),
  generateMultisigAddress: jest.fn(() => ({
    address: 'kaspa:pvault',
    redeemScript: 'redeem',
  })),
  generateAddressKeypair: jest.fn(() => ({
    privKey: '11'.repeat(32),
    pubKey: '22'.repeat(32),
  })),
  generateSolanaPubkeyArray: jest.fn(() => []),
  generatePublicNonce: jest.fn(),
  deriveEVMPublicKey: jest.fn(),
  getLibId: jest.fn(() => 'kaspa'),
}));

import { approveTransaction } from '../../src/screens/Home/actions/signingActions';
import {
  handleFluxNodeStart,
  handleVaultSignAction,
} from '../../src/screens/Home/actions/vaultActions';
import { KasMaybeBroadcastError } from '../../src/lib/constructTx';
import { KAS_LEDGER_STORAGE_KEY } from '../../src/lib/kaspaLedger';
import { storage } from '../../src/store/index';

const ENC_KEY = 'enc-key';
const PASSWORD = 'password';
const PW = ENC_KEY + PASSWORD;
const encrypt = (v: string) => CryptoJS.AES.encrypt(v, PW).toString();

const KAS_TX = '{"format":"kaspa-core-signing-bundle","version":1}';
const APPROVED: KasApprovedSummary = {
  txid: 'ab'.repeat(32),
  fee: '20000',
  outputs: ['kaspa:qrecipient|150000000'],
};

function baseCtx(extra: Partial<HomeActionContext> = {}) {
  return {
    xpubKey: encrypt('xpub-key'),
    xpubWallet: encrypt('xpub-wallet'),
    xprivKey: encrypt('xpriv-key'),
    publicNonces: '',
    enterprisePublicNonces: '',
    seedPhrase: encrypt('seed words'),
    identityChain: 'btc',
    dispatch: jest.fn(),
    postAction: jest.fn(() => Promise.resolve()),
    displayMessage: jest.fn(),
    t: ((key: string) => key) as unknown as HomeActionContext['t'],
    sspWalletKeyInternalIdentity: 'wk',
    setSubmittingTransaction: jest.fn(),
    setRawTx: jest.fn(),
    setTxPath: jest.fn(),
    setTxUtxos: jest.fn(),
    setTxid: jest.fn(),
    clearVaultSigningState: jest.fn(),
    clearVaultSigningRequest: jest.fn(),
    ...extra,
  } as unknown as HomeActionContext & {
    postAction: jest.Mock;
    displayMessage: jest.Mock;
    setTxid: jest.Mock;
    setRawTx: jest.Mock;
  };
}

const keychain = Keychain.getGenericPassword as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockRate.mockImplementation(() => Promise.resolve(0));
  keychain.mockImplementation((opts: { service: string }) =>
    Promise.resolve(
      opts.service === 'enc_key'
        ? { password: ENC_KEY }
        : { password: CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString() },
    ),
  );
  storage.set(KAS_LEDGER_STORAGE_KEY, '{}');
});

describe('approveTransaction (kas)', () => {
  it('refuses to sign without the displayed summary', async () => {
    const ctx = baseCtx();
    await approveTransaction(ctx, KAS_TX, 'kas', '0-0', []);
    expect(mockCosign).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_kas_not_displayed',
    );
    expect(ctx.postAction).not.toHaveBeenCalled();
  });

  it('co-signs with the approved summary, a flushable ledger and maxFee = $100 at the rate', async () => {
    mockRate.mockImplementation(() => Promise.resolve(50)); // $50/KAS → 2 KAS
    mockCosign.mockResolvedValue('cd'.repeat(32));
    const ctx = baseCtx();
    await approveTransaction(ctx, KAS_TX, 'kas', '0-3', [], APPROVED);
    expect(mockCosign).toHaveBeenCalledTimes(1);
    const opts = mockCosign.mock.calls[0][0] as {
      approved: KasApprovedSummary;
      maxFee: bigint;
      bundleJson: string;
      ledger: { flush: unknown; get: unknown; set: unknown };
    };
    expect(opts.approved).toBe(APPROVED);
    expect(opts.bundleJson).toBe(KAS_TX);
    expect(opts.maxFee).toBe(200000000n);
    expect(typeof opts.ledger.flush).toBe('function');
    expect(ctx.postAction).toHaveBeenCalledWith(
      'txid',
      'cd'.repeat(32),
      'kas',
      '0-3',
      'wk',
    );
    expect(ctx.setTxid).toHaveBeenCalledWith('cd'.repeat(32));
  });

  it('caps maxFee at 5 KAS without a USD rate (and for cheap KAS)', async () => {
    mockCosign.mockResolvedValue('cd'.repeat(32));
    await approveTransaction(baseCtx(), KAS_TX, 'kas', '0-0', [], APPROVED);
    mockRate.mockImplementation(() => Promise.resolve(0.01)); // $100 = 10k KAS
    await approveTransaction(baseCtx(), KAS_TX, 'kas', '0-0', [], APPROVED);
    expect(
      mockCosign.mock.calls.map((c) => (c[0] as { maxFee: bigint }).maxFee),
    ).toEqual([500000000n, 500000000n]);
  });

  it('posts the txid of a maybe-broadcast and warns instead of reporting success', async () => {
    const txid = 'ef'.repeat(32);
    mockCosign.mockRejectedValue(new KasMaybeBroadcastError(txid));
    const ctx = baseCtx();
    await approveTransaction(ctx, KAS_TX, 'kas', '0-0', [], APPROVED);
    expect(ctx.postAction).toHaveBeenCalledWith(
      'txid',
      txid,
      'kas',
      '0-0',
      'wk',
    );
    expect(ctx.setRawTx).toHaveBeenCalledWith('');
    expect(ctx.setTxid).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_kas_maybe_broadcast',
      10000,
    );
  });

  it('a definite failure posts nothing', async () => {
    mockCosign.mockRejectedValue(new Error('amount differs'));
    const ctx = baseCtx();
    await approveTransaction(ctx, KAS_TX, 'kas', '0-0', [], APPROVED);
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith('error', 'amount differs');
  });

  it('a corrupt ledger fails closed and offers the guarded reset', async () => {
    storage.set(KAS_LEDGER_STORAGE_KEY, '{corrupt');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const ctx = baseCtx();
    await approveTransaction(ctx, KAS_TX, 'kas', '0-0', [], APPROVED);
    expect(mockCosign).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_kas_ledger_corrupt',
      8000,
    );
    expect(alert).toHaveBeenCalledTimes(1);
    // nothing reset until the user presses the destructive action
    expect(storage.getString(KAS_LEDGER_STORAGE_KEY)).toBe('{corrupt');
    const buttons = alert.mock.calls[0][2] as Array<{
      style?: string;
      onPress?: () => void;
    }>;
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    expect(storage.getString(KAS_LEDGER_STORAGE_KEY)).toBe('{}');
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'success',
      'home:kas_ledger_reset_done',
    );
    alert.mockRestore();
  });
});

describe('handleVaultSignAction (kas)', () => {
  const vaultData = (extra: Record<string, unknown> = {}) => ({
    chain: 'kas',
    orgIndex: 100,
    vaultIndex: 2,
    requestId: 'req-1',
    rawUnsignedTx: KAS_TX,
    walletSignedHex: '{"format":"kaspa-core-signing-bundle","version":1,"w":1}',
    inputDetails: [{ index: 0, addressIndex: 0, redeemScript: 'aa' }],
    recipients: [],
    fee: '0',
    signingMode: 'dual',
    ...extra,
  });
  const ok = { status: 'ok' as const, reasons: [], warnings: [] };

  it.each([
    ['pending (null)', null, false],
    [
      'failed',
      { status: 'failed' as const, reasons: ['x'], warnings: [] },
      true,
    ],
  ])('refuses a %s decode before touching any key', async (_l, state, msg) => {
    const ctx = baseCtx({
      vaultSigningData: vaultData() as never,
      kasDecodeState: state,
    });
    await handleVaultSignAction(ctx);
    expect(keychain).not.toHaveBeenCalled();
    expect(mockSignVault).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
    if (msg) {
      expect(ctx.displayMessage).toHaveBeenCalledWith(
        'error',
        'home:vault_sign_kas_decode_failed',
        8000,
      );
    }
  });

  it('refuses wallet_only too while the decode is not ok', async () => {
    const ctx = baseCtx({
      vaultSigningData: vaultData({ signingMode: 'wallet_only' }) as never,
      kasDecodeState: null,
    });
    await handleVaultSignAction(ctx);
    expect(ctx.postAction).not.toHaveBeenCalled();
  });

  it('co-signs with the vault key, a ledger and maxFee, and posts the merged bundle', async () => {
    mockRate.mockImplementation(() => Promise.resolve(100)); // → 1 KAS
    mockSignVault.mockResolvedValue({
      signedHex: '{"merged":true}',
      keyPubKey: 'kk',
      txid: 'tt',
    });
    const ctx = baseCtx({
      vaultSigningData: vaultData() as never,
      kasDecodeState: ok,
    });
    await handleVaultSignAction(ctx);
    const opts = mockSignVault.mock.calls[0][0] as {
      vaultXpriv: string;
      vaultIndex: number;
      maxFee: bigint;
      ledger: { flush: unknown };
    };
    expect(opts.vaultXpriv).toBe('vault-xpriv');
    expect(opts.vaultIndex).toBe(2);
    expect(opts.maxFee).toBe(100000000n);
    expect(typeof opts.ledger.flush).toBe('function');
    expect(ctx.postAction).toHaveBeenCalledWith(
      'enterprisevaultsigned',
      JSON.stringify({
        signedHex: '{"merged":true}',
        keyPubKey: 'kk',
        requestId: 'req-1',
      }),
      'kas',
      '',
      'wk',
    );
  });

  it('wallet_only passes the wallet bundle through without signing', async () => {
    const data = vaultData({ signingMode: 'wallet_only' });
    const ctx = baseCtx({
      vaultSigningData: data as never,
      kasDecodeState: ok,
    });
    await handleVaultSignAction(ctx);
    expect(mockSignVault).not.toHaveBeenCalled();
    expect(ctx.postAction).toHaveBeenCalledWith(
      'enterprisevaultsigned',
      JSON.stringify({
        signedHex: data.walletSignedHex,
        keyPubKey: '22'.repeat(32),
        requestId: 'req-1',
      }),
      'kas',
      '',
      'wk',
    );
  });

  it('a co-sign failure (e.g. the C1 mixed-script refusal) posts nothing', async () => {
    mockSignVault.mockRejectedValue(
      new Error('Kaspa proposal spends more than one vault script'),
    );
    const ctx = baseCtx({
      vaultSigningData: vaultData() as never,
      kasDecodeState: ok,
    });
    await handleVaultSignAction(ctx);
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('more than one vault script'),
      8000,
    );
  });
});

describe('handleFluxNodeStart', () => {
  const request = (chain: string) => ({
    requestId: 'node-1',
    chain,
    orgIndex: 100,
    vaultIndex: 0,
    addressIndex: 0,
    identityPubKey: '02'.padEnd(66, '1'),
    collateralTxid: 'aa'.repeat(32),
    collateralVout: 0,
    redeemScript: '52ae',
  });

  it.each(['kas', 'btc', 'solMainnet'])(
    'refuses %s before touching any key',
    async (chain) => {
      const ctx = baseCtx();
      await handleFluxNodeStart(ctx, request(chain));
      expect(keychain).not.toHaveBeenCalled();
      expect(ctx.displayMessage).toHaveBeenCalledWith(
        'error',
        'home:err_flux_node_flux_only',
      );
      expect(ctx.postAction).toHaveBeenCalledWith(
        'enterprisefluxnodestarted',
        JSON.stringify({
          requestId: 'node-1',
          error: 'Flux node start is only available for Flux vaults',
        }),
        chain,
        '',
        'wk',
      );
    },
  );

  it('lets flux through to key derivation', async () => {
    const ctx = baseCtx();
    await handleFluxNodeStart(ctx, request('flux'));
    expect(keychain).toHaveBeenCalled();
    expect(ctx.displayMessage).not.toHaveBeenCalledWith(
      'error',
      'home:err_flux_node_flux_only',
    );
  });
});
