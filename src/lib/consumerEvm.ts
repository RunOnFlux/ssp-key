/**
 * Consumer 2-of-2 EVM (account abstraction) request binding — EVM-8 / K5.
 *
 * The consumer co-sign used to Schnorr-sign the wallet-supplied `opHash`
 * with the wallet-supplied `publicKeys`. Before the key burns a nonce it now:
 *
 *  - recomputes the ERC-4337 v0.6 userOp hash from the DISPLAYED
 *    `userOpRequest` with its own EntryPoint and chainId (`userOpHashMatches`,
 *    the same helper the enterprise vault path uses) and requires it to equal
 *    `opHash`;
 *  - derives the wallet's public key from the wallet xpub stored at pairing
 *    and requires the request's `publicKeys` to be exactly {wallet, key} and
 *    its `combinedPubKey` to be their aggregate;
 *  - requires `userOpRequest.sender` to be the 2-of-2 account derived from
 *    the two xpubs at the request path.
 */
import * as accountAbstraction from '@runonflux/aa-schnorr-multisig-sdk';
import BigNumber from 'bignumber.js';
import { Buffer } from 'buffer';
import { blockchains } from '@storage/blockchains';
import { deriveEVMPublicKey, generateMultisigAddressEVM } from './wallet';
import {
  CONSUMER_EVM_MAX_FEE_WEI,
  maxConsumerFee,
  parseConsumerDerivationPath,
} from './consumerGuards';
import { userOpHashMatches } from './userOpVerify';
import type { ConsumerKeyMaterial } from './consumerUtxo';
import type { cryptos } from '../types';

export interface VerifiedConsumerEvmRequest {
  /** Derived 2-of-2 account address (equals userOpRequest.sender). */
  sender: string;
  walletPubKey: string;
  keyPubKey: string;
  opHash: string;
}

function normalizeHex(value: string): string {
  return value.toLowerCase().replace(/^0x/, '');
}

export function verifyConsumerEvmRequest(
  rawTx: string,
  chain: keyof cryptos,
  keys: ConsumerKeyMaterial,
): VerifiedConsumerEvmRequest {
  const { typeIndex, addressIndex } = parseConsumerDerivationPath(keys.path);
  let parsed: {
    opHash?: unknown;
    userOpRequest?: { sender?: unknown };
    publicKeys?: unknown;
    combinedPubKey?: unknown;
  };
  try {
    parsed = JSON.parse(rawTx) as typeof parsed;
  } catch {
    throw new Error('Invalid EVM request');
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.userOpRequest) {
    throw new Error('Invalid EVM request: missing userOpRequest');
  }
  const walletPubKey = deriveEVMPublicKey(
    keys.xpubWallet,
    typeIndex,
    addressIndex,
    chain,
  );
  const keyPubKey = deriveEVMPublicKey(
    keys.xpubKey,
    typeIndex,
    addressIndex,
    chain,
  );
  const { address: sender } = generateMultisigAddressEVM(
    keys.xpubWallet,
    keys.xpubKey,
    typeIndex,
    addressIndex,
    chain,
  );
  const claimedSender = parsed.userOpRequest.sender;
  if (
    typeof claimedSender !== 'string' ||
    claimedSender.toLowerCase() !== sender.toLowerCase()
  ) {
    throw new Error('Operation is not from this wallet account');
  }
  if (!userOpHashMatches(parsed.userOpRequest, chain, parsed.opHash)) {
    throw new Error('Operation hash does not match the displayed operation');
  }
  const claimedKeys =
    parsed.publicKeys && typeof parsed.publicKeys === 'object'
      ? Object.values(parsed.publicKeys as Record<string, unknown>)
      : [];
  const expected = [normalizeHex(walletPubKey), normalizeHex(keyPubKey)].sort();
  const claimed = claimedKeys
    .map((k) => (typeof k === 'string' ? normalizeHex(k) : ''))
    .sort();
  if (
    claimed.length !== 2 ||
    claimed[0] !== expected[0] ||
    claimed[1] !== expected[1]
  ) {
    throw new Error('Operation signer keys are not this wallet and key');
  }
  const combined = accountAbstraction.signers.Schnorrkel.getCombinedPublicKey([
    new accountAbstraction.types.Key(Buffer.from(walletPubKey, 'hex')),
    new accountAbstraction.types.Key(Buffer.from(keyPubKey, 'hex')),
  ]);
  if (
    typeof parsed.combinedPubKey !== 'string' ||
    normalizeHex(parsed.combinedPubKey) !==
      normalizeHex(combined.buffer.toString('hex'))
  ) {
    throw new Error('Operation combined key is not this wallet and key');
  }
  return {
    sender,
    walletPubKey,
    keyPubKey,
    opHash: String(parsed.opHash),
  };
}

function gasField(value: unknown, label: string): BigNumber {
  let bn: BigNumber;
  try {
    bn = new BigNumber(
      typeof value === 'string' || typeof value === 'number' ? value : NaN,
    );
  } catch {
    bn = new BigNumber(NaN);
  }
  if (!bn.isFinite() || !bn.isInteger() || bn.isNegative()) {
    throw new Error(`Invalid gas value: ${label}`);
  }
  return bn;
}

/**
 * Item 7: the maximum gas cost of a consumer EVM operation (wei) — without a
 * paymaster, (callGasLimit + verificationGasLimit + preVerificationGas) *
 * maxFeePerGas, as the approval screen shows it — must not exceed
 * min(CONSUMER_EVM_MAX_FEE_WEI[chain], CONSUMER_MAX_FEE_USD at `usdRate`).
 * Returns the fee and the cap in wei; throws (fail closed) otherwise.
 */
export function assertConsumerEvmFeeWithinCap(
  rawTx: string,
  chain: keyof cryptos,
  usdRate: number,
): { fee: string; maxFee: string } {
  const hardCap = CONSUMER_EVM_MAX_FEE_WEI[chain];
  if (!hardCap) {
    throw new Error('No fee cap configured for this chain');
  }
  let op: Record<string, unknown> | undefined;
  try {
    op = (JSON.parse(rawTx) as { userOpRequest?: Record<string, unknown> })
      .userOpRequest;
  } catch {
    op = undefined;
  }
  if (!op || typeof op !== 'object') {
    throw new Error('Invalid EVM request: missing userOpRequest');
  }
  const fee = gasField(op.callGasLimit, 'callGasLimit')
    .plus(gasField(op.verificationGasLimit, 'verificationGasLimit'))
    .plus(gasField(op.preVerificationGas, 'preVerificationGas'))
    .multipliedBy(gasField(op.maxFeePerGas, 'maxFeePerGas'));
  const maxFee = maxConsumerFee(hardCap, blockchains[chain].decimals, usdRate);
  if (fee.isGreaterThan(maxFee)) {
    throw new Error(
      `Network fee ${fee.toFixed()} exceeds the maximum of ${maxFee.toFixed()}`,
    );
  }
  return { fee: fee.toFixed(), maxFee: maxFee.toFixed() };
}
