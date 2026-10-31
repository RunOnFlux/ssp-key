import BigNumber from 'bignumber.js';
import utxolib from '@runonflux/utxo-lib';
import { decodeFunctionData, erc20Abi } from 'viem';
import * as abi from '@runonflux/aa-schnorr-multisig-sdk/dist/abi';
import { toCashAddress } from 'bchaddrjs';
import { getLibId } from './wallet';
import { fetchRawTransactionHex, fetchUtxos } from './constructTx';
import { getCryptoUsdRate } from './rates';
import { assertEvmCallSafe, hasEvmCalldata } from './consumerGuards';
import { verifyConsumerUtxoTransaction } from './consumerUtxo';
import type { ConsumerKeyMaterial, ConsumerUtxoDeps } from './consumerUtxo';
import {
  decodeConsumerSolanaTransaction,
  parseConsumerSolanaPayload,
  resolveConsumerSolanaLeaves,
} from './consumerSolana';
import {
  assertConsumerEvmFeeWithinCap,
  verifyConsumerEvmRequest,
} from './consumerEvm';
import { cryptos } from '../types';

import { blockchains } from '@storage/blockchains';

export interface VaultDecodedRecipient {
  address: string;
  amount: string; // base units (satoshis / wei)
}

export interface VaultDecodedTx {
  sender: string;
  recipients: VaultDecodedRecipient[];
  fee: string; // base units
  tokenSymbol?: string;
  tokenContract?: string;
  tokenDecimals?: number;
  /**
   * Set whenever this device could NOT establish what the transaction does.
   * The approval screen must fail closed on it — show the error and refuse to
   * sign — because an unverified payload is exactly what the Key exists to
   * catch.
   */
  error?: string;
  /** Raw inner calldata, when it could not be decoded into recipients. */
  callData?: string;
}

/**
 * Decode a vault transaction from raw TX data for independent verification.
 * Supports multiple recipients (enterprise vaults) and returns base-unit amounts.
 *
 * UTXO: decodes TX hex → extracts all non-change outputs as recipients.
 * EVM: parses UserOperation JSON → decodes callData → extracts execute/transfer.
 */
export function decodeVaultTransaction(
  rawTx: string,
  chain: keyof cryptos,
  inputAmounts: string[] = [],
  inputScripts?: { witnessScript?: string; redeemScript?: string },
): VaultDecodedTx {
  try {
    if (blockchains[chain].chainType === 'evm') {
      return decodeVaultEvmTransaction(rawTx, chain);
    }
    return decodeVaultUtxoTransaction(rawTx, chain, inputAmounts, inputScripts);
  } catch (error) {
    return {
      sender: '',
      recipients: [],
      fee: '0',
      error:
        error instanceof Error ? error.message : 'Failed to decode transaction',
    };
  }
}

function decodeVaultUtxoTransaction(
  rawTx: string,
  chain: keyof cryptos,
  inputAmounts: string[],
  inputScripts?: { witnessScript?: string; redeemScript?: string },
): VaultDecodedTx {
  const libID = getLibId(chain);
  const cashAddrPrefix = blockchains[chain].cashaddr;
  const network = utxolib.networks[libID];

  const txb = utxolib.TransactionBuilder.fromTransaction(
    utxolib.Transaction.fromHex(rawTx, network),
    network,
  );

  // Derive sender address from first input's script.
  // For unsigned TXs the scripts aren't embedded in the raw hex, so we also
  // accept them from inputDetails metadata (witnessScript/redeemScript from
  // the vault address generation, stored in the proposal).
  let senderAddress = '';

  // Try scripts from the raw TX first (available for partially-signed TXs)
  const txWitnessScript = txb.inputs[0].witnessScript;
  const txRedeemScript = txb.inputs[0].redeemScript;

  // Fall back to scripts from inputDetails metadata (always available)
  const witnessScript =
    txWitnessScript ||
    (inputScripts?.witnessScript
      ? Buffer.from(inputScripts.witnessScript, 'hex')
      : undefined);
  const redeemScript =
    txRedeemScript ||
    (inputScripts?.redeemScript
      ? Buffer.from(inputScripts.redeemScript, 'hex')
      : undefined);

  if (witnessScript && redeemScript) {
    // P2SH-P2WSH
    const scriptPubKey = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(redeemScript),
    );
    senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
  } else if (witnessScript) {
    // P2WSH
    const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
      utxolib.crypto.sha256(witnessScript),
    );
    senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
  } else if (redeemScript) {
    // P2SH
    const scriptPubKey = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(redeemScript),
    );
    senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
  }

  // Extract all outputs — separate recipients from change
  const recipients: VaultDecodedRecipient[] = [];
  let totalOutputValue = new BigNumber(0);

  txb.tx.outs.forEach((out: output) => {
    if (out.value) {
      let address = utxolib.address.fromOutputScript(out.script, network);
      if (cashAddrPrefix) {
        address = toCashAddress(address);
      }
      totalOutputValue = totalOutputValue.plus(new BigNumber(out.value));
      let senderAddr = senderAddress;
      if (cashAddrPrefix) {
        senderAddr = toCashAddress(senderAddress);
      }
      if (address !== senderAddr) {
        recipients.push({
          address,
          amount: String(out.value),
        });
      }
    }
  });

  // Calculate fee: sum(inputs) - sum(outputs)
  let fee = '0';
  if (inputAmounts.length > 0) {
    const totalInputs = inputAmounts.reduce(
      (sum, a) => sum.plus(new BigNumber(a)),
      new BigNumber(0),
    );
    fee = totalInputs.minus(totalOutputValue).toFixed();
  }

  if (cashAddrPrefix && senderAddress) {
    senderAddress = toCashAddress(senderAddress);
  }

  return { sender: senderAddress, recipients, fee };
}

function decodeVaultEvmTransaction(
  rawTx: string,
  chain: keyof cryptos,
): VaultDecodedTx {
  const multisigUserOpJSON = JSON.parse(rawTx) as userOperation;

  if (!multisigUserOpJSON.userOpRequest) {
    throw new Error('Invalid transaction format: missing userOpRequest');
  }

  const {
    callData,
    sender,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
    maxFeePerGas,
  } = multisigUserOpJSON.userOpRequest;

  // maxFeePerGas already includes the priority fee — do not add it again
  const totalGasLimit = new BigNumber(callGasLimit)
    .plus(new BigNumber(verificationGasLimit))
    .plus(new BigNumber(preVerificationGas));
  const fee = totalGasLimit.multipliedBy(new BigNumber(maxFeePerGas)).toFixed();

  const decodedData = decodeFunctionData({
    abi: abi.MultiSigSmartAccount_abi,
    data: callData,
  }) as decodedAbiData;

  if (
    !decodedData ||
    decodedData.functionName !== 'execute' ||
    !decodedData.args ||
    decodedData.args.length < 3
  ) {
    throw new Error('Unexpected callData format');
  }

  const result: VaultDecodedTx = {
    sender,
    recipients: [],
    fee,
  };

  const executeTarget = decodedData.args[0];
  const executeValue = decodedData.args[1].toString();
  const executeData = decodedData.args[2];

  // EVM call-safety rules (C-4): a self-call or an account-upgrade selector
  // can replace the account implementation in one signature — refuse it.
  assertEvmCallSafe({ target: executeTarget, data: executeData }, sender);

  if (executeValue !== '0' && hasEvmCalldata(executeData)) {
    // Any non-empty inner calldata is a contract call whatever the value. It
    // used to be shown as a plain native send with the calldata dropped.
    result.tokenSymbol = blockchains[chain].symbol;
    result.callData = executeData;
    result.error = 'Contract call with native value cannot be verified';
  } else if (executeValue !== '0') {
    result.recipients = [{ address: executeTarget, amount: executeValue }];
    result.tokenSymbol = blockchains[chain].symbol;
  } else {
    result.tokenContract = executeTarget;

    const token = blockchains[chain].tokens.find(
      (t) => t.contract.toLowerCase() === executeTarget.toLowerCase(),
    );
    if (token) {
      result.tokenSymbol = token.symbol;
      result.tokenDecimals = token.decimals;
    }

    try {
      const contractData: `0x${string}` = decodedData.args[2] as `0x${string}`;
      const decodedContract = decodeFunctionData({
        abi: erc20Abi,
        data: contractData,
      }) as unknown as decodedAbiData;

      if (
        decodedContract &&
        decodedContract.functionName === 'transfer' &&
        decodedContract.args &&
        decodedContract.args.length >= 2
      ) {
        result.recipients = [
          {
            address: decodedContract.args[0],
            amount: decodedContract.args[1].toString(),
          },
        ];
      } else {
        // Decodable, but NOT a transfer — approve / transferFrom /
        // setApprovalForAll grant spend RIGHTS rather than moving funds. Leaving
        // recipients empty rendered "No recipient data available" next to an
        // ENABLED slide-to-approve, so surface it as a decode error instead:
        // the approval screen then shows its error card and refuses to sign.
        result.callData = contractData;
        result.error = `Contract call is not a token transfer (${
          decodedContract?.functionName ?? 'unknown'
        })`;
      }
    } catch {
      // Not ERC-20 calldata at all. This used to fabricate a single recipient at
      // the execute target with amount '0' and set NO error, so an arbitrary
      // contract call was presented as a harmless zero-value transfer.
      result.callData = decodedData.args[2];
      result.error = 'Could not decode the contract call';
    }
  }

  return result;
}

// ===========================================================================
// Consumer (2-of-2 wallet + key) approval decode
// ===========================================================================

/**
 * Key material the consumer decode binds the request to: the request's
 * derivation path and this chain's DECRYPTED wallet + key xpubs (for Solana:
 * the JSON leaf-pubkey lists). Without it nothing can be verified, so the
 * decode fails closed.
 */
export type ConsumerDecodeContext = ConsumerKeyMaterial;

export interface ApprovalRecipient {
  address: string;
  /** Human-readable amount (decimals applied). */
  amount: string;
  /** Solana SPL: destination token account. */
  ata?: string;
  /** Solana SPL: the ATA was derived from the wallet-supplied owner. */
  ownerVerified?: boolean;
}

export type ApprovalWarning =
  | 'spl_owner_unverified'
  | 'unknown_token'
  | 'contract_call_with_value';

interface tokenInfo {
  sender: string;
  receiver: string;
  amount: string;
  fee: string;
  tokenSymbol: string;
  token?: string;
  data?: string;
  // Number of non-change destinations. >1 means `amount` is their sum and
  // `receiver` is the first — the approval UI lists every one of them.
  recipientCount?: number;
  /** Every non-change destination with its own amount (UTXO / Solana). */
  recipients?: ApprovalRecipient[];
  /** EVM: native value sent along with a contract call (human-readable). */
  nativeValue?: string;
  warnings?: ApprovalWarning[];
  memo?: string;
  /** Why the decode failed (sentinel fields are then 'decodingError'). */
  error?: string;
}

function decodingErrorInfo(
  chain: keyof cryptos,
  error: unknown,
): tokenInfo & { token: string; data: string } {
  const message =
    error instanceof Error ? error.message : 'Failed to decode transaction';
  console.log('[decodeTransactionForApproval] refused:', chain, message);
  return {
    sender: 'decodingError',
    receiver: 'decodingError',
    amount: 'decodingError',
    fee: 'decodingError',
    tokenSymbol: 'decodingError',
    token: 'decodingError',
    data: 'decodingError',
    error: message,
  };
}

function toHumanAmount(base: string | BigNumber, decimals: number): string {
  return new BigNumber(base)
    .dividedBy(new BigNumber(10).pow(decimals))
    .toFixed();
}

/** The key's own backends — used by display AND signing. */
export const consumerUtxoDeps: ConsumerUtxoDeps = {
  fetchOwnUtxos: (address, chain) => fetchUtxos(address, chain, 2),
  fetchRawTransaction: (txid, chain) => fetchRawTransactionHex(txid, chain),
  getUsdRate: (chain) => getCryptoUsdRate(chain),
};

/**
 * Decode a consumer transaction request for the approval screen.
 *
 * Every chain is verified against the key's own key material (see
 * consumerUtxo / consumerSolana / consumerEvm). Anything that cannot be
 * verified returns the 'decodingError' sentinels (plus `error`), which the
 * approval screen renders as a blocking error.
 */
export async function decodeTransactionForApproval(
  rawTx: string,
  chain: keyof cryptos,
  ctx?: ConsumerDecodeContext,
  deps: Partial<ConsumerUtxoDeps> = {},
): Promise<tokenInfo> {
  const resolvedDeps: ConsumerUtxoDeps = {
    ...consumerUtxoDeps,
    ...deps,
  };
  try {
    if (!ctx || !ctx.path || !ctx.xpubWallet || !ctx.xpubKey) {
      throw new Error('Missing key material to verify the request');
    }
    const chainType = blockchains[chain].chainType;
    if (chainType === 'evm') {
      verifyConsumerEvmRequest(rawTx, chain, ctx);
      // Item 7: the operation's maximum gas cost is capped like UTXO/Solana.
      const usdRate = await resolvedDeps.getUsdRate(chain).catch(() => 0);
      assertConsumerEvmFeeWithinCap(rawTx, chain, usdRate);
      const decoded = await decodeEVMTransactionForApproval(rawTx, chain);
      if (decoded.amount === 'decodingError') {
        throw new Error(decoded.error ?? 'Could not decode the operation');
      }
      return decoded;
    }
    if (chainType === 'sol') {
      const payload = parseConsumerSolanaPayload(rawTx);
      const leaves = resolveConsumerSolanaLeaves(
        ctx.xpubWallet,
        ctx.xpubKey,
        ctx.path,
      );
      const usdRate = await resolvedDeps.getUsdRate(chain).catch(() => 0);
      const decoded = await decodeConsumerSolanaTransaction(
        chain,
        payload,
        leaves,
        usdRate,
      );
      const recipients: ApprovalRecipient[] = decoded.recipients.map((r) => ({
        address: r.address,
        amount: toHumanAmount(r.amount, decoded.decimals),
        ata: r.ata,
        ownerVerified: r.ownerVerified,
      }));
      const total = decoded.recipients.reduce(
        (sum, r) => sum.plus(r.amount),
        new BigNumber(0),
      );
      return {
        sender: decoded.sender,
        receiver: recipients[0].address,
        amount: toHumanAmount(total, decoded.decimals),
        fee: toHumanAmount(decoded.feeLamports, blockchains[chain].decimals),
        tokenSymbol: decoded.tokenSymbol,
        token: decoded.mint,
        recipientCount: recipients.length,
        recipients,
        warnings: decoded.warnings,
        memo: decoded.memo,
      };
    }
    const verified = await verifyConsumerUtxoTransaction(
      rawTx,
      chain,
      ctx,
      resolvedDeps,
    );
    const decimals = blockchains[chain].decimals;
    const recipients: ApprovalRecipient[] = verified.recipients.map((r) => ({
      address: r.address,
      amount: toHumanAmount(r.amount, decimals),
    }));
    const recipientTotal = verified.recipients.reduce(
      (sum, r) => sum.plus(r.amount),
      new BigNumber(0),
    );
    // A transaction whose only outputs return to the derived address is a
    // self-transfer: show the sender as the destination, never a guess.
    const selfTransfer = recipients.length === 0;
    return {
      sender: verified.sender,
      receiver: selfTransfer ? verified.sender : recipients[0].address,
      amount: toHumanAmount(
        selfTransfer ? verified.change : recipientTotal,
        decimals,
      ),
      fee: toHumanAmount(verified.fee, decimals),
      tokenSymbol: blockchains[chain].symbol,
      recipientCount: recipients.length,
      recipients,
    };
  } catch (error) {
    if (blockchains[chain]?.chainType === 'evm') {
      return decodingErrorInfo(chain, error);
    }
    const info = decodingErrorInfo(chain, error);
    return {
      sender: info.sender,
      receiver: info.receiver,
      amount: info.amount,
      fee: info.fee,
      tokenSymbol: info.tokenSymbol,
      error: info.error,
    };
  }
}

interface output {
  script: Buffer;
  value: number;
}

interface decodedAbiData {
  functionName: string;
  args: [string, bigint, string];
}

interface userOperation {
  userOpRequest: {
    sender: string;
    callData: `0x${string}`;
    callGasLimit: `0x${string}`;
    verificationGasLimit: `0x${string}`;
    preVerificationGas: `0x${string}`;
    maxFeePerGas: `0x${string}`;
    maxPriorityFeePerGas: `0x${string}`;
  };
}

/**
 * Decode the consumer smart-account operation for display. Applies the EVM
 * call-safety rules (C-4): any non-empty inner calldata is a contract call
 * whatever the value, self-calls and account-upgrade selectors are refused,
 * and anything other than a single `execute` (e.g. `executeBatch`) fails
 * closed. Token symbol/decimals come ONLY from this device's token list —
 * an unknown token is shown in raw base units with its contract.
 */
export function decodeEVMTransactionForApproval(
  rawTx: string,
  chain: keyof cryptos,
): Promise<tokenInfo & { token: string; data: string }> {
  return Promise.resolve(decodeEvmOperation(rawTx, chain));
}

function decodeEvmOperation(
  rawTx: string,
  chain: keyof cryptos,
): tokenInfo & { token: string; data: string } {
  try {
    const nativeDecimals = blockchains[chain].decimals;
    const multisigUserOpJSON = JSON.parse(rawTx) as userOperation;

    if (!multisigUserOpJSON.userOpRequest) {
      throw new Error('Invalid transaction format: missing userOpRequest');
    }

    const {
      callData,
      sender,
      callGasLimit,
      verificationGasLimit,
      preVerificationGas,
      maxFeePerGas,
    } = multisigUserOpJSON.userOpRequest;

    const totalGasLimit = new BigNumber(callGasLimit)
      .plus(new BigNumber(verificationGasLimit))
      .plus(new BigNumber(preVerificationGas));

    // maxFeePerGas already includes the priority fee — do not add it again
    const totalFee = totalGasLimit
      .multipliedBy(new BigNumber(maxFeePerGas))
      .dividedBy(new BigNumber(10).pow(18));
    if (!totalFee.isFinite()) {
      throw new Error('Invalid gas values');
    }

    const decodedData = decodeFunctionData({
      abi: abi.MultiSigSmartAccount_abi,
      data: callData,
    }) as decodedAbiData;

    if (
      !decodedData ||
      decodedData.functionName !== 'execute' ||
      !decodedData.args ||
      decodedData.args.length < 3
    ) {
      // executeBatch and anything else: not decodable call-by-call here.
      throw new Error('Unexpected decoded data.');
    }

    const [target, value, innerData] = decodedData.args;
    assertEvmCallSafe({ target, data: innerData }, sender);
    const nativeAmount = toHumanAmount(value.toString(), nativeDecimals);
    const hasValue = value.toString() !== '0';

    if (!hasEvmCalldata(innerData)) {
      // Plain native transfer.
      return {
        sender,
        receiver: target,
        amount: nativeAmount,
        fee: totalFee.toFixed(),
        token: '',
        tokenSymbol: blockchains[chain].symbol,
        data: '',
      };
    }

    // Contract call — whatever the value.
    const knownToken = blockchains[chain].tokens.find(
      (t) => !!t.contract && t.contract.toLowerCase() === target.toLowerCase(),
    );
    const txInfo: tokenInfo & { token: string; data: string } = {
      sender,
      receiver: target,
      amount: '0',
      fee: totalFee.toFixed(),
      token: target,
      tokenSymbol: knownToken?.symbol ?? '',
      data: innerData,
    };
    if (hasValue) {
      txInfo.nativeValue = nativeAmount;
      txInfo.warnings = ['contract_call_with_value'];
      return txInfo;
    }
    if (knownToken) {
      let decodedTransfer: decodedAbiData | null = null;
      try {
        decodedTransfer = decodeFunctionData({
          abi: erc20Abi,
          data: innerData as `0x${string}`,
        }) as unknown as decodedAbiData;
      } catch {
        decodedTransfer = null;
      }
      if (
        decodedTransfer &&
        decodedTransfer.functionName === 'transfer' &&
        decodedTransfer.args &&
        decodedTransfer.args.length >= 2
      ) {
        // A plain transfer of a token this device knows: friendly display
        // with on-device decimals. `data` is cleared deliberately so the
        // screen keeps the decoded amount.
        txInfo.receiver = decodedTransfer.args[0];
        txInfo.amount = toHumanAmount(
          decodedTransfer.args[1].toString(),
          knownToken.decimals,
        );
        txInfo.data = '';
        return txInfo;
      }
      // approve / transferFrom / setApprovalForAll / unknown calldata: the
      // raw calldata stays so the screen raises its risk banners.
      return txInfo;
    }
    // Unknown token / contract: never take decimals or symbol from the relay.
    txInfo.warnings = ['unknown_token'];
    return txInfo;
  } catch (error) {
    return decodingErrorInfo(chain, error);
  }
}
