import BigNumber from 'bignumber.js';
import QuickCrypto from 'react-native-quick-crypto';
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
    if (blockchains[chain].chainType === 'sol') {
      // Single-roundtrip flow: payload is JSON wrapping the unsigned tx
      // plus token metadata (mint/symbol/decimals so the approval screen
      // can show the real SPL token, since the proposal bytes only carry
      // ATAs). Older callers pass a bare base64 tx string.
      let serializedForDecode = rawTx;
      let tokenMeta:
        | { mint?: string; symbol?: string; decimals?: number }
        | undefined;
      try {
        const parsed = JSON.parse(rawTx) as {
          unsignedTxBase64?: string;
          tokenMint?: string;
          tokenSymbol?: string;
          tokenDecimals?: number;
        };
        if (parsed && typeof parsed.unsignedTxBase64 === 'string') {
          serializedForDecode = parsed.unsignedTxBase64;
          tokenMeta = {
            mint:
              typeof parsed.tokenMint === 'string'
                ? parsed.tokenMint
                : undefined,
            symbol:
              typeof parsed.tokenSymbol === 'string'
                ? parsed.tokenSymbol
                : undefined,
            decimals:
              typeof parsed.tokenDecimals === 'number'
                ? parsed.tokenDecimals
                : undefined,
          };
        }
      } catch {
        // Not JSON — fall through to decode rawTx directly.
      }
      const decodedTx = await decodeSOLTransactionForApproval(
        serializedForDecode,
        chain,
        tokenMeta,
      );
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
    } = multisigUserOpJSON.userOpRequest;

    const totalGasLimit = new BigNumber(callGasLimit)
      .plus(new BigNumber(verificationGasLimit))
      .plus(new BigNumber(preVerificationGas));

    // maxFeePerGas already includes the priority fee — do not add it again
    const totalFeeWei = totalGasLimit
      .multipliedBy(new BigNumber(maxFeePerGas))
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

// Decode an SSP Solana proposal for the approval screen. Splits the
// proposal's transfers into the user's send (vault → recipient) and the
// fee (vault → outer feePayer = paymaster). SPL transfers show the
// destination ATA as the receiver; explorers resolve ATAs to owners.
async function decodeSOLTransactionForApproval(
  rawTxBase64: string,
  chain: keyof cryptos,
  tokenMeta?: { mint?: string; symbol?: string; decimals?: number },
): Promise<tokenInfo> {
  try {
    const { Transaction, PublicKey, SystemProgram } =
      await import('@solana/web3.js');
    const decimals = blockchains[chain].decimals;
    const tokenSymbol = blockchains[chain].symbol;

    const tx = Transaction.from(Buffer.from(rawTxBase64, 'base64'));
    if (!tx.feePayer) {
      throw new Error('Solana tx missing feePayer');
    }
    const paymasterPubkey = tx.feePayer;

    // Compute the create_transaction discriminator (first 8 bytes of
    // sha256("global:create_transaction")) using react-native-quick-crypto
    // — Node's `crypto.createHash` isn't available in RN, and utxolib's
    // sha256 wasn't reachable from this RN bundle either.
    const createIxDiscriminator: Buffer = Buffer.from(
      QuickCrypto.createHash('sha256')
        .update('global:create_transaction')
        .digest(),
    ).subarray(0, 8);
    console.log(createIxDiscriminator);
    console.log(tx.instructions);
    // `ix.data` from `Transaction.from(...)` is typed as Buffer but the
    // RN runtime can deliver a plain JS array of numbers (no `.subarray`,
    // no `.readUInt32LE`, no `.equals`). Compare byte-by-byte using only
    // index access, then `Buffer.from(...)` the matched ix's data so all
    // the parser helpers below have a real Buffer to work with.
    const createIx = tx.instructions.find((ix) => {
      if (!ix.data || ix.data.length < 8) return false;
      for (let i = 0; i < 8; i++) {
        if ((ix.data as ArrayLike<number>)[i] !== createIxDiscriminator[i])
          return false;
      }
      return true;
    });
    if (!createIx) {
      throw new Error('Solana tx does not contain a create_transaction ix');
    }
    const data = Buffer.from(createIx.data as ArrayLike<number>);
    let off = 8 + 1 + 3; // skip discriminator + vault_index + 3-byte header
    const accountKeysLen = data.readUInt32LE(off);
    off += 4;
    const accountKeys: InstanceType<typeof PublicKey>[] = [];
    for (let i = 0; i < accountKeysLen; i++) {
      accountKeys.push(new PublicKey(data.subarray(off, off + 32)));
      off += 32;
    }
    const ixCount = data.readUInt32LE(off);
    off += 4;

    const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

    let vaultPubkey = accountKeys[0]; // convention: vault is at index 0
    let userReceiver = '';
    let userAmountBase = '0';
    let feeBase = '0';
    let userTokenSymbol = tokenSymbol; // default to native
    let userTokenContract: string | undefined;
    let isSpl = false; // explicit — don't rely on userTokenSymbol === tokenSymbol
    // because the SPL mint's symbol could coincidentally match the chain
    // symbol (e.g., a token branded "SOL" on Solana mainnet) which would
    // mis-classify the tx as native and divide by wrong decimals.
    let verifiedDecimals: number | undefined;

    for (let i = 0; i < ixCount; i++) {
      const programIdIdx = data.readUInt8(off);
      off += 1;
      const aiLen = data.readUInt32LE(off);
      off += 4;
      const accountIdxs = Buffer.from(data.subarray(off, off + aiLen));
      off += aiLen;
      const ixDataLen = data.readUInt32LE(off);
      off += 4;
      const ixData = Buffer.from(data.subarray(off, off + ixDataLen));
      off += ixDataLen;

      const ixProgram = accountKeys[programIdIdx];
      if (!ixProgram) continue;

      if (ixProgram.equals(SystemProgram.programId)) {
        if (ixData.length < 12 || ixData.readUInt32LE(0) !== 2) continue;
        if (accountIdxs.length < 2) continue;
        const fromIdx = accountIdxs[0];
        const toPubkey = accountKeys[accountIdxs[1]];
        if (!toPubkey) continue;
        const amountLamports = ixData.readBigUInt64LE(4).toString();
        if (toPubkey.equals(paymasterPubkey)) {
          feeBase = new BigNumber(feeBase).plus(amountLamports).toFixed();
        } else {
          vaultPubkey = accountKeys[fromIdx];
          userReceiver = toPubkey.toBase58();
          userAmountBase = amountLamports;
        }
        continue;
      }

      // SPL Transfer (tag 3) vs TransferChecked (tag 12). TransferChecked
      // embeds the mint + decimals in the signed bytes, so we can verify
      // wallet-supplied tokenMeta against the bytes the user is about to
      // sign — mismatches throw. Plain Transfer carries neither, so the
      // wallet-supplied metadata is the only source (used as-is).
      if (ixProgram.toBase58() === TOKEN_PROGRAM) {
        const tag = ixData.readUInt8(0);
        if (tag === 12 && ixData.length >= 10 && accountIdxs.length >= 4) {
          // TransferChecked: accountIndexes = [source, mint, dest, authority]
          const ixMint = accountKeys[accountIdxs[1]];
          const destAta = accountKeys[accountIdxs[2]];
          if (!ixMint || !destAta) continue;
          const ixDecimals = ixData.readUInt8(9);
          if (tokenMeta?.mint && tokenMeta.mint !== ixMint.toBase58()) {
            throw new Error(
              'SPL mint mismatch: wallet-supplied mint differs from signed transaction',
            );
          }
          if (
            tokenMeta?.decimals != null &&
            tokenMeta.decimals !== ixDecimals
          ) {
            throw new Error(
              'SPL decimals mismatch: wallet-supplied decimals differ from signed transaction',
            );
          }
          userReceiver = destAta.toBase58();
          userAmountBase = ixData.readBigUInt64LE(1).toString();
          userTokenSymbol = tokenMeta?.symbol || '(token)';
          userTokenContract = ixMint.toBase58(); // trustless from signed bytes
          verifiedDecimals = ixDecimals; // authoritative — on-chain re-verifies
          isSpl = true;
          continue;
        }
        if (tag === 3 && ixData.length >= 9 && accountIdxs.length >= 3) {
          // Legacy Transfer: accountIndexes = [source, dest, authority]; mint
          // + decimals are NOT in the bytes — wallet metadata is unverified.
          const destAta = accountKeys[accountIdxs[1]];
          if (!destAta) continue;
          userReceiver = destAta.toBase58();
          userAmountBase = ixData.readBigUInt64LE(1).toString();
          userTokenSymbol = tokenMeta?.symbol || '(token)';
          userTokenContract = tokenMeta?.mint;
          verifiedDecimals = tokenMeta?.decimals;
          isSpl = true;
          continue;
        }
        continue;
      }
    }

    // SPL amounts use decimals from the signed TransferChecked bytes when
    // available (authoritative), else wallet-supplied (legacy Transfer).
    // Native SOL uses chain decimals.
    const splDecimals = verifiedDecimals;
    const displayAmount = !isSpl
      ? new BigNumber(userAmountBase).dividedBy(10 ** decimals).toFixed()
      : splDecimals != null
        ? new BigNumber(userAmountBase).dividedBy(10 ** splDecimals).toFixed()
        : userAmountBase;
    const displayFee = new BigNumber(feeBase)
      .dividedBy(10 ** decimals)
      .toFixed();

    return {
      sender: vaultPubkey.toBase58(),
      receiver: userReceiver || 'decodingError',
      amount: displayAmount,
      fee: displayFee,
      tokenSymbol: userTokenSymbol,
      token: userTokenContract,
    };
  } catch (e) {
    console.log('[decodeSOLTransactionForApproval] error', e);
    return {
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: '0',
      tokenSymbol: blockchains[chain].symbol,
    };
  }
}
