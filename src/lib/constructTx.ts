import utxolib from '@runonflux/utxo-lib';
import * as accountAbstraction from '@runonflux/aa-schnorr-multisig-sdk';
import { getEntryPoint, createSmartAccountClient } from '@alchemy/aa-core';
import { http as viemHttp } from 'viem';
import * as viemChains from 'viem/chains';
import { Buffer } from 'buffer';
import axios from 'axios';
import BigNumber from 'bignumber.js';
import {
  blockbookUtxo,
  utxo,
  blockbookBroadcastTxResult,
  broadcastTxResult,
  cryptos,
  publicPrivateNonce,
} from '../types';

import { backends } from '@storage/backends';
import { blockchains } from '@storage/blockchains';

export function getLibId(chain: keyof cryptos): string {
  return blockchains[chain].libid;
}

export async function fetchUtxos(
  address: string,
  chain: string,
  confirmationMode = 0, // use confirmed utxos if replace by fee is wanted. unconfirmed if standard tx, both for ssp key for fetching all utxps
  onlyConfirmed = true, // must have > 0 confirmations
): Promise<utxo[]> {
  try {
    const backendConfig = backends()[chain];
    if (blockchains[chain].backend === 'blockbook') {
      if (confirmationMode === 1) {
        const url = `https://${backendConfig.node}/api/v2/utxo/${address}?confirmed=true`;
        const { data } = await axios.get<blockbookUtxo[]>(url);
        const fetchedUtxos = data.filter((x) =>
          onlyConfirmed ? x.confirmations > 0 : true,
        );
        const utxos = fetchedUtxos.map((x) => ({
          txid: x.txid,
          vout: x.vout,
          scriptPubKey: '', // that is fine, not needed
          satoshis: x.value,
          confirmations: x.confirmations,
          coinbase: x.coinbase || false,
        }));
        return utxos;
      } else if (confirmationMode === 2) {
        const url = `https://${backendConfig.node}/api/v2/utxo/${address}?confirmed=true`;
        const urlB = `https://${backendConfig.node}/api/v2/utxo/${address}`;
        const { data } = await axios.get<blockbookUtxo[]>(url);
        const responseB = await axios.get<blockbookUtxo[]>(urlB);
        const dataB = responseB.data.filter((x) =>
          onlyConfirmed ? x.confirmations > 0 : true,
        );
        const fetchedUtxos = data
          .filter((x) => (onlyConfirmed ? x.confirmations > 0 : true))
          .concat(dataB);
        const utxos = fetchedUtxos.map((x) => ({
          txid: x.txid,
          vout: x.vout,
          scriptPubKey: '', // that is fine, not needed
          satoshis: x.value,
          confirmations: x.confirmations,
          coinbase: x.coinbase || false,
        }));
        return utxos;
      } else {
        const url = `https://${backendConfig.node}/api/v2/utxo/${address}`;
        const { data } = await axios.get<blockbookUtxo[]>(url);
        const fetchedUtxos = data.filter((x) =>
          onlyConfirmed ? x.confirmations > 0 : true,
        );
        const utxos = fetchedUtxos.map((x) => ({
          txid: x.txid,
          vout: x.vout,
          scriptPubKey: '', // that is fine, not needed
          satoshis: x.value,
          confirmations: x.confirmations,
          coinbase: x.coinbase || false,
        }));
        return utxos;
      }
    } else {
      if (confirmationMode === 1) {
        const url = `https://${backendConfig.node}/api/addrs/${address}/unspent`;
        const { data } = await axios.get<utxo[]>(url);
        const fetchedUtxos = data.filter((x) =>
          onlyConfirmed ? x.confirmations > 0 : true,
        );
        const utxos = fetchedUtxos.map((x) => ({
          txid: x.txid,
          vout: x.vout,
          scriptPubKey: x.scriptPubKey,
          satoshis: x.satoshis.toString(),
          confirmations: x.confirmations,
          coinbase: x.coinbase || false,
        }));
        return utxos;
      } else if (confirmationMode === 2) {
        const url = `https://${backendConfig.node}/api/addrs/${address}/unspent`;
        const urlB = `https://${backendConfig.node}/api/addrs/${address}/utxo`;
        const { data } = await axios.get<utxo[]>(url);
        const responseB = await axios.get<utxo[]>(urlB);
        const dataB = responseB.data.filter((x) =>
          onlyConfirmed ? x.confirmations > 0 : true,
        );
        const fetchedUtxos = data
          .filter((x) => (onlyConfirmed ? x.confirmations > 0 : true))
          .concat(dataB);
        const utxos = fetchedUtxos.map((x) => ({
          txid: x.txid,
          vout: x.vout,
          scriptPubKey: x.scriptPubKey,
          satoshis: x.satoshis.toString(),
          confirmations: x.confirmations,
          coinbase: x.coinbase || false,
        }));
        return utxos;
      } else {
        const url = `https://${backendConfig.node}/api/addrs/${address}/utxo`;
        const { data } = await axios.get<utxo[]>(url);
        const fetchedUtxos = data.filter((x) =>
          onlyConfirmed ? x.confirmations > 0 : true,
        );
        const utxos = fetchedUtxos.map((x) => ({
          txid: x.txid,
          vout: x.vout,
          scriptPubKey: x.scriptPubKey,
          satoshis: x.satoshis.toString(),
          confirmations: x.confirmations,
          coinbase: x.coinbase || false,
        }));
        return utxos;
      }
    }
  } catch (e) {
    console.log(e);
    return [];
  }
}

export function finaliseTransaction(
  rawTx: string,
  chain: keyof cryptos,
): string {
  try {
    const libID = getLibId(chain);
    const network = utxolib.networks[libID];
    const txhex = rawTx;
    const txb = utxolib.TransactionBuilder.fromTransaction(
      utxolib.Transaction.fromHex(txhex, network),
      network,
    );
    const tx = txb.build();
    const finalisedTx = tx.toHex();
    return finalisedTx;
  } catch (e) {
    console.log(e);
    throw e;
  }
}

function getValueHexBuffer(hex: string) {
  const buf = Buffer.from(hex, 'hex').reverse();
  return buf.toString('hex');
}

export function signTransaction(
  rawTx: string,
  chain: keyof cryptos,
  privateKey: string,
  redeemScript: string,
  witnessScript: string,
  utxos: utxo[], // same or bigger set than was used to construct the tx
): string {
  try {
    const libID = getLibId(chain);
    const network = utxolib.networks[libID];
    const txhex = rawTx;
    let hashType = utxolib.Transaction.SIGHASH_ALL;
    if (blockchains[chain].hashType) {
      // only for BCH
      hashType =
        // eslint-disable-next-line no-bitwise
        utxolib.Transaction.SIGHASH_ALL |
        utxolib.Transaction.SIGHASH_BITCOINCASHBIP143;
    }
    const keyPair = utxolib.ECPair.fromWIF(privateKey, network);
    const txb = utxolib.TransactionBuilder.fromTransaction(
      utxolib.Transaction.fromHex(txhex, network),
      network,
    );
    for (let i = 0; i < txb.inputs.length; i += 1) {
      const hashHex = txb.tx.ins[i].hash.toString('hex');
      const hash = getValueHexBuffer(hashHex);
      const { index } = txb.tx.ins[i];
      const utxoFound = utxos.find((x) => x.txid === hash && x.vout === index);
      if (!utxoFound) {
        throw new Error(`Could not find value for input ${hash}:${index}`);
      }
      let redeemScriptForSign;
      let witnessScriptForSign;
      if (redeemScript) {
        redeemScriptForSign = Buffer.from(redeemScript, 'hex');
      }
      if (witnessScript) {
        witnessScriptForSign = Buffer.from(witnessScript, 'hex');
      }
      txb.sign(
        i,
        keyPair,
        redeemScriptForSign,
        hashType,
        new BigNumber(utxoFound.satoshis).toNumber(),
        witnessScriptForSign,
      );
    }
    const tx = txb.buildIncomplete();
    const signedTx = tx.toHex();
    return signedTx;
  } catch (e) {
    console.log(e);
    throw e;
  }
}

export async function broadcastTx(
  txHex: string,
  chain: keyof cryptos,
): Promise<string> {
  try {
    const backendConfig = backends()[chain];
    if (blockchains[chain].backend === 'blockbook') {
      const url = `https://${backendConfig.node}/api/v2/sendtx/`; // NB: the '/' symbol at the end is mandatory.
      const response = await axios.post<blockbookBroadcastTxResult>(url, txHex);
      return response.data.result;
    } else {
      const url = `https://${backendConfig.node}/api/tx/send`;
      const response = await axios.post<broadcastTxResult>(url, {
        rawtx: txHex,
      });
      return response.data.txid;
    }
  } catch (error) {
    console.log(error);
    throw error;
  }
}

export function selectPublicNonce(
  rawTx: string,
  publicNonces: publicPrivateNonce[], // ssp Key
): publicPrivateNonce {
  const multisigUserOpJSON = JSON.parse(rawTx);
  const multiSigUserOp =
    accountAbstraction.userOperation.MultiSigUserOp.fromJson(
      multisigUserOpJSON,
    );

  // here restore public nonce
  const txPublicNonces = multiSigUserOp._getPublicNonces();
  if (!publicNonces || !publicNonces.length) {
    throw new Error('SSP Key Public nonces are missing');
  }
  let nonceToUse;
  for (let i = 0; i < txPublicNonces.length; i += 1) {
    const nonceExists = publicNonces.find(
      (n) =>
        txPublicNonces[i].kPublic.buffer.toString('hex') === n.kPublic &&
        txPublicNonces[i].kTwoPublic.buffer.toString('hex') === n.kTwoPublic,
    );
    if (nonceExists) {
      nonceToUse = nonceExists;
      break;
    }
  }

  if (!nonceToUse) {
    throw new Error('SSP Key Public nonces do not match');
  }
  return nonceToUse;
}

// return txhash
export async function signAndBroadcastEVM(
  rawTx: string,
  chain: keyof cryptos,
  privateKey: `0x${string}`, // ssp
  publicNonceKey: publicPrivateNonce, // ssp Key
): Promise<string> {
  try {
    const blockchainConfig = blockchains[chain];
    const backendConfig = backends()[chain];
    const accountSalt = blockchainConfig.accountSalt;
    const schnorrSigner2 =
      accountAbstraction.helpers.SchnorrHelpers.createSchnorrSigner(privateKey);

    const multisigUserOpJSON = JSON.parse(rawTx);
    const multiSigUserOp =
      accountAbstraction.userOperation.MultiSigUserOp.fromJson(
        multisigUserOpJSON,
      );

    const kPrivate = new accountAbstraction.types.Key(
      Buffer.from(publicNonceKey.k, 'hex'),
    );
    const kTwoPrivate = new accountAbstraction.types.Key(
      Buffer.from(publicNonceKey.kTwo, 'hex'),
    );

    schnorrSigner2.restorePubNonces(kPrivate, kTwoPrivate);

    multiSigUserOp.signMultiSigHash(schnorrSigner2); // this is not part of ssp wallet

    const summedSignature = multiSigUserOp.getSummedSigData();

    const rpcUrl = backendConfig.node;

    const transport = viemHttp(`https://${rpcUrl}`);
    const CHAIN = viemChains[blockchainConfig.libid as keyof typeof viemChains];

    const publicKeys = multiSigUserOp._getPublicKeys();
    const combinedAddresses =
      accountAbstraction.helpers.SchnorrHelpers.getAllCombinedAddrFromKeys(
        publicKeys,
        publicKeys.length,
      );

    const multiSigSmartAccount =
      await accountAbstraction.accountAbstraction.createMultiSigSmartAccount({
        // @ts-ignore
        transport,
        // @ts-ignore
        chain: CHAIN,
        combinedAddress: combinedAddresses,
        salt: accountAbstraction.helpers.create2Helpers.saltToHex(accountSalt),
        // @ts-ignore
        entryPoint: getEntryPoint(CHAIN),
      });

    const smartAccountClient = createSmartAccountClient({
      // @ts-ignore
      transport,
      // @ts-ignore
      chain: CHAIN,
      // @ts-ignore
      account: multiSigSmartAccount,
    });

    const uoHash = await smartAccountClient.sendRawUserOperation(
      {
        ...multisigUserOpJSON.userOpRequest,
        signature: summedSignature,
      },
      multiSigSmartAccount.getEntryPoint().address,
    );

    console.log(uoHash); // this is user operation hash, means it was succesfully sent but not yet included in transaction. All went well, not tx hash

    const txHash = await smartAccountClient
      .waitForUserOperationTransaction({
        hash: uoHash,
      })
      .catch((e) => {
        console.log(e);
      });
    return txHash ?? uoHash;
  } catch (error) {
    console.log(error);
    throw error;
  }
}
