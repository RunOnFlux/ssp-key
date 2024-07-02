import BigNumber from 'bignumber.js';
import utxolib from '@runonflux/utxo-lib';
import { decodeFunctionData } from 'viem';
import * as abi from '@runonflux/aa-schnorr-multisig-sdk/dist/abi';
import { toCashAddress } from 'bchaddrjs';
import { cryptos, utxo } from '../types';

import { blockchains } from '@storage/blockchains';

export function getLibId(chain: keyof cryptos): string {
  return blockchains[chain].libid;
}
interface output {
  script: Buffer;
  value: number;
}

export function decodeTransactionForApproval(
  rawTx: string,
  chain: keyof cryptos,
  utxos: utxo[],
) {
  try {
    if (blockchains[chain].chainType === 'evm') {
      return decodeEVMTransactionForApproval(rawTx, chain);
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
    };
    return txInfo;
  } catch (error) {
    console.log(error);
    const txInfo = {
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
    };
    return txInfo;
  }
}

interface decodedAbiData {
  functionName: string;
  args: [string, BigInt, string];
}

interface userOperation {
  userOpRequest: {
    sender: string;
    callData: `0x${string}`;
  };
}

export function decodeEVMTransactionForApproval(
  rawTx: string,
  chain: keyof cryptos,
) {
  try {
    const decimals = blockchains[chain].decimals;
    const multisigUserOpJSON = JSON.parse(rawTx) as userOperation;
    const { callData, sender } = multisigUserOpJSON.userOpRequest;

    const decodedData: decodedAbiData = decodeFunctionData({
      abi: abi.MultiSigSmartAccount_abi,
      data: callData,
    }) as decodedAbiData; // Cast decodedData to decodedAbiData type.

    let txReceiver = 'decodingError';
    let amount = '0';

    if (
      decodedData &&
      decodedData.functionName === 'execute' &&
      decodedData.args &&
      decodedData.args.length === 3
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
      fee: '0', // @todo: calculate fee
    };
    return txInfo;
  } catch (error) {
    console.log(error);
    const txInfo = {
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
    };
    return txInfo;
  }
}
