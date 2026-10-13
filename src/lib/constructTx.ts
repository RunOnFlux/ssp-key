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
import { getLibId } from './wallet';
import {
  inspectConsumerUtxoTransaction,
  verifyWalletPartialSignatures,
} from './consumerUtxo';
import type { VerifiedConsumerUtxoTx } from './consumerUtxo';
import { decodeConsumerSolanaTransaction } from './consumerSolana';
import type {
  ConsumerSolanaLeaves,
  ConsumerSolanaPayload,
} from './consumerSolana';
import type { VerifiedConsumerEvmRequest } from './consumerEvm';

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
        const confirmedUtxos = data.filter((x) =>
          onlyConfirmed ? x.confirmations > 0 : true,
        );
        // Deduplicate: dataB may contain the same confirmed UTXOs
        const confirmedSet = new Set(
          confirmedUtxos.map((x) => `${x.txid}:${x.vout}`),
        );
        const unconfirmedOnly = dataB.filter(
          (x) => !confirmedSet.has(`${x.txid}:${x.vout}`),
        );
        const fetchedUtxos = confirmedUtxos.concat(unconfirmedOnly);
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
        const confirmedUtxos = data.filter((x) =>
          onlyConfirmed ? x.confirmations > 0 : true,
        );
        // Deduplicate: dataB may contain the same confirmed UTXOs
        const confirmedSet = new Set(
          confirmedUtxos.map((x) => `${x.txid}:${x.vout}`),
        );
        const unconfirmedOnly = dataB.filter(
          (x) => !confirmedSet.has(`${x.txid}:${x.vout}`),
        );
        const fetchedUtxos = confirmedUtxos.concat(unconfirmedOnly);
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

/**
 * Raw hex of a previous transaction from the key's own backend. Used to read
 * input values locally (UTXO-5) — the caller verifies the bytes against the
 * txid, so this function only transports.
 */
export async function fetchRawTransactionHex(
  txid: string,
  chain: keyof cryptos,
): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(txid)) {
    throw new Error('Invalid txid');
  }
  const backendConfig = backends()[chain];
  if (blockchains[chain].backend === 'blockbook') {
    const url = `https://${backendConfig.node}/api/v2/tx/${txid}`;
    const { data } = await axios.get<{ hex?: string }>(url, {
      timeout: 15000,
    });
    if (!data || typeof data.hex !== 'string') {
      throw new Error(`Previous transaction ${txid} unavailable`);
    }
    return data.hex;
  }
  const url = `https://${backendConfig.node}/api/rawtx/${txid}`;
  const { data } = await axios.get<{ rawtx?: string }>(url, {
    timeout: 15000,
  });
  if (!data || typeof data.rawtx !== 'string') {
    throw new Error(`Previous transaction ${txid} unavailable`);
  }
  return data.rawtx;
}

/**
 * Co-sign a consumer 2-of-2 UTXO transaction.
 *
 * `verified` must come from `verifyConsumerUtxoTransaction` on the same raw
 * transaction: it carries the key's OWN derived 2-of-2 scripts and the
 * key-verified input values. Signing re-checks that every input still spends
 * from exactly that script (utxo-lib only enforces redeemScript consistency
 * and skips the caller's witnessScript once an input is expanded, so the
 * equality is checked here) and verifies the wallet's partial signature on
 * every input before adding the key's own.
 */
export function signTransaction(
  rawTx: string,
  chain: keyof cryptos,
  privateKey: string,
  verified: VerifiedConsumerUtxoTx,
): string {
  try {
    const libID = getLibId(chain);
    const network = utxolib.networks[libID];
    let hashType = utxolib.Transaction.SIGHASH_ALL;
    if (blockchains[chain].hashType) {
      // only for BCH
      hashType =
        utxolib.Transaction.SIGHASH_ALL |
        utxolib.Transaction.SIGHASH_BITCOINCASHBIP143;
    }
    const { scripts } = verified;
    const { txb, inputs } = inspectConsumerUtxoTransaction(
      rawTx,
      chain,
      scripts,
    );
    if (inputs.length !== verified.inputs.length) {
      throw new Error('Transaction inputs changed after verification');
    }
    const values = inputs.map((input, i) => {
      const known = verified.inputs[i];
      if (known.txid !== input.txid || known.vout !== input.vout) {
        throw new Error('Transaction inputs changed after verification');
      }
      return new BigNumber(known.satoshis).toNumber();
    });
    verifyWalletPartialSignatures(txb, chain, scripts, values);
    const keyPair = utxolib.ECPair.fromWIF(privateKey, network) as {
      sign: (hash: Buffer) => Buffer;
      getPublicKeyBuffer: () => Buffer;
    };
    if (!keyPair.getPublicKeyBuffer().equals(scripts.keyPubKey)) {
      throw new Error('Signing key does not belong to this address');
    }
    for (let i = 0; i < txb.inputs.length; i += 1) {
      txb.sign(
        i,
        keyPair,
        scripts.redeemScript,
        hashType,
        values[i],
        scripts.witnessScript,
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
  expected: VerifiedConsumerEvmRequest, // from verifyConsumerEvmRequest
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

    // EVM-8 / K5: sign only the hash the key recomputed from the displayed
    // operation, with the signer set derived from the stored xpubs.
    if (
      typeof multiSigUserOp.opHash !== 'string' ||
      multiSigUserOp.opHash.toLowerCase() !== expected.opHash.toLowerCase()
    ) {
      throw new Error('Operation hash does not match the verified operation');
    }
    const ownPubKey = schnorrSigner2.getPubKey().buffer.toString('hex');
    const signerKeys = multiSigUserOp
      ._getPublicKeys()
      .map((k: { buffer: Buffer }) => k.buffer.toString('hex').toLowerCase())
      .sort();
    const expectedKeys = [
      expected.walletPubKey.toLowerCase(),
      expected.keyPubKey.toLowerCase(),
    ].sort();
    if (
      ownPubKey.toLowerCase() !== expected.keyPubKey.toLowerCase() ||
      signerKeys.length !== 2 ||
      signerKeys[0] !== expectedKeys[0] ||
      signerKeys[1] !== expectedKeys[1]
    ) {
      throw new Error('Operation signer keys are not this wallet and key');
    }

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
        transport,
        chain: CHAIN,
        combinedAddress: combinedAddresses,
        salt: accountAbstraction.helpers.create2Helpers.saltToHex(accountSalt),
        entryPoint: getEntryPoint(CHAIN),
      });

    const smartAccountClient = createSmartAccountClient({
      transport,
      chain: CHAIN,
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
    // @ts-expect-error 'error' is of type 'unknown'
    if (error.message && error.message.includes('Details: ')) {
      // @ts-expect-error 'error' is of type 'unknown'
      const splitted = error.message.split('Details: ');
      const lastDetail = splitted[splitted.length - 1] as string | undefined;
      // throw just this last detail
      throw new Error(lastDetail);
    }
    throw error;
  }
}

// ============================================================================
// Solana
// ============================================================================

/**
 * UTXO/EVM-style Solana co-sign + broadcast on the Key device.
 *
 * Wallet partial-signs the outer tx with its leaf and posts the serialized
 * tx as a bare base64 string in the standard `tx` action. Key adds its own
 * leaf signature and broadcasts via the relay's paymaster endpoint,
 * mirroring how UTXO/EVM `tx` actions are handled.
 *
 * Same flow for first / subsequent sends — when the multisig PDA isn't
 * initialized yet, wallet's tx contains a leading permissionless
 * `initialize_multisig` ix (no member sigs required), and Key never has
 * to know the difference.
 *
 * Returns the broadcast signature (used as txid for the existing TxSent UI).
 */
/**
 * The relay request could not be authenticated as this wallet's WK identity
 * (no identity, no auth builder, or the builder returned nothing). Relay
 * POST /v1/sol/* requires WK auth (RA-2): nothing is posted unsigned.
 */
export class RelayAuthUnavailableError extends Error {
  constructor() {
    super('Relay authentication unavailable');
    this.name = 'RelayAuthUnavailableError';
  }
}

export async function cosignAndBroadcastSOLTransaction(opts: {
  chain: keyof cryptos;
  /** Unwrapped consumer request (bytes + wallet-supplied token hints). */
  payload: ConsumerSolanaPayload;
  /** Wallet + key leaves for the request path, from stored pubkey lists. */
  leaves: ConsumerSolanaLeaves;
  keyPrivKeyHex: string;
  relayHost: string;
  /** Native USD rate for the fee cap; 0/undefined = hard cap only. */
  usdRate?: number;
  /** RA-2: wkIdentity the broadcast is authenticated as. */
  wkIdentity?: string;
  /** RA-2: builds wkIdentity auth fields over the request body. */
  createAuth?: (
    body: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
}): Promise<string> {
  const { Transaction, Keypair } = await import('@solana/web3.js');

  // C-3 / CHN-1: re-run the approval screen's fail-closed decode on the
  // exact bytes about to be signed, so what is signed is what was shown.
  await decodeConsumerSolanaTransaction(
    opts.chain,
    opts.payload,
    opts.leaves,
    opts.usdRate,
  );

  // RA-2: POST /v1/sol/broadcast must carry WK auth. Without a way to build
  // it, do not even sign — fail closed, nothing is posted unsigned.
  const { wkIdentity, createAuth } = opts;
  if (!wkIdentity || !createAuth) {
    throw new RelayAuthUnavailableError();
  }

  const keySecretKey = new Uint8Array(Buffer.from(opts.keyPrivKeyHex, 'hex'));
  let serializedTxBase64: string;
  try {
    const keyKeypair = Keypair.fromSecretKey(keySecretKey);
    if (keyKeypair.publicKey.toBase58() !== opts.leaves.keyLeaf) {
      throw new Error('Key privkey/pubkey mismatch');
    }

    const tx = Transaction.from(
      Buffer.from(opts.payload.serializedTxBase64, 'base64'),
    );
    tx.partialSign(keyKeypair);

    serializedTxBase64 = tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64');
  } finally {
    // Zero the raw 64-byte ed25519 secret-key buffer once we're done signing
    // (including error paths). Mirrors the wallet-side wipe in
    // ssp-wallet/src/lib/constructTx.ts — JS GC doesn't promise prompt
    // zeroing, so an explicit wipe defends against heap inspection.
    keySecretKey.fill(0);
  }
  const body: Record<string, unknown> = {
    chain: opts.chain,
    serializedTxBase64,
    wkIdentity,
  };
  // Same convention as POST /v1/action ('action' auth): it binds a hash of
  // {chain, serializedTxBase64, wkIdentity} and is merged next to them.
  // No auth → no post (fail closed).
  const auth = await createAuth({ ...body }).catch(() => null);
  if (!auth) {
    throw new RelayAuthUnavailableError();
  }
  Object.assign(body, auth);
  const url = `https://${opts.relayHost}/v1/sol/broadcast`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Relay broadcast failed: ${resp.status}`);
  }
  const json = (await resp.json()) as {
    status?: string;
    data?: { signature?: string; message?: string };
  };
  if (json.status !== 'success' || !json.data?.signature) {
    throw new Error(
      `Relay broadcast error: ${json.data?.message ?? 'unknown'}`,
    );
  }
  return json.data.signature;
}
