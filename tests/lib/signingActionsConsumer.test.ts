// @ts-nocheck test suite
/**
 * Sign-time enforcement of the consumer guards in signingActions: every
 * refusal happens BEFORE a Schnorr nonce is burned (dispatch) or anything is
 * signed/posted (KEY-8, AA-2, EVM-8, C-2), and a nonce burn is durable
 * (ledger + flush) before any partial signature exists (K4).
 */
import * as CryptoJS from 'crypto-js';
import * as accountAbstraction from '@runonflux/aa-schnorr-multisig-sdk';
import * as abi from '@runonflux/aa-schnorr-multisig-sdk/dist/abi';
import utxolib from '@runonflux/utxo-lib';
import { encodeFunctionData } from 'viem';
import { Buffer } from 'buffer';
import {
  approveTransaction,
  handleSignEVMAction,
} from '../../src/screens/Home/actions/signingActions';
import {
  generateAddressKeypair,
  generateMultisigAddressEVM,
  generatePublicNonce,
  generateSolanaPubkeyArray,
  getMasterXpriv,
  getMasterXpub,
} from '../../src/lib/wallet';
import { RelayAuthUnavailableError } from '../../src/lib/constructTx';
import { deriveConsumerUtxoScripts } from '../../src/lib/consumerUtxo';
import {
  armEvmSigningApproval,
  disarmEvmSigningApproval,
  evmSigningRequestDigest,
} from '../../src/lib/evmSigningApproval';
import { computeUserOpHash } from '../../src/lib/userOpVerify';

// The Key's own USD rate (fee caps): no network in tests.
jest.mock('../../src/lib/rates', () => ({
  ...jest.requireActual('../../src/lib/rates'),
  getCryptoUsdRate: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(({ service }) =>
    Promise.resolve(
      service === 'enc_key'
        ? { password: 'ENC' }
        : {
            password: require('crypto-js').AES.encrypt('PW', 'ENC').toString(),
          },
    ),
  ),
}));

jest.mock('@storage/ssp', () => ({
  sspConfig: () => ({ relay: 'relay.example.com' }),
}));

// Ordered log of the side effects that matter for K4.
const mockOrder: string[] = [];
const mockFlush = jest.fn(() => {
  mockOrder.push('flush');
  return Promise.resolve();
});
jest.mock('../../src/store', () => {
  const actual = jest.requireActual('../../src/store');
  return { ...actual, persistor: { flush: () => mockFlush() } };
});
const mockRecordUsedNonce = jest.fn(() => {
  mockOrder.push('ledger');
});
jest.mock('../../src/lib/enterpriseNonceLedger', () => ({
  recordUsedNonce: (...args) => mockRecordUsedNonce(...args),
  withoutTombstoned: (nonces) => nonces,
}));
const mockContinueSigning = jest.fn(() => {
  mockOrder.push('sign');
  return 'SIGNATURE';
});
jest.mock('../../src/lib/evmSigning', () => ({
  continueSigningSchnorrMultisig: (...args) => mockContinueSigning(...args),
}));

const mockBroadcast = jest.fn();
jest.mock('../../src/lib/constructTx', () => {
  const actual = jest.requireActual('../../src/lib/constructTx');
  return {
    ...actual,
    broadcastTx: (...args) => mockBroadcast(...args),
    signAndBroadcastEVM: (...args) => mockBroadcast(...args),
    cosignAndBroadcastSOLTransaction: (...args) => mockBroadcast(...args),
  };
});

const PW = 'ENCPW';
const enc = (plain) => CryptoJS.AES.encrypt(plain, PW).toString();

const WALLET_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KEY_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

function chainKeys(chain, slip, scriptType) {
  return {
    xpubWallet: getMasterXpub(WALLET_MNEMONIC, 48, slip, 0, scriptType, chain),
    xpubKey: getMasterXpub(KEY_MNEMONIC, 48, slip, 0, scriptType, chain),
    xprivWallet: getMasterXpriv(
      WALLET_MNEMONIC,
      48,
      slip,
      0,
      scriptType,
      chain,
    ),
    xprivKey: getMasterXpriv(KEY_MNEMONIC, 48, slip, 0, scriptType, chain),
  };
}

function makeCtx(keys, overrides = {}) {
  const nonce = generatePublicNonce();
  return {
    xpubKey: enc(keys.xpubKey),
    xpubWallet: enc(keys.xpubWallet),
    xprivKey: enc(keys.xprivKey),
    publicNonces: enc(JSON.stringify([nonce])),
    dispatch: jest.fn(),
    postAction: jest.fn(() => Promise.resolve()),
    createWkAuth: jest.fn(() => Promise.resolve(null)),
    displayMessage: jest.fn(),
    t: (k) => k,
    sspWalletKeyInternalIdentity: 'bc1qwk',
    setSubmittingTransaction: jest.fn(),
    setRawTx: jest.fn(),
    setTxPath: jest.fn(),
    setTxUtxos: jest.fn(),
    setTxid: jest.fn(),
    setEvmSigningSignature: jest.fn(),
    setActiveChain: jest.fn(),
    identityChain: 'btc',
    setEvmSigningData: jest.fn(),
    evmSigningRequest: null,
    nonce,
    ...overrides,
  };
}

/** The approval screen armed exactly this request (item 4). */
const approveOnScreen = (ctx) =>
  armEvmSigningApproval(evmSigningRequestDigest(ctx.evmSigningData));

beforeEach(() => {
  disarmEvmSigningApproval();
  mockBroadcast.mockReset();
  mockOrder.length = 0;
  mockFlush.mockClear();
  mockRecordUsedNonce.mockClear();
  mockContinueSigning.mockClear();
});

describe('handleSignEVMAction (AA-2, KEY-8)', () => {
  const keys = chainKeys('eth', 60, 'p2sh');

  it.each([
    ['a raw string', 'hello world'],
    ['typed-data JSON', '{"primaryType":"Permit","domain":{}}'],
    ['an EIP-712 preimage', '\x19\x01' + 'a'.repeat(64)],
  ])('refuses %s before burning the nonce', async (_label, data) => {
    const ctx = makeCtx(keys);
    ctx.evmSigningData = {
      chain: 'eth',
      walletInUse: '0-0',
      data,
      pubNoncesTwo: {
        kPublic: ctx.nonce.kPublic,
        kTwoPublic: ctx.nonce.kTwoPublic,
      },
      pubNoncesOne: {
        kPublic: ctx.nonce.kPublic,
        kTwoPublic: ctx.nonce.kTwoPublic,
      },
      sigOne: '00'.repeat(32),
      challenge: '00'.repeat(32),
      requestId: 'r1',
    };
    approveOnScreen(ctx);
    await handleSignEVMAction(ctx);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.setEvmSigningSignature).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_invalid_request',
    );
  });

  it('refuses the identity branch (KEY-8) before burning the nonce', async () => {
    const ctx = makeCtx(keys);
    ctx.evmSigningData = {
      chain: 'eth',
      walletInUse: '10-0',
      data: '\x19Ethereum Signed Message:\n5hello',
      pubNoncesTwo: {
        kPublic: ctx.nonce.kPublic,
        kTwoPublic: ctx.nonce.kTwoPublic,
      },
      requestId: 'r1',
    };
    approveOnScreen(ctx);
    await handleSignEVMAction(ctx);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
  });
});

describe('approveTransaction: Solana relay auth (RA-2)', () => {
  it('shows "relay authentication unavailable" when the broadcast cannot be authenticated', async () => {
    const { blockchains } = jest.requireActual('../../src/storage/blockchains');
    const cfg = blockchains.solMainnet;
    const xprivWallet = getMasterXpriv(
      WALLET_MNEMONIC,
      44,
      cfg.slip,
      0,
      cfg.scriptType,
      'solMainnet',
    );
    const xprivKey = getMasterXpriv(
      KEY_MNEMONIC,
      44,
      cfg.slip,
      0,
      cfg.scriptType,
      'solMainnet',
    );
    const keys = {
      xpubWallet: JSON.stringify(
        generateSolanaPubkeyArray(xprivWallet, 'solMainnet', 0),
      ),
      xpubKey: JSON.stringify(
        generateSolanaPubkeyArray(xprivKey, 'solMainnet', 0),
      ),
      xprivKey,
    };
    const ctx = makeCtx(keys);
    mockBroadcast.mockImplementation(() =>
      Promise.reject(new RelayAuthUnavailableError()),
    );
    await approveTransaction(ctx, 'AAAA', 'solMainnet', '0-0', []);
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_relay_auth_unavailable',
    );
    expect(ctx.setTxid).not.toHaveBeenCalled();
  });
});

describe('approveTransaction', () => {
  it('KEY-8: refuses a consumer path on the identity branch', async () => {
    const keys = chainKeys('btc', 0, 'p2wsh');
    const ctx = makeCtx(keys);
    await approveTransaction(ctx, '00', 'btc', '10-0', []);
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/not a consumer spending branch/),
    );
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
  });

  it('EVM-8: refuses a forged opHash before the nonce is burned', async () => {
    const keys = chainKeys('sepolia', 1, 'p2sh');
    const walletKp = generateAddressKeypair(keys.xprivWallet, 0, 0, 'sepolia');
    const keyKp = generateAddressKeypair(keys.xprivKey, 0, 0, 'sepolia');
    const sender = generateMultisigAddressEVM(
      keys.xpubWallet,
      keys.xpubKey,
      0,
      0,
      'sepolia',
    ).address;
    const callData = encodeFunctionData({
      abi: abi.MultiSigSmartAccount_abi,
      functionName: 'execute',
      args: ['0x66324EE406cCccdDdAd7f510a61Af22DeC391606', 1n, '0x'],
    });
    const uo = {
      sender,
      nonce: '0x1',
      initCode: '0x',
      callData,
      callGasLimit: '0x10000',
      verificationGasLimit: '0x10000',
      preVerificationGas: '0x10000',
      maxFeePerGas: '0x3B9ACA00',
      maxPriorityFeePerGas: '0x3B9ACA00',
      paymasterAndData: '0x',
      signature: '0x',
    };
    const ctx = makeCtx(keys);
    const key = (hex) =>
      new accountAbstraction.types.Key(Buffer.from(hex, 'hex'));
    const op = new accountAbstraction.userOperation.MultiSigUserOp(
      [key(walletKp.pubKey), key(keyKp.pubKey)],
      [
        {
          kPublic: key(ctx.nonce.kPublic),
          kTwoPublic: key(ctx.nonce.kTwoPublic),
        },
        {
          kPublic: key(ctx.nonce.kPublic),
          kTwoPublic: key(ctx.nonce.kTwoPublic),
        },
      ],
      computeUserOpHash({ ...uo, callData: '0xdeadbeef' }, 'sepolia'),
      uo,
    );
    await approveTransaction(
      ctx,
      JSON.stringify(op.toJson()),
      'sepolia',
      '0-0',
      [],
    );
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/hash does not match/),
    );
  });

  it('C-2: refuses a P2WSH input that is not the derived 2-of-2', async () => {
    const keys = chainKeys('btc', 0, 'p2wsh');
    const net = utxolib.networks.bitcoin;
    const scripts = deriveConsumerUtxoScripts('btc', {
      path: '0-0',
      xpubWallet: keys.xpubWallet,
      xpubKey: keys.xpubKey,
    });
    const attacker = utxolib.ECPair.makeRandom({ network: net });
    const sA = utxolib.script.multisig.output.encode(1, [
      attacker.getPublicKeyBuffer(),
      scripts.keyPubKey,
    ]);
    const tx = new utxolib.Transaction(net);
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(
      utxolib.script.witnessScriptHash.output.encode(utxolib.crypto.sha256(sA)),
      99000000,
    );
    tx.setWitness(0, [Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0), sA]);
    const ctx = makeCtx(keys);
    await approveTransaction(ctx, tx.toHex(), 'btc', '0-0', []);
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/does not spend from this wallet/),
    );
  });
});

describe('K4: consumer nonce burn is durable before signing', () => {
  const recordOrder = (ctx) => {
    ctx.dispatch = jest.fn(() => {
      mockOrder.push('dispatch');
    });
    ctx.postAction = jest.fn(() => {
      mockOrder.push('post');
      return Promise.resolve();
    });
    return ctx;
  };

  const messageCtx = () => {
    const keys = chainKeys('eth', 60, 'p2sh');
    const ctx = recordOrder(makeCtx(keys));
    ctx.evmSigningData = {
      chain: 'eth',
      walletInUse: '0-0',
      data: '\x19Ethereum Signed Message:\n5hello',
      pubNoncesTwo: {
        kPublic: ctx.nonce.kPublic,
        kTwoPublic: ctx.nonce.kTwoPublic,
      },
      pubNoncesOne: {
        kPublic: ctx.nonce.kPublic,
        kTwoPublic: ctx.nonce.kTwoPublic,
      },
      sigOne: '00'.repeat(32),
      challenge: '00'.repeat(32),
      requestId: 'r1',
    };
    return ctx;
  };

  function evmTxCtx(gasOverrides = {}) {
    const keys = chainKeys('sepolia', 1, 'p2sh');
    const walletKp = generateAddressKeypair(keys.xprivWallet, 0, 0, 'sepolia');
    const keyKp = generateAddressKeypair(keys.xprivKey, 0, 0, 'sepolia');
    const sender = generateMultisigAddressEVM(
      keys.xpubWallet,
      keys.xpubKey,
      0,
      0,
      'sepolia',
    ).address;
    const uo = {
      sender,
      nonce: '0x1',
      initCode: '0x',
      callData: encodeFunctionData({
        abi: abi.MultiSigSmartAccount_abi,
        functionName: 'execute',
        args: ['0x66324EE406cCccdDdAd7f510a61Af22DeC391606', 1n, '0x'],
      }),
      callGasLimit: '0x10000',
      verificationGasLimit: '0x10000',
      preVerificationGas: '0x10000',
      maxFeePerGas: '0x3B9ACA00',
      maxPriorityFeePerGas: '0x3B9ACA00',
      paymasterAndData: '0x',
      signature: '0x',
      ...gasOverrides,
    };
    const ctx = recordOrder(makeCtx(keys));
    const key = (hex) =>
      new accountAbstraction.types.Key(Buffer.from(hex, 'hex'));
    const pn = {
      kPublic: key(ctx.nonce.kPublic),
      kTwoPublic: key(ctx.nonce.kTwoPublic),
    };
    const op = new accountAbstraction.userOperation.MultiSigUserOp(
      [key(walletKp.pubKey), key(keyKp.pubKey)],
      [pn, pn],
      computeUserOpHash(uo, 'sepolia'),
      uo,
    );
    return { ctx, raw: JSON.stringify(op.toJson()) };
  }

  it('message path: ledger, burn, flush, then sign, then post', async () => {
    const ctx = messageCtx();
    approveOnScreen(ctx);
    await handleSignEVMAction(ctx);
    expect(mockOrder).toEqual(['ledger', 'dispatch', 'flush', 'sign', 'post']);
    expect(mockRecordUsedNonce).toHaveBeenCalledWith(ctx.nonce.kPublic);
  });

  it('item 4: a request swapped in after the approval is refused before any nonce is touched', async () => {
    const ctx = messageCtx();
    approveOnScreen(ctx); // the user approved "hello"
    ctx.evmSigningData = {
      ...ctx.evmSigningData,
      data: '\x19Ethereum Signed Message:\n7swapped',
    };
    await handleSignEVMAction(ctx);
    expect(mockOrder).toEqual([]);
    expect(mockContinueSigning).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_vault_request_changed',
      8000,
    );
    // the new request stays open for review
    expect(ctx.setEvmSigningData).not.toHaveBeenCalled();
  });

  it('item 4: an approval is single-use and never signs without arming', async () => {
    const ctx = messageCtx();
    await handleSignEVMAction(ctx);
    expect(mockContinueSigning).not.toHaveBeenCalled();
    approveOnScreen(ctx);
    await handleSignEVMAction(ctx);
    expect(mockContinueSigning).toHaveBeenCalledTimes(1);
    mockContinueSigning.mockClear();
    await handleSignEVMAction(ctx);
    expect(mockContinueSigning).not.toHaveBeenCalled();
  });

  it('message path: a failed flush signs and sends nothing', async () => {
    mockFlush.mockImplementationOnce(() =>
      Promise.reject(new Error('disk full')),
    );
    const ctx = messageCtx();
    approveOnScreen(ctx);
    await handleSignEVMAction(ctx);
    expect(mockContinueSigning).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.setEvmSigningSignature).not.toHaveBeenCalled();
  });

  it('message path: a failed ledger write burns, signs and sends nothing', async () => {
    mockRecordUsedNonce.mockImplementationOnce(() => {
      throw new Error('ledger write failed');
    });
    const ctx = messageCtx();
    approveOnScreen(ctx);
    await handleSignEVMAction(ctx);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(mockContinueSigning).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
  });

  it('transaction path: ledger, burn, flush, then sign+broadcast, then post', async () => {
    const { ctx, raw } = evmTxCtx();
    mockBroadcast.mockImplementation(() => {
      mockOrder.push('sign');
      return Promise.resolve('0xtxhash');
    });
    await approveTransaction(ctx, raw, 'sepolia', '0-0', []);
    expect(mockOrder).toEqual(['ledger', 'dispatch', 'flush', 'sign', 'post']);
    expect(ctx.setTxid).toHaveBeenCalledWith('0xtxhash');
  });

  it('item 7: an operation above the EVM fee cap is refused before the nonce is burned', async () => {
    // 3 * 0x10000 gas * 10,000 gwei = 1.97 TEST-ETH > the 1 TEST-ETH cap
    const { ctx, raw } = evmTxCtx({
      maxFeePerGas: '0x' + (10000n * 10n ** 9n).toString(16),
    });
    await approveTransaction(ctx, raw, 'sepolia', '0-0', []);
    expect(mockOrder).toEqual([]);
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/exceeds the maximum/),
    );
  });

  it('transaction path: a failed flush signs and sends nothing', async () => {
    mockFlush.mockImplementationOnce(() =>
      Promise.reject(new Error('disk full')),
    );
    const { ctx, raw } = evmTxCtx();
    await approveTransaction(ctx, raw, 'sepolia', '0-0', []);
    expect(mockBroadcast).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith('error', 'disk full');
  });
});
