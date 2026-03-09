import BigNumber from 'bignumber.js';
import utxolib from '@runonflux/utxo-lib';
import { decodeFunctionData, erc20Abi } from 'viem';
import * as abi from '@runonflux/aa-schnorr-multisig-sdk/dist/abi';
import { toCashAddress } from 'bchaddrjs';
import { getTokenMetadata } from './tokens';
import { getLibId } from './wallet';
import { cryptos, utxo } from '../types';

import { blockchains, Token } from '@storage/blockchains';

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
  error?: string;
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
): VaultDecodedTx {
  try {
    if (blockchains[chain].chainType === 'evm') {
      return decodeVaultEvmTransaction(rawTx, chain);
    }
    return decodeVaultUtxoTransaction(rawTx, chain, inputAmounts);
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
): VaultDecodedTx {
  const libID = getLibId(chain);
  const cashAddrPrefix = blockchains[chain].cashaddr;
  const network = utxolib.networks[libID];

  const txb = utxolib.TransactionBuilder.fromTransaction(
    utxolib.Transaction.fromHex(rawTx, network),
    network,
  );

  // Derive sender address from first input's script
  let senderAddress = '';
  if (txb.inputs[0].witnessScript && txb.inputs[0].redeemScript) {
    const scriptPubKey = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(txb.inputs[0].redeemScript),
    );
    senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
  } else if (txb.inputs[0].witnessScript) {
    const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
      utxolib.crypto.sha256(txb.inputs[0].witnessScript),
    );
    senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
  } else if (txb.inputs[0].redeemScript) {
    const scriptPubKey = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(txb.inputs[0].redeemScript),
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
    maxPriorityFeePerGas,
  } = multisigUserOpJSON.userOpRequest;

  const totalGasLimit = new BigNumber(callGasLimit)
    .plus(new BigNumber(verificationGasLimit))
    .plus(new BigNumber(preVerificationGas));
  const totalMaxWeiPerGas = new BigNumber(maxFeePerGas).plus(
    new BigNumber(maxPriorityFeePerGas),
  );
  const fee = totalGasLimit.multipliedBy(totalMaxWeiPerGas).toFixed();

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

  if (executeValue !== '0') {
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
      }
    } catch {
      result.recipients = [{ address: executeTarget, amount: '0' }];
    }
  }

  return result;
}

interface output {
  script: Buffer;
  value: number;
}

interface tokenInfo {
  sender: string;
  receiver: string;
  amount: string;
  fee: string;
  tokenSymbol: string;
  token?: string;
  data?: string;
}

export async function decodeTransactionForApproval(
  rawTx: string,
  chain: keyof cryptos,
  utxos?: utxo[],
): Promise<tokenInfo> {
  try {
    if (blockchains[chain].chainType === 'evm') {
      const decodedTx = await decodeEVMTransactionForApproval(rawTx, chain);
      return decodedTx;
    }
    const libID = getLibId(chain);
    const decimals = blockchains[chain].decimals;
    const cashAddrPrefix = blockchains[chain].cashaddr;
    const network = utxolib.networks[libID];
    const txhex = rawTx;
    const txb = utxolib.TransactionBuilder.fromTransaction(
      utxolib.Transaction.fromHex(txhex, network),
      network,
    );
    console.log(JSON.stringify(txb));
    let txReceiver = 'decodingError';
    let amount = '0';
    let senderAddress = '';
    let totalInputsAmount = new BigNumber(0);
    let totalOutputsAmount = new BigNumber(0);

    if (txb.inputs[0].witnessScript && txb.inputs[0].redeemScript) {
      // p2sh-p2wsh
      const scriptPubKey = utxolib.script.scriptHash.output.encode(
        utxolib.crypto.hash160(txb.inputs[0].redeemScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    } else if (txb.inputs[0].witnessScript) {
      // p2wsh
      const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
        utxolib.crypto.sha256(txb.inputs[0].witnessScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    } else {
      // p2sh
      const scriptPubKey = utxolib.script.scriptHash.output.encode(
        utxolib.crypto.hash160(txb.inputs[0].redeemScript),
      );
      senderAddress = utxolib.address.fromOutputScript(scriptPubKey, network);
    }

    txb.tx.outs.forEach((out: output) => {
      if (out.value) {
        const address = utxolib.address.fromOutputScript(out.script, network);
        console.log(address);
        totalOutputsAmount = totalOutputsAmount.plus(new BigNumber(out.value));
        if (address !== senderAddress) {
          txReceiver = address;
          amount = new BigNumber(out.value)
            .dividedBy(new BigNumber(10 ** decimals))
            .toFixed();
        }
      }
    });
    if (txReceiver === 'decodingError') {
      // use first output as being the receiver
      const outOne = txb.tx.outs[0];
      if (outOne.value) {
        const address = utxolib.address.fromOutputScript(
          outOne.script,
          network,
        );
        console.log(address);
        txReceiver = address;
        amount = new BigNumber(outOne.value)
          .dividedBy(new BigNumber(10 ** decimals))
          .toFixed();
      }
    }

    if (utxos && utxos.length) {
      // utxos were supplied, we can calculate fee
      utxos.forEach((u) => {
        totalInputsAmount = totalInputsAmount.plus(new BigNumber(u.satoshis));
      });
    }

    const fee = totalInputsAmount
      .minus(totalOutputsAmount)
      .dividedBy(10 ** decimals)
      .toFixed();
    // calculate fee
    if (utxos && utxos.length && +fee < 0) {
      // fee is negative, something is wrong. Reject.
      throw new Error('Unexpected negative fee. Transaction Rejected.');
    }
    if (cashAddrPrefix) {
      senderAddress = toCashAddress(senderAddress);
      txReceiver = toCashAddress(txReceiver);
    }
    const txInfo = {
      sender: senderAddress,
      receiver: txReceiver,
      amount,
      fee,
      tokenSymbol: blockchains[chain].symbol,
    };
    return txInfo;
  } catch (error) {
    console.log(error);
    const txInfo = {
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
      tokenSymbol: 'decodingError',
    };
    return txInfo;
  }
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

export async function decodeEVMTransactionForApproval(
  rawTx: string,
  chain: keyof cryptos,
) {
  try {
    let decimals = blockchains[chain].decimals;
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
      maxPriorityFeePerGas,
    } = multisigUserOpJSON.userOpRequest;

    const totalGasLimit = new BigNumber(callGasLimit)
      .plus(new BigNumber(verificationGasLimit))
      .plus(new BigNumber(preVerificationGas));

    const totalMaxWeiPerGas = new BigNumber(maxFeePerGas).plus(
      new BigNumber(maxPriorityFeePerGas),
    );

    const totalFeeWei = totalGasLimit
      .multipliedBy(totalMaxWeiPerGas)
      .dividedBy(10 ** 18);

    console.log(multisigUserOpJSON);

    // callGasLimit":"0x5ea6","verificationGasLimit":"0x11b5a","preVerificationGas":"0xdf89","maxFeePerGas":"0xee6b28000","maxPriorityFeePerGas":"0x77359400",

    const decodedData: decodedAbiData = decodeFunctionData({
      abi: abi.MultiSigSmartAccount_abi,
      data: callData,
    }) as decodedAbiData; // Cast decodedData to decodedAbiData type.

    console.log(decodedData);

    let txReceiver = 'decodingError';
    let amount = '0';

    if (
      decodedData &&
      decodedData.functionName === 'execute' &&
      decodedData.args &&
      decodedData.args.length >= 3
    ) {
      txReceiver = decodedData.args[0];
      amount = new BigNumber(decodedData.args[1].toString())
        .dividedBy(new BigNumber(10 ** decimals))
        .toFixed();
    } else {
      throw new Error('Unexpected decoded data.');
    }

    const txInfo = {
      sender,
      receiver: txReceiver,
      amount,
      fee: totalFeeWei.toFixed(),
      token: '',
      tokenSymbol: '',
      data: '',
    };

    if (amount === '0') {
      // token transfer or contract execution
      txInfo.token = decodedData.args[0];

      // find the token in our token list
      let token = blockchains[chain].tokens.find(
        (t) => t.contract.toLowerCase() === txInfo.token.toLowerCase(),
      );

      if (!token) {
        token = (await getTokenMetadata(
          txInfo.token.toLowerCase(),
          chain.toLowerCase(),
        )) as Token; // this is actually a tokenDataSSPRelay missing contract but we need only decimals
      }

      if (token && token.name && token.symbol) {
        decimals = token.decimals;
        txInfo.tokenSymbol = token.symbol;
        const contractData: `0x${string}` = decodedData
          .args[2] as `0x${string}`;
        // most likely we are dealing with a contract call, sending some erc20 token
        // docode args[2] which is operation
        const decodedDataContract: decodedAbiData = decodeFunctionData({
          abi: erc20Abi,
          data: contractData,
        }) as unknown as decodedAbiData; // Cast decodedDataContract to decodedAbiData type.
        console.log(decodedDataContract);
        if (
          decodedDataContract &&
          decodedDataContract.functionName === 'transfer' &&
          decodedDataContract.args &&
          decodedDataContract.args.length >= 2
        ) {
          txInfo.receiver = decodedDataContract.args[0];
          txInfo.amount = new BigNumber(decodedDataContract.args[1].toString())
            .dividedBy(new BigNumber(10 ** decimals))
            .toFixed();
        }
      } else {
        // this is not a standard token transfer, treat it as a contract execution and only display data information
        txInfo.data = decodedData.args[2] as `0x${string}`;
      }
    } else {
      txInfo.tokenSymbol = blockchains[chain].symbol;
      txInfo.data = decodedData.args[2] as `0x${string}`;
    }

    return txInfo;
  } catch (error) {
    console.log(error);
    const txInfo = {
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
      token: 'decodingError',
      tokenSymbol: 'decodingError',
      data: 'decodingError',
    };
    return txInfo;
  }
}
