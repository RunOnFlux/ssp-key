/**
 * Sign-time guards of the enterprise vault actions.
 *
 * - H-1: an org index outside 100–99999 never reaches key derivation, even if
 *   it slipped past receipt (vault sign, vault xpub, Flux node start).
 * - CHN-5: only the request armed by the approval screen is signed; a
 *   message request on a non-EVM chain is refused.
 * - EVM call-safety: an unsafe operation is refused before any nonce burns.
 * - K4: the reserved nonce is burned (ledger entry + flushed pool) BEFORE the
 *   partial signature is produced, and a failed flush sends nothing.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { createMMKV } from 'react-native-mmkv';
import { encodeFunctionData, erc20Abi } from 'viem';
import * as abi from '@runonflux/aa-schnorr-multisig-sdk/dist/abi';

import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import type { publicPrivateNonce } from '../../src/types';
import {
  handleFluxNodeStart,
  handleVaultSignAction,
  handleVaultXpubAction,
} from '../../src/screens/Home/actions/vaultActions';
import {
  armVaultApproval,
  disarmVaultApproval,
  vaultRequestDigest,
} from '../../src/lib/vaultApprovalBinding';
import { isNonceTombstoned } from '../../src/lib/enterpriseNonceLedger';

const mockEvents: string[] = [];

// The Key's own USD rate (fee caps): no network in tests.
jest.mock('../../src/lib/rates', () => ({
  ...jest.requireActual('../../src/lib/rates'),
  getCryptoUsdRate: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
}));
jest.mock('../../src/lib/wallet', () => ({
  getMasterXpriv: jest.fn(() => 'xpriv'),
  getMasterXpub: jest.fn(() => 'xpub'),
  generateAddressKeypair: jest.fn(() => ({ privKey: 'priv', pubKey: 'pub' })),
  generateSolanaPubkeyArray: jest.fn(() => []),
  getLibId: jest.fn(() => 'bitcoin'),
}));
jest.mock('../../src/lib/evmSigning', () => ({
  continueVaultSigningSchnorrMultisig: jest.fn(() => {
    mockEvents.push('sign');
    return { signerContribution: 'contribution', challenge: 'challenge' };
  }),
}));
jest.mock('../../src/lib/userOpVerify', () => ({
  userOpHashMatches: jest.fn(() => true),
  messageDigestMatches: jest.fn(() => true),
}));
jest.mock('../../src/lib/relayAuth', () => ({
  signMessage: jest.fn(() => 'identity-signature'),
}));
// The vault descriptor checks (VD-3 / VD-4) have their own suites
// (vaultDescriptorGate, vaultDescriptorSignAction); here they pass so the
// other sign-time guards can be exercised on their own.
jest.mock('../../src/lib/vaultDescriptorGate', () => {
  const actual = jest.requireActual('../../src/lib/vaultDescriptorGate');
  return {
    ...actual,
    requireVaultDescriptor: jest.fn(() => ({
      kind: 'ok',
      descriptor: {},
      hash: 'h',
      pinKey: 'k',
      persisted: true,
    })),
    checkVaultEvmAccount: jest.fn(() => null),
    checkVaultUtxoTransaction: jest.fn(() => ({
      ok: true,
      sender: '',
      recipients: [],
      inputs: [],
    })),
    vaultSolBinding: jest.fn(() => ({
      multisigPda: 'multisig-pda',
      vaultPda: 'vault-pda',
      members: ['pub'],
      threshold: 2,
    })),
    checkFluxNodeCollateral: jest.fn(() => null),
  };
});

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
  // storage/backends reads its overrides from the app MMKV store
  storage: (
    require('react-native-mmkv') as typeof import('react-native-mmkv')
  ).createMMKV(),
}));

const wallet = require('../../src/lib/wallet') as {
  getMasterXpriv: jest.Mock;
  getMasterXpub: jest.Mock;
};

const ENC_KEY = 'enc-key';
const PASSWORD = 'password';
const PW = ENC_KEY + PASSWORD;
const VAULT = '0x1111111111111111111111111111111111111111';
const TOKEN = '0x3333333333333333333333333333333333333333';

const NONCE: publicPrivateNonce = {
  k: 'k',
  kTwo: 'kTwo',
  kPublic: 'kPublic-1',
  kTwoPublic: 'kTwoPublic-1',
};

const evmCall = (target: string, data: `0x${string}`) =>
  encodeFunctionData({
    abi: abi.MultiSigSmartAccount_abi,
    functionName: 'execute',
    args: [target as `0x${string}`, 0n, data],
  });
const transfer = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: ['0x4444444444444444444444444444444444444444', 5n],
});

const evmRequest = (overrides: Record<string, unknown> = {}) => ({
  chain: 'eth',
  orgIndex: 100,
  vaultIndex: 0,
  rawUnsignedTx: '0xhash',
  evmUserOp: JSON.stringify({
    sender: VAULT,
    nonce: '0x0',
    initCode: '0x',
    callData: evmCall(TOKEN, transfer),
    callGasLimit: '0x1',
    verificationGasLimit: '0x1',
    preVerificationGas: '0x1',
    maxFeePerGas: '0x1',
    maxPriorityFeePerGas: '0x1',
    paymasterAndData: '0x',
    signature: '0x',
  }),
  inputDetails: [{ index: 0, addressIndex: 0 }],
  reservedNonce: { kPublic: NONCE.kPublic, kTwoPublic: NONCE.kTwoPublic },
  sigOne: 'sig-one',
  allSignerKeys: ['a', 'b'],
  allSignerNonces: [
    { kPublic: 'x', kTwoPublic: 'y' },
    { kPublic: NONCE.kPublic, kTwoPublic: NONCE.kTwoPublic },
  ],
  signingMode: 'dual',
  requestId: 'req-1',
  recipients: [],
  fee: '0',
  ...overrides,
});

const makeCtx = (overrides: Partial<HomeActionContext> = {}) => {
  const postAction = jest.fn<Promise<void>, [string, string]>((action) => {
    mockEvents.push(`post:${action}`);
    return Promise.resolve();
  });
  const displayMessage = jest.fn();
  const ctx = {
    seedPhrase: CryptoJS.AES.encrypt('seed words', PW).toString(),
    identityChain: 'btc',
    identityChainState: {
      xprivKey: CryptoJS.AES.encrypt('identity-xpriv', PW).toString(),
    },
    sspWalletKeyInternalIdentity: 'wk',
    solDecodeState: null,
    postAction,
    displayMessage,
    t: (key: string) => key,
    setVaultXpubData: jest.fn(),
    clearVaultXpubRequest: jest.fn(),
    clearVaultSigningState: jest.fn(),
    clearVaultSigningRequest: jest.fn(),
    ...overrides,
  } as unknown as HomeActionContext;
  return { ctx, postAction, displayMessage };
};

const signWith = async (request: Record<string, unknown>, arm = true) => {
  const { ctx, postAction, displayMessage } = makeCtx({
    vaultSigningData:
      request as unknown as HomeActionContext['vaultSigningData'],
  });
  if (arm) {
    armVaultApproval(vaultRequestDigest(request));
  }
  await handleVaultSignAction(ctx);
  return { postAction, displayMessage };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents.length = 0;
  createMMKV().clearAll();
  disarmVaultApproval();
  mockCipher = CryptoJS.AES.encrypt(JSON.stringify([NONCE]), PW).toString();
  mockFlush.mockImplementation(() => {
    mockEvents.push(`flush:${isNonceTombstoned(NONCE.kPublic)}`);
    return Promise.resolve();
  });
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(
    (options?: { service?: string }) =>
      Promise.resolve(
        options?.service === 'enc_key'
          ? { password: ENC_KEY }
          : {
              password: CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString(),
            },
      ),
  );
});

describe('handleVaultSignAction', () => {
  it('K4: burns the nonce durably before the partial signature is produced and sent', async () => {
    const { postAction } = await signWith(evmRequest());

    // ledger entry existed at flush time; flush → sign → post
    expect(mockEvents).toEqual([
      'flush:true',
      'sign',
      'post:enterprisevaultsigned',
    ]);
    expect(postAction).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(postAction.mock.calls[0][1]) as {
      usedNonce: { kPublic: string };
    };
    expect(payload.usedNonce.kPublic).toBe(NONCE.kPublic);
  });

  it("EVM: a refusal of this device's own signer key burns and signs nothing", async () => {
    const gate = jest.requireMock('../../src/lib/vaultDescriptorGate');
    gate.checkVaultEvmAccount.mockReturnValueOnce(
      "this device's key is not one of the request's signer keys",
    );
    const { displayMessage } = await signWith(evmRequest());
    // the Key signs (dual mode), so its own key was required
    expect(gate.checkVaultEvmAccount.mock.calls.at(-1)?.[4]).toBe('pub');
    expect(mockEvents).not.toContain('sign');
    expect(mockEvents.some((e) => e.startsWith('flush'))).toBe(false);
    expect(mockEvents).toEqual(['post:enterprisevaultsignrejected']);
    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('err_vault_sign_failed'),
      8000,
    );
  });

  it('K4: a failed flush aborts — nothing is signed or sent', async () => {
    mockFlush.mockImplementation(() => Promise.reject(new Error('disk')));
    const { postAction, displayMessage } = await signWith(evmRequest());

    expect(mockEvents).not.toContain('sign');
    expect(postAction).not.toHaveBeenCalled();
    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('home:err_vault_nonce_persist_failed'),
      8000,
    );
  });

  it('K2: a nonce this device already used is never signed with again', async () => {
    await signWith(evmRequest());
    // the relay re-sends the same reservation and the pool somehow has it
    mockCipher = CryptoJS.AES.encrypt(JSON.stringify([NONCE]), PW).toString();
    mockEvents.length = 0;
    const { postAction } = await signWith(evmRequest({ requestId: 'req-2' }));

    expect(mockEvents).not.toContain('sign');
    expect(postAction).not.toHaveBeenCalled();
  });

  it('CHN-5: refuses a request that was not the one approved on screen', async () => {
    const shown = evmRequest();
    const swapped = evmRequest({ rawUnsignedTx: '0xother' });
    armVaultApproval(vaultRequestDigest(shown));
    const { ctx, postAction, displayMessage } = makeCtx({
      vaultSigningData:
        swapped as unknown as HomeActionContext['vaultSigningData'],
    });

    await handleVaultSignAction(ctx);

    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_vault_request_changed',
      8000,
    );
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
    expect(postAction).not.toHaveBeenCalled();
    // the swapped request stays open for review
    expect(ctx.clearVaultSigningState).not.toHaveBeenCalled();
  });

  it('refuses without any approval at all', async () => {
    const { postAction } = await signWith(evmRequest(), false);
    expect(postAction).not.toHaveBeenCalled();
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
  });

  it('H-1: refuses consumer (0) and recovery (99) accounts at sign time, before derivation', async () => {
    for (const orgIndex of [0, 99, '100', 100.5]) {
      const { postAction } = await signWith(evmRequest({ orgIndex }));
      expect(postAction).not.toHaveBeenCalled();
    }
    expect(wallet.getMasterXpriv).not.toHaveBeenCalled();
    expect(mockEvents).not.toContain('sign');
  });

  it('H-1: refuses an invalid address index on a UTXO request', async () => {
    const { postAction } = await signWith({
      chain: 'btc',
      orgIndex: 100,
      vaultIndex: 0,
      rawUnsignedTx: '0200',
      walletSignedHex: '0200',
      inputDetails: [{ index: 0, addressIndex: -1 }],
      requestId: 'r',
    });
    expect(postAction).not.toHaveBeenCalled();
    expect(wallet.getMasterXpriv).not.toHaveBeenCalled();
  });

  it('EVM call-safety: an operation calling the vault itself is refused before the nonce burns', async () => {
    const request = evmRequest({
      evmUserOp: JSON.stringify({
        ...(JSON.parse(evmRequest().evmUserOp) as Record<string, unknown>),
        callData: evmCall(VAULT, '0x'),
      }),
    });
    const { postAction } = await signWith(request);
    expect(postAction).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
    expect(isNonceTombstoned(NONCE.kPublic)).toBe(false);
  });

  it('CHN-5: refuses a message signature on a Solana vault', async () => {
    const { postAction } = await signWith({
      chain: 'solMainnet',
      orgIndex: 100,
      vaultIndex: 0,
      rawUnsignedTx: 'AQID',
      signMessage: 'Sign in to dApp',
      requestId: 'r',
    });
    expect(postAction).not.toHaveBeenCalled();
  });

  it('Solana: refuses undecodable bytes and verdicts that belong to another request', async () => {
    const request = {
      chain: 'solMainnet',
      orgIndex: 100,
      vaultIndex: 0,
      rawUnsignedTx: 'AQID',
      inputDetails: [{ addressIndex: 0 }],
      requestId: 'r',
    };
    const digest = vaultRequestDigest(request);
    for (const solDecodeState of [
      {
        kind: 'undecodable',
        mismatch: false,
        mismatchReasons: [],
        requestDigest: digest,
      },
      {
        kind: 'create',
        mismatch: false,
        mismatchReasons: [],
        requestDigest: 'another-request',
      },
    ]) {
      armVaultApproval(digest);
      const { ctx, postAction } = makeCtx({
        vaultSigningData:
          request as unknown as HomeActionContext['vaultSigningData'],
        solDecodeState: solDecodeState as HomeActionContext['solDecodeState'],
      });
      await handleVaultSignAction(ctx);
      expect(postAction).not.toHaveBeenCalled();
    }
    expect(wallet.getMasterXpriv).not.toHaveBeenCalled();
  });

  it('SOL-7: refuses when this device is not a verified member of the multisig', async () => {
    const request = {
      chain: 'solMainnet',
      orgIndex: 100,
      vaultIndex: 0,
      rawUnsignedTx: 'AQID',
      inputDetails: [{ addressIndex: 0 }],
      requestId: 'r',
    };
    const digest = vaultRequestDigest(request);
    armVaultApproval(digest);
    const { ctx, postAction, displayMessage } = makeCtx({
      vaultSigningData:
        request as unknown as HomeActionContext['vaultSigningData'],
      solDecodeState: {
        kind: 'approve',
        mismatch: false,
        mismatchReasons: [],
        requestDigest: digest,
        members: ['someone-else'],
        multisigPda: 'multisig-pda',
      },
    });
    await handleVaultSignAction(ctx);
    expect(postAction).not.toHaveBeenCalled();
    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('home:err_vault_sign_not_member'),
      8000,
    );
  });
});

describe('handleVaultXpubAction', () => {
  it('H-1: never exports the consumer or recovery account xpub', async () => {
    for (const orgIndex of [0, 99]) {
      const { ctx, postAction, displayMessage } = makeCtx({
        vaultXpubData: {
          chain: 'btc',
          orgIndex,
          vaultIndex: 0,
          requestId: 'x',
        } as unknown as HomeActionContext['vaultXpubData'],
      });
      await handleVaultXpubAction(ctx);
      expect(postAction).not.toHaveBeenCalled();
      expect(displayMessage).toHaveBeenCalledWith(
        'error',
        'home:err_vault_request_invalid',
      );
    }
    expect(wallet.getMasterXpub).not.toHaveBeenCalled();
  });

  it('exports an organisation account xpub', async () => {
    const { ctx, postAction } = makeCtx({
      vaultXpubData: {
        chain: 'btc',
        orgIndex: 100,
        vaultIndex: 0,
        requestId: 'x',
      } as unknown as HomeActionContext['vaultXpubData'],
    });
    await handleVaultXpubAction(ctx);
    expect(wallet.getMasterXpub).toHaveBeenCalledWith(
      'seed words',
      48,
      0,
      100,
      expect.anything(),
      'btc',
    );
    expect(postAction).toHaveBeenCalledWith(
      'enterprisevaultxpubsigned',
      expect.any(String),
      'btc',
      '',
      'wk',
    );
  });
});

describe('handleFluxNodeStart', () => {
  it('H-1: refuses a start signed with the consumer collateral key', async () => {
    const { ctx, postAction } = makeCtx();
    await handleFluxNodeStart(ctx, {
      requestId: 'f1',
      chain: 'flux',
      orgIndex: 0,
      vaultIndex: 0,
      collateralTxid: 'aa'.repeat(32),
      collateralVout: 0,
      identityPubKey: '02'.padEnd(66, '1'),
      redeemScript: '52ae',
    });
    expect(wallet.getMasterXpriv).not.toHaveBeenCalled();
    expect(postAction).toHaveBeenCalledWith(
      'enterprisefluxnodestarted',
      expect.stringContaining('Request refused'),
      'flux',
      '',
      'wk',
    );
  });
});
