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
import type { KaspaRestClient } from '@runonflux/kaspa-core/rest';
import {
  KAS_MAX_FEE_SOMPI,
  assertNoKasBlockingWarnings,
  describeKasOpened,
  fetchKasUtxos,
  kasApprovedSummary,
  kasApprovedSummaryMismatch,
  kasRestClient,
  kasSpendAddress,
  kaspaCore,
  openKasBundle,
  type KasApprovedSummary,
  type KasSpend,
} from './kaspa';
import type { KasLedger } from './kaspaLedger';

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
export async function cosignAndBroadcastSOLTransaction(opts: {
  chain: keyof cryptos;
  serializedTxBase64: string;
  keyPubkeyBase58: string;
  keyPrivKeyHex: string;
  relayHost: string;
}): Promise<string> {
  const { Transaction, Keypair } = await import('@solana/web3.js');

  const keySecretKey = new Uint8Array(Buffer.from(opts.keyPrivKeyHex, 'hex'));
  let serializedTxBase64: string;
  try {
    const keyKeypair = Keypair.fromSecretKey(keySecretKey);
    if (keyKeypair.publicKey.toBase58() !== opts.keyPubkeyBase58) {
      throw new Error('Key privkey/pubkey mismatch');
    }

    const tx = Transaction.from(Buffer.from(opts.serializedTxBase64, 'base64'));
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
  const url = `https://${opts.relayHost}/v1/sol/broadcast`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chain: opts.chain, serializedTxBase64 }),
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

// ============================================================================
// Kaspa
// ============================================================================

/**
 * The submission ended without a definite answer and every identical
 * re-submission did too: the transaction MAY be on the network. Callers must
 * tell the user to check the explorer — never rebuild from other UTXOs
 * (KASPA_SSP_CONTRACT.md §4.6).
 */
export class KasMaybeBroadcastError extends Error {
  readonly txid: string;
  constructor(txid: string) {
    super(`Kaspa transaction ${txid} may have been broadcast`);
    this.name = 'KasMaybeBroadcastError';
    this.txid = txid;
  }
}

const KAS_SUBMIT_ATTEMPTS = 3;

/**
 * A node answer meaning "I already have exactly this transaction" (rusty-kaspa
 * mempool RuleError::RejectDuplicate "... is already in the mempool" and
 * "... was already accepted by the consensus"). Deliberately NOT "already
 * spent", which is a double-spend rejection.
 */
const KAS_ALREADY_KNOWN_RE =
  /already in (the )?mempool|already accepted|already exists in the mempool/i;

/**
 * Submit a finalised Kaspa transaction. A `SubmitOutcomeUnknownError`
 * (timeout / lost connection after sending) is retried with the IDENTICAL
 * transaction — same ID, idempotent on the node. A node that answers it
 * already has this transaction is success on ANY attempt (including the
 * first: e.g. SSP Wallet or an earlier attempt already relayed it).
 */
export async function submitKasTransaction(
  rest: KaspaRestClient,
  signed: kaspaCore.Transaction,
): Promise<string> {
  const txid = kaspaCore.bytesToHex(kaspaCore.transactionId(signed));
  let unknown = false;
  for (let attempt = 0; attempt < KAS_SUBMIT_ATTEMPTS; attempt += 1) {
    try {
      return await rest.submit(signed);
    } catch (error) {
      if (error instanceof kaspaCore.SubmitOutcomeUnknownError) {
        unknown = true;
        continue;
      }
      if (
        error instanceof kaspaCore.RestError &&
        KAS_ALREADY_KNOWN_RE.test(error.message)
      ) {
        return txid;
      }
      if (unknown) {
        // A definite rejection after an unknown outcome still cannot prove
        // the first submission did not land.
        throw new KasMaybeBroadcastError(txid);
      }
      throw error;
    }
  }
  throw new KasMaybeBroadcastError(txid);
}

/**
 * Consumer 2-of-2 co-sign + broadcast on the Key device (contract §5).
 *
 * The wallet planned the send, signed its half and shipped the bundle JSON
 * as the `tx` payload. This device:
 *  1. looks up the vault's UTXOs ITSELF (never the relay's `utxos` or the
 *     amounts the bundle claims) and opens the bundle against them, under
 *     `maxFee` (contract §4.9: min($100-equivalent, 5 KAS));
 *  2. re-describes it and requires it to be exactly what the approval screen
 *     showed (`approved`: txid, fee, every external output) with no blocking
 *     warning — a lookup that changed since display, or a swapped payload, is
 *     refused rather than signed unseen;
 *  3. signs only inputs of this vault's script, through the signed-amount
 *     ledger, and FLUSHES the ledger before anything leaves the device;
 *  4. finalises with its own partials first, submits over REST and returns
 *     the transaction ID. The signer is destroyed on every path.
 */
export async function cosignAndBroadcastKASTransaction(opts: {
  chain: keyof cryptos;
  bundleJson: string;
  vaultSpend: KasSpend;
  keyPrivKeyHex: string;
  ledger: KasLedger;
  /** What the approval screen displayed — required. */
  approved: KasApprovedSummary;
  maxFee?: bigint;
  rest?: KaspaRestClient;
}): Promise<string> {
  const rest = opts.rest ?? kasRestClient(opts.chain);
  const maxFee = opts.maxFee ?? KAS_MAX_FEE_SOMPI;
  const vaultScript = kaspaCore.spendScriptPublicKey(opts.vaultSpend);
  const { address } = kasSpendAddress(opts.vaultSpend, opts.chain);
  const trusted = await fetchKasUtxos([address], opts.chain, rest);
  const opened = openKasBundle(opts.bundleJson, trusted, maxFee);
  const description = describeKasOpened(opened, opts.chain, [vaultScript]);
  assertNoKasBlockingWarnings(description);
  const mismatch = kasApprovedSummaryMismatch(
    opts.approved,
    kasApprovedSummary(description),
  );
  if (mismatch) {
    throw new Error(
      `Kaspa transaction changed since it was displayed (${mismatch}); review it again`,
    );
  }

  const key = kaspaCore.hexToBytes(opts.keyPrivKeyHex);
  const signer = kaspaCore.localSigner(key);
  key.fill(0);
  try {
    if (
      !kaspaCore
        .spendSigningKeys(opts.vaultSpend)
        .some((k) => kaspaCore.equalBytes(k, signer.xOnlyPublicKey))
    ) {
      throw new Error('SSP Key does not belong to this Kaspa vault');
    }
    const keyPartials = await kaspaCore.signTransaction(
      opened.tx,
      opened.inputs,
      [signer],
      { onlyScripts: [vaultScript], signedAmounts: opts.ledger, maxFee },
    );
    if (keyPartials.length === 0) {
      throw new Error('SSP Key did not sign any Kaspa input');
    }
    // Persist the ledger BEFORE the signatures can leave this device.
    opts.ledger.flush();
    const signed = kaspaCore.finalizeTransaction(
      opened.tx,
      opened.inputs,
      // local first: a remote duplicate can never displace our signature
      kaspaCore.mergePartialSignatures(keyPartials, opened.partials),
    );
    return await submitKasTransaction(rest, signed);
  } finally {
    signer.destroy();
  }
}
