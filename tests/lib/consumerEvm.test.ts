// @ts-nocheck test suite
import * as accountAbstraction from '@runonflux/aa-schnorr-multisig-sdk';
import * as abi from '@runonflux/aa-schnorr-multisig-sdk/dist/abi';
import { encodeFunctionData, erc20Abi, parseAbi } from 'viem';
import { Buffer } from 'buffer';
import {
  generateAddressKeypair,
  generateMultisigAddressEVM,
  generatePublicNonce,
  getMasterXpub,
  getMasterXpriv,
} from '../../src/lib/wallet';
import {
  assertConsumerEvmFeeWithinCap,
  verifyConsumerEvmRequest,
} from '../../src/lib/consumerEvm';
import { computeUserOpHash } from '../../src/lib/userOpVerify';
import {
  decodeEVMTransactionForApproval,
  decodeTransactionForApproval,
  decodeVaultTransaction,
} from '../../src/lib/transactions';
import { signAndBroadcastEVM } from '../../src/lib/constructTx';
import { SELECTOR_UPGRADE_TO_AND_CALL } from '../../src/lib/consumerGuards';

// The Key's own USD rate (fee caps): no network in tests.
jest.mock('../../src/lib/rates', () => ({
  ...jest.requireActual('../../src/lib/rates'),
  getCryptoUsdRate: jest.fn(() => Promise.resolve(0)),
}));

/**
 * Consumer EVM binding (EVM-8 / K5) and call-safety (C-4 / EVM-1 / AA-5).
 * The C-4 cases reproduce poc/evm1_value_calldata.cjs against the real
 * decoders.
 */

const CHAIN = 'sepolia';
const SLIP = 1;
const WALLET_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KEY_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

const xpubWallet = getMasterXpub(WALLET_MNEMONIC, 48, SLIP, 0, 'p2sh', CHAIN);
const xpubKey = getMasterXpub(KEY_MNEMONIC, 48, SLIP, 0, 'p2sh', CHAIN);
const xprivWallet = getMasterXpriv(WALLET_MNEMONIC, 48, SLIP, 0, 'p2sh', CHAIN);
const xprivKey = getMasterXpriv(KEY_MNEMONIC, 48, SLIP, 0, 'p2sh', CHAIN);
const PATH = '0-1';
const KEYS = { path: PATH, xpubWallet, xpubKey };
const walletKp = generateAddressKeypair(xprivWallet, 0, 1, CHAIN);
const keyKp = generateAddressKeypair(xprivKey, 0, 1, CHAIN);
const ACCOUNT = generateMultisigAddressEVM(
  xpubWallet,
  xpubKey,
  0,
  1,
  CHAIN,
).address;
const OTHER = '0x66324EE406cCccdDdAd7f510a61Af22DeC391606';
const KNOWN_TOKEN = '0x690cc0235aBEA2cF89213E30D0F0Ea0fC054B909'; // TEST-FLUX
const UNKNOWN_TOKEN = '0x1234567890123456789012345678901234567890';

const key = (hex) =>
  new accountAbstraction.types.Key(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
const nonces = () => {
  const n = generatePublicNonce();
  return { kPublic: key(n.kPublic), kTwoPublic: key(n.kTwoPublic) };
};

const encodeExecute = (dest, value, func = '0x') =>
  encodeFunctionData({
    abi: abi.MultiSigSmartAccount_abi,
    functionName: 'execute',
    args: [dest, BigInt(value), func],
  });

function userOpRequest(callData, sender = ACCOUNT, gas = {}) {
  return {
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
    ...gas,
  };
}

/** A consumer request exactly as SSP Wallet serialises it. */
function request(callData, overrides = {}) {
  const uo = userOpRequest(callData, overrides.sender, overrides.gas);
  const pubKeys = overrides.publicKeys ?? [
    key(walletKp.pubKey),
    key(keyKp.pubKey),
  ];
  const op = new accountAbstraction.userOperation.MultiSigUserOp(
    pubKeys,
    [nonces(), nonces()],
    overrides.opHash ?? computeUserOpHash(uo, CHAIN),
    uo,
  );
  return JSON.stringify(op.toJson());
}

const nativeSend = () => request(encodeExecute(OTHER, 10n ** 17n));

describe('verifyConsumerEvmRequest (EVM-8 / K5)', () => {
  it('accepts an honest request and returns the derived binding', () => {
    const verified = verifyConsumerEvmRequest(nativeSend(), CHAIN, KEYS);
    expect(verified.sender.toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(verified.walletPubKey).toBe(walletKp.pubKey);
    expect(verified.keyPubKey).toBe(keyKp.pubKey);
  });

  it('refuses an opHash that is not the hash of the displayed operation', () => {
    const forged = request(encodeExecute(OTHER, 1n), {
      opHash: computeUserOpHash(
        userOpRequest(encodeExecute(OTHER, 10n ** 21n)),
        CHAIN,
      ),
    });
    expect(() => verifyConsumerEvmRequest(forged, CHAIN, KEYS)).toThrow(
      /hash does not match/,
    );
  });

  it('refuses a hash computed for another chain', () => {
    const uo = userOpRequest(encodeExecute(OTHER, 1n));
    const crossChain = request(uo.callData, {
      opHash: computeUserOpHash(uo, 'eth'),
    });
    expect(() => verifyConsumerEvmRequest(crossChain, CHAIN, KEYS)).toThrow(
      /hash does not match/,
    );
  });

  it('refuses signer keys that are not the stored wallet key + own key', () => {
    const attacker = generateAddressKeypair(xprivWallet, 0, 9, CHAIN);
    const swapped = request(encodeExecute(OTHER, 1n), {
      publicKeys: [key(attacker.pubKey), key(keyKp.pubKey)],
    });
    expect(() => verifyConsumerEvmRequest(swapped, CHAIN, KEYS)).toThrow(
      /signer keys/,
    );
  });

  it('refuses an operation from another account', () => {
    const foreign = request(encodeExecute(OTHER, 1n), { sender: OTHER });
    expect(() => verifyConsumerEvmRequest(foreign, CHAIN, KEYS)).toThrow(
      /not from this wallet account/,
    );
  });

  it('refuses a tampered combined key', () => {
    const parsed = JSON.parse(nativeSend());
    parsed.combinedPubKey = keyKp.pubKey;
    expect(() =>
      verifyConsumerEvmRequest(JSON.stringify(parsed), CHAIN, KEYS),
    ).toThrow(/combined key/);
  });

  it('KEY-8: refuses the identity branch', () => {
    expect(() =>
      verifyConsumerEvmRequest(nativeSend(), CHAIN, { ...KEYS, path: '10-0' }),
    ).toThrow(/not a consumer spending branch/);
  });

  it('signAndBroadcastEVM refuses a payload that differs from the verified binding', async () => {
    const verified = verifyConsumerEvmRequest(nativeSend(), CHAIN, KEYS);
    const other = request(encodeExecute(OTHER, 2n));
    const nonce = generatePublicNonce();
    await expect(
      signAndBroadcastEVM(other, CHAIN, keyKp.privKey, nonce, verified),
    ).rejects.toThrow(/does not match the verified operation/);
    await expect(
      signAndBroadcastEVM(nativeSend(), CHAIN, walletKp.privKey, nonce, {
        ...verified,
        opHash: JSON.parse(nativeSend()).opHash,
      }),
    ).rejects.toThrow();
  });
});

const upgradeCall = encodeFunctionData({
  abi: parseAbi(['function upgradeToAndCall(address,bytes) payable']),
  functionName: 'upgradeToAndCall',
  args: [OTHER, '0x'],
});

describe('C-4 / EVM-1 consumer decode (poc/evm1_value_calldata)', () => {
  it('PoC: execute(self, 1 wei, upgradeToAndCall) is refused, not shown as a 1-wei send', async () => {
    expect(upgradeCall.slice(0, 10)).toBe(SELECTOR_UPGRADE_TO_AND_CALL);
    const res = await decodeEVMTransactionForApproval(
      request(encodeExecute(ACCOUNT, 1n, upgradeCall)),
      CHAIN,
    );
    expect(res.amount).toBe('decodingError');
    expect(res.error).toMatch(/self-call/);
  });

  it('refuses upgradeToAndCall to any target', async () => {
    const res = await decodeEVMTransactionForApproval(
      request(encodeExecute(OTHER, 0n, upgradeCall)),
      CHAIN,
    );
    expect(res.amount).toBe('decodingError');
    expect(res.error).toMatch(/upgradeToAndCall/);
  });

  it('refuses a plain self-call even without calldata', async () => {
    const res = await decodeEVMTransactionForApproval(
      request(encodeExecute(ACCOUNT, 1n)),
      CHAIN,
    );
    expect(res.amount).toBe('decodingError');
  });

  it('value + calldata is a contract call (flagged), never a native send', async () => {
    const data = '0xdeadbeef' + '00'.repeat(32);
    const res = await decodeEVMTransactionForApproval(
      request(encodeExecute(OTHER, 10n ** 16n, data)),
      CHAIN,
    );
    expect(res.token).toBe(OTHER);
    expect(res.data).toBe(data);
    expect(res.nativeValue).toBe('0.01');
    expect(res.warnings).toContain('contract_call_with_value');
    expect(res.amount).toBe('0');
  });

  it('keeps executeBatch fail-closed', async () => {
    const batch = encodeFunctionData({
      abi: abi.MultiSigSmartAccount_abi,
      functionName: 'executeBatch',
      args: [[OTHER], ['0x']],
    });
    const res = await decodeEVMTransactionForApproval(request(batch), CHAIN);
    expect(res.amount).toBe('decodingError');
  });

  it('never borrows token metadata from the relay for an unknown token', async () => {
    const transfer = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [OTHER, 123456789n],
    });
    const res = await decodeEVMTransactionForApproval(
      request(encodeExecute(UNKNOWN_TOKEN, 0n, transfer)),
      CHAIN,
    );
    expect(res.token).toBe(UNKNOWN_TOKEN);
    expect(res.tokenSymbol).toBe('');
    expect(res.data).toBe(transfer);
    expect(res.warnings).toContain('unknown_token');
  });

  it('a known token transfer still decodes with on-device decimals', async () => {
    const transfer = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [OTHER, 100000000n],
    });
    const res = await decodeEVMTransactionForApproval(
      request(encodeExecute(KNOWN_TOKEN, 0n, transfer)),
      CHAIN,
    );
    expect(res.receiver).toBe(OTHER);
    expect(res.amount).toBe('1');
    expect(res.tokenSymbol).toBe('TEST-FLUX');
    expect(res.data).toBe('');
  });

  it('decodeTransactionForApproval binds the display to the stored keys', async () => {
    const ok = await decodeTransactionForApproval(nativeSend(), CHAIN, KEYS);
    expect(ok.amount).toBe('0.1');
    expect(ok.receiver).toBe(OTHER);
    const forged = await decodeTransactionForApproval(
      request(encodeExecute(OTHER, 1n), { opHash: '0x' + '11'.repeat(32) }),
      CHAIN,
      KEYS,
    );
    expect(forged.amount).toBe('decodingError');
    const noKeys = await decodeTransactionForApproval(nativeSend(), CHAIN);
    expect(noKeys.amount).toBe('decodingError');
  });
});

describe('item 7: consumer EVM fee cap', () => {
  const gwei = (n) => '0x' + (BigInt(n) * 10n ** 9n).toString(16);
  // 3 * 0x10000 = 196,608 gas
  const withFeePerGas = (n) =>
    request(encodeExecute(OTHER, 1n), { gas: { maxFeePerGas: gwei(n) } });

  it('accepts a normal fee and reports it', () => {
    expect(assertConsumerEvmFeeWithinCap(nativeSend(), CHAIN, 0)).toEqual({
      fee: (196608n * 10n ** 9n).toString(),
      maxFee: '1000000000000000000',
    });
  });

  it('refuses a fee above the chain hard cap (no rate known)', () => {
    // 196,608 gas * 10,000 gwei = 1.97 TEST-ETH > 1 TEST-ETH
    expect(() =>
      assertConsumerEvmFeeWithinCap(withFeePerGas(10000), CHAIN, 0),
    ).toThrow(/exceeds the maximum of 1000000000000000000/);
  });

  it('applies the $100 cap below the hard cap when a rate is known', () => {
    // 196,608 gas * 300 gwei = 0.059 ETH: under 1 ETH, above $100 at $3000
    const raw = withFeePerGas(300);
    expect(assertConsumerEvmFeeWithinCap(raw, CHAIN, 0).fee).toBe(
      (196608n * 300n * 10n ** 9n).toString(),
    );
    expect(() => assertConsumerEvmFeeWithinCap(raw, CHAIN, 3000)).toThrow(
      /exceeds the maximum of 33333333333333333/,
    );
  });

  it('refuses malformed gas fields and chains without a configured cap', () => {
    expect(() =>
      assertConsumerEvmFeeWithinCap(
        request(encodeExecute(OTHER, 1n), {
          gas: { callGasLimit: 'lots' },
          opHash: '0x' + '11'.repeat(32), // the hash cannot be computed
        }),
        CHAIN,
        0,
      ),
    ).toThrow(/Invalid gas value/);
    expect(() => assertConsumerEvmFeeWithinCap(nativeSend(), 'btc', 0)).toThrow(
      /No fee cap configured/,
    );
  });

  it('the approval screen refuses an over-cap operation', async () => {
    const res = await decodeTransactionForApproval(
      withFeePerGas(10000),
      CHAIN,
      KEYS,
      { getUsdRate: () => Promise.resolve(0) },
    );
    expect(res.amount).toBe('decodingError');
    expect(res.error).toMatch(/exceeds the maximum/);
  });
});

describe('C-4 enterprise vault decoder sibling', () => {
  const vault = '0x1111111111111111111111111111111111111111';
  const vaultOp = (callData) =>
    JSON.stringify({ userOpRequest: userOpRequest(callData, vault) });

  it('PoC: execute(vault, 1 wei, upgradeToAndCall) sets error (was a 1-wei recipient)', () => {
    const res = decodeVaultTransaction(
      vaultOp(encodeExecute(vault, 1n, upgradeCall)),
      CHAIN,
    );
    expect(res.error).toBeDefined();
    expect(res.recipients).toEqual([]);
  });

  it('value + calldata to another contract is not a recipient', () => {
    const res = decodeVaultTransaction(
      vaultOp(encodeExecute(OTHER, 1n, '0xdeadbeef')),
      CHAIN,
    );
    expect(res.error).toMatch(/native value/);
    expect(res.recipients).toEqual([]);
  });

  it('a plain native vault send still decodes', () => {
    const res = decodeVaultTransaction(
      vaultOp(encodeExecute(OTHER, 5n)),
      CHAIN,
    );
    expect(res.error).toBeUndefined();
    expect(res.recipients).toEqual([{ address: OTHER, amount: '5' }]);
  });
});
