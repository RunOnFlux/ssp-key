/**
 * Regression tests for the enterprise request guards.
 *
 * H-1 (KEY-2 / KAS-1 / CHN-5): the Key accepted any orgIndex on enterprise
 * requests. orgIndex 0 with vaultIndex 0 derives exactly the consumer key
 * m/48'/coin'/0'/script'/0/i, and 99 reaches the recovery account, so a
 * compromised extension could get consumer funds co-signed under an
 * "Acme Treasury" label (PoC: kas-poc-orgindex0.mjs).
 *
 * C-4 (EVM-1, PoC evm1_value_calldata.cjs): execute(self, 1 wei,
 * upgradeToAndCall(evil)) decoded as a harmless 1-wei native send.
 */
import { encodeFunctionData, erc20Abi, parseAbi } from 'viem';
import * as abi from '@runonflux/aa-schnorr-multisig-sdk/dist/abi';

import {
  ENTERPRISE_ORG_INDEX_MAX,
  ENTERPRISE_ORG_INDEX_MIN,
  HD_INDEX_LIMIT,
  assertEnterpriseDerivation,
  checkVaultEvmUserOp,
  fluxNodeAddressIndex,
  inputAddressIndexes,
  isEnterpriseOrgIndex,
  isHdIndex,
  primaryAddressIndex,
  validateFluxNodeStartRequest,
  validateVaultSigningRequest,
  validateVaultXpubRequest,
} from '../../src/lib/enterpriseGuards';

const VAULT = '0x1111111111111111111111111111111111111111';
const EVIL = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const RECIPIENT = '0x4444444444444444444444444444444444444444';

const executeCall = (target: string, value: bigint, data: `0x${string}`) =>
  encodeFunctionData({
    abi: abi.MultiSigSmartAccount_abi,
    functionName: 'execute',
    args: [target as `0x${string}`, value, data],
  });

const userOp = (callData: string, extra: Record<string, unknown> = {}) => ({
  sender: VAULT,
  nonce: '0x0',
  initCode: '0x',
  callData,
  callGasLimit: '0x1',
  verificationGasLimit: '0x1',
  preVerificationGas: '0x1',
  maxFeePerGas: '0x1',
  maxPriorityFeePerGas: '0x1',
  paymasterAndData: '0x',
  signature: '0x',
  ...extra,
});

const upgradeToAndCall = encodeFunctionData({
  abi: parseAbi(['function upgradeToAndCall(address,bytes) payable']),
  functionName: 'upgradeToAndCall',
  args: [EVIL, '0x'],
});
const upgradeTo = encodeFunctionData({
  abi: parseAbi(['function upgradeTo(address)']),
  functionName: 'upgradeTo',
  args: [EVIL],
});
const transfer = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: [RECIPIENT, 1000n],
});

const btcSignRequest = (overrides: Record<string, unknown> = {}) => ({
  chain: 'btc',
  orgIndex: 100,
  vaultIndex: 0,
  rawUnsignedTx: '0200000001',
  inputDetails: [{ index: 0, addressIndex: 3, witnessScript: 'aa' }],
  requestId: 'r1',
  ...overrides,
});

describe('organisation / HD index guards', () => {
  it('accepts exactly the organisation account range', () => {
    expect(ENTERPRISE_ORG_INDEX_MIN).toBe(100);
    expect(ENTERPRISE_ORG_INDEX_MAX).toBe(99999);
    [100, 101, 5000, 99999].forEach((v) =>
      expect(isEnterpriseOrgIndex(v)).toBe(true),
    );
  });

  it('refuses the consumer (0) and recovery (99) accounts and everything else', () => {
    [
      0,
      1,
      98,
      99,
      100000,
      -100,
      100.5,
      Number.NaN,
      Infinity,
      '100',
      '0/1',
      null,
      undefined,
      [100],
      { valueOf: () => 100 },
    ].forEach((v) => expect(isEnterpriseOrgIndex(v)).toBe(false));
  });

  it('bounds vault and address indices to integers in [0, 2^31)', () => {
    [0, 1, 19, HD_INDEX_LIMIT - 1].forEach((v) =>
      expect(isHdIndex(v)).toBe(true),
    );
    [-1, HD_INDEX_LIMIT, 1.5, '0', null, undefined, Number.NaN].forEach((v) =>
      expect(isHdIndex(v)).toBe(false),
    );
  });

  it('assertEnterpriseDerivation throws for any invalid level', () => {
    expect(() => assertEnterpriseDerivation(100, 0, [0, 1])).not.toThrow();
    expect(() => assertEnterpriseDerivation(0, 0, [0])).toThrow(
      /organisation index/,
    );
    expect(() => assertEnterpriseDerivation(99, 0)).toThrow(
      /organisation index/,
    );
    expect(() => assertEnterpriseDerivation(100, -1)).toThrow(/vault index/);
    expect(() => assertEnterpriseDerivation(100, 0, [2 ** 31])).toThrow(
      /address index/,
    );
    expect(() => assertEnterpriseDerivation(100, 0, ['1'])).toThrow(
      /address index/,
    );
  });

  it('reads address indices from a JSON string or array and never defaults a bad one to 0', () => {
    expect(inputAddressIndexes(JSON.stringify([{ addressIndex: 4 }]))).toEqual([
      4,
    ]);
    expect(
      inputAddressIndexes([{ addressIndex: 1 }, { addressIndex: 2 }]),
    ).toEqual([1, 2]);
    expect(inputAddressIndexes(undefined)).toEqual([]);
    expect(primaryAddressIndex(undefined)).toBe(0);
    expect(primaryAddressIndex([{ addressIndex: 7 }])).toBe(7);
    expect(() => inputAddressIndexes([{ addressIndex: '1' }])).toThrow();
    expect(() => inputAddressIndexes([{}])).toThrow();
    expect(() => inputAddressIndexes('{oops')).toThrow();
    expect(() => inputAddressIndexes({ addressIndex: 1 })).toThrow();
  });
});

describe('validateVaultSigningRequest', () => {
  it('accepts a well-formed organisation request', () => {
    expect(validateVaultSigningRequest(btcSignRequest())).toBeNull();
  });

  it('refuses the consumer-account co-sign of the KAS-1 / KEY-2 PoC (orgIndex 0, vaultIndex 0)', () => {
    expect(
      validateVaultSigningRequest(
        btcSignRequest({
          orgIndex: 0,
          vaultIndex: 0,
          orgName: 'Acme Treasury',
          vaultName: 'Payroll',
        }),
      ),
    ).toMatch(/organisation index/);
    expect(
      validateVaultSigningRequest(btcSignRequest({ orgIndex: 99 })),
    ).toMatch(/organisation index/);
    expect(
      validateVaultSigningRequest(btcSignRequest({ orgIndex: '100' })),
    ).toMatch(/organisation index/);
  });

  it('refuses non-integer vault and address indices on every chain type', () => {
    ['btc', 'eth', 'solMainnet'].forEach((chain) => {
      expect(
        validateVaultSigningRequest(btcSignRequest({ chain, vaultIndex: 1.5 })),
      ).toMatch(/vault index/);
      expect(
        validateVaultSigningRequest(
          btcSignRequest({ chain, inputDetails: [{ addressIndex: -1 }] }),
        ),
      ).toMatch(/address index/);
    });
  });

  it('refuses unknown chains, missing transactions and UTXO requests without inputs', () => {
    expect(
      validateVaultSigningRequest(btcSignRequest({ chain: 'nope' })),
    ).not.toBeNull();
    expect(
      validateVaultSigningRequest(btcSignRequest({ rawUnsignedTx: '' })),
    ).not.toBeNull();
    expect(
      validateVaultSigningRequest(btcSignRequest({ inputDetails: [] })),
    ).not.toBeNull();
    expect(validateVaultSigningRequest(null)).not.toBeNull();
  });

  it('CHN-5: refuses message signing on non-EVM chains', () => {
    expect(
      validateVaultSigningRequest(
        btcSignRequest({ chain: 'solMainnet', signMessage: 'hello' }),
      ),
    ).toMatch(/only supported for EVM/);
    expect(
      validateVaultSigningRequest(btcSignRequest({ signMessage: 'hello' })),
    ).toMatch(/only supported for EVM/);
    expect(
      validateVaultSigningRequest(
        btcSignRequest({
          chain: 'eth',
          signMessage: 'hello',
          inputDetails: [{ addressIndex: 0 }],
        }),
      ),
    ).toBeNull();
  });

  it('refuses a message request that also carries an operation, and EVM ops on other chains', () => {
    expect(
      validateVaultSigningRequest(
        btcSignRequest({
          chain: 'eth',
          signMessage: 'hello',
          evmUserOp: '{}',
        }),
      ),
    ).toMatch(/both/);
    expect(
      validateVaultSigningRequest(btcSignRequest({ evmUserOp: '{}' })),
    ).toMatch(/non-EVM/);
  });
});

describe('validateVaultXpubRequest', () => {
  it('accepts organisation accounts and refuses consumer / recovery ones', () => {
    expect(
      validateVaultXpubRequest({ chain: 'eth', orgIndex: 100, vaultIndex: 2 }),
    ).toBeNull();
    expect(
      validateVaultXpubRequest({ chain: 'eth', orgIndex: 0, vaultIndex: 0 }),
    ).not.toBeNull();
    expect(
      validateVaultXpubRequest({ chain: 'btc', orgIndex: 99, vaultIndex: 0 }),
    ).not.toBeNull();
    expect(
      validateVaultXpubRequest({ chain: 'btc', orgIndex: 100 }),
    ).not.toBeNull();
  });
});

describe('validateFluxNodeStartRequest', () => {
  const start = (overrides: Record<string, unknown> = {}) => ({
    chain: 'flux',
    orgIndex: 150,
    vaultIndex: 1,
    collateralVout: 0,
    ...overrides,
  });

  it('accepts a well-formed start and defaults a missing address index to 0', () => {
    expect(validateFluxNodeStartRequest(start())).toBeNull();
    expect(fluxNodeAddressIndex(start())).toBe(0);
    expect(fluxNodeAddressIndex(start({ addressIndex: 5 }))).toBe(5);
  });

  it('refuses consumer collateral keys and malformed indices', () => {
    expect(validateFluxNodeStartRequest(start({ orgIndex: 0 }))).not.toBeNull();
    expect(
      validateFluxNodeStartRequest(start({ orgIndex: 99 })),
    ).not.toBeNull();
    expect(
      validateFluxNodeStartRequest(start({ addressIndex: '1' })),
    ).not.toBeNull();
    expect(
      validateFluxNodeStartRequest(start({ collateralVout: -1 })),
    ).not.toBeNull();
    expect(
      validateFluxNodeStartRequest(start({ chain: 'btc' })),
    ).not.toBeNull();
    expect(
      validateFluxNodeStartRequest(start({ delegates: 'x' })),
    ).not.toBeNull();
  });
});

describe('checkVaultEvmUserOp (EVM call-safety)', () => {
  it('accepts a plain ERC-20 transfer and a plain native send', () => {
    const token = checkVaultEvmUserOp(
      JSON.stringify(userOp(executeCall(TOKEN, 0n, transfer))),
    );
    expect(token.ok).toBe(true);
    const native = checkVaultEvmUserOp(
      userOp(executeCall(RECIPIENT, 10n ** 18n, '0x')),
    );
    expect(native.ok).toBe(true);
  });

  it('PoC EVM-1: refuses execute(self, 1 wei, upgradeToAndCall(evil))', () => {
    const result = checkVaultEvmUserOp(
      userOp(executeCall(VAULT, 1n, upgradeToAndCall)),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses any call to the vault account itself, whatever the data', () => {
    expect(checkVaultEvmUserOp(userOp(executeCall(VAULT, 0n, '0x'))).ok).toBe(
      false,
    );
    expect(
      checkVaultEvmUserOp(
        userOp(
          executeCall(VAULT.toUpperCase().replace('0X', '0x'), 0n, transfer),
        ),
      ).ok,
    ).toBe(false);
  });

  it('refuses the upgrade selectors on any target', () => {
    expect(
      checkVaultEvmUserOp(userOp(executeCall(EVIL, 0n, upgradeToAndCall))).ok,
    ).toBe(false);
    expect(
      checkVaultEvmUserOp(userOp(executeCall(EVIL, 0n, upgradeTo))).ok,
    ).toBe(false);
  });

  it('refuses native value together with calldata (cannot be shown as a native send)', () => {
    const result = checkVaultEvmUserOp(
      userOp(executeCall(TOKEN, 1n, transfer)),
    );
    expect(result.ok).toBe(false);
  });

  it('refuses executeBatch and undecodable calls (fail closed)', () => {
    const batch = encodeFunctionData({
      abi: abi.MultiSigSmartAccount_abi,
      functionName: 'executeBatch',
      args: [[TOKEN as `0x${string}`], [transfer]],
    });
    expect(checkVaultEvmUserOp(userOp(batch)).ok).toBe(false);
    expect(checkVaultEvmUserOp(userOp('0xdeadbeef')).ok).toBe(false);
    expect(checkVaultEvmUserOp(userOp('0x')).ok).toBe(false);
    expect(checkVaultEvmUserOp('{oops').ok).toBe(false);
    expect(checkVaultEvmUserOp(userOp(transfer, { sender: 'x' })).ok).toBe(
      false,
    );
  });

  it('refuses a payload carrying both a top-level op and a nested userOpRequest (H-15 shape)', () => {
    const benign = userOp(executeCall(TOKEN, 0n, transfer));
    const result = checkVaultEvmUserOp({
      ...benign,
      userOpRequest: userOp(executeCall(EVIL, 0n, transfer)),
    });
    expect(result.ok).toBe(false);
  });
});
