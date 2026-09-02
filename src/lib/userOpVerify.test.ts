import { blockchains } from '@storage/blockchains';
import { computeUserOpHash, userOpHashMatches } from './userOpVerify';
import type { cryptos } from '../types';

// Regression: `eth` and `sepolia` shipped without `chainId`, so
// computeUserOpHash threw for every Ethereum enterprise vault operation and
// the approval screen reported it as a display/sign mismatch.
const evmChains = (
  Object.entries(blockchains) as Array<
    [keyof cryptos, (typeof blockchains)[keyof cryptos]]
  >
).filter(([, config]) => config.chainType === 'evm');

const sampleUserOp = {
  sender: '0x1111111111111111111111111111111111111111',
  nonce: '0x1',
  initCode: '0x',
  callData: '0xb61d27f6',
  callGasLimit: '0x7a120',
  verificationGasLimit: '0x7a120',
  preVerificationGas: '0xc350',
  maxFeePerGas: '0x2540be400',
  maxPriorityFeePerGas: '0x77359400',
  paymasterAndData: '0x',
  signature: '0x',
};

describe('userOpVerify chain configuration', () => {
  it('has at least one EVM chain configured', () => {
    expect(evmChains.length).toBeGreaterThan(0);
  });

  it('gives every EVM chain the entry point and chainId the hash recompute needs', () => {
    for (const [id, config] of evmChains) {
      const aa = config as { chainId?: string; entrypointAddress?: string };
      expect({
        id,
        chainId: aa.chainId,
        entrypointAddress: aa.entrypointAddress,
      }).toEqual({
        id,
        chainId: expect.stringMatching(/^\d+$/),
        entrypointAddress: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      });
    }
  });

  it('pins the canonical chain ids', () => {
    const ids = Object.fromEntries(
      evmChains.map(([id, config]) => [
        id,
        (config as { chainId?: string }).chainId,
      ]),
    );
    expect(ids).toMatchObject({
      eth: '1',
      sepolia: '11155111',
      polygon: '137',
      amoy: '80002',
      base: '8453',
      bsc: '56',
      avax: '43114',
    });
  });

  it('computes a user operation hash for every EVM chain', () => {
    for (const [chain] of evmChains) {
      const hash = computeUserOpHash(sampleUserOp, chain);
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(userOpHashMatches(sampleUserOp, chain, hash)).toBe(true);
      expect(userOpHashMatches(sampleUserOp, chain, hash.toUpperCase())).toBe(
        true,
      );
    }
  });

  it('binds the hash to the chain id so a cross-chain replay does not match', () => {
    const ethHash = computeUserOpHash(sampleUserOp, 'eth');
    const sepoliaHash = computeUserOpHash(sampleUserOp, 'sepolia');
    expect(ethHash).not.toEqual(sepoliaHash);
    expect(userOpHashMatches(sampleUserOp, 'eth', sepoliaHash)).toBe(false);
  });

  it('fails closed on a tampered hash or malformed operation', () => {
    expect(userOpHashMatches(sampleUserOp, 'eth', '0xdeadbeef')).toBe(false);
    expect(userOpHashMatches(sampleUserOp, 'eth', '')).toBe(false);
    expect(userOpHashMatches(sampleUserOp, 'eth', undefined)).toBe(false);
    expect(userOpHashMatches(null, 'eth', '0xabc')).toBe(false);
  });
});
