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
import {
  TRON_SELF_PAY_FEE_LIMIT_SUN,
  TRON_SELF_PAY_MIN_BALANCE_SUN,
  TRX_DECIMALS,
  TronHttpClient,
  fetchTronBalance,
  formatTronUnits,
  tronApprovedSummaryMismatch,
  tronHttpClient,
  tronNowSeconds,
  tronSdk,
  tronSignerFromPrivHex,
  verifyTronConsumerRequest,
  type TronApprovedSummary,
  type TronConsumerVerified,
  type TronLocalSigner,
  type TronNetworkConfig,
} from './tron';

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

// ============================================================================
// TRON
// ============================================================================

/**
 * The relay sponsor refused the operation (error envelope with name
 * `TronSponsorRefusal`, code '400'): it validated and declined BEFORE
 * broadcasting. The caller shows the relay's message and posts `txrejected`.
 */
export class TronRelayRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TronRelayRefusedError';
  }
}

/**
 * The broadcast ended without a definite refusal (network failure, timeout,
 * unreadable reply, or a relay error other than `TronSponsorRefusal` — e.g.
 * "broadcast outcome unknown" after the relayer sent it): the operation MAY
 * be on its way. Re-submitting the same signed Op is safe (the relay dedupes
 * by digest and returns the existing txid; the vault burns the nonce once),
 * so the request stays on screen instead of being rejected.
 */
export class TronBroadcastUnknownError extends Error {
  /** The relay's own message, when it sent one. */
  readonly relayMessage: string;
  constructor(message: string, relayMessage = '') {
    super(message);
    this.name = 'TronBroadcastUnknownError';
    this.relayMessage = relayMessage;
  }
}

/** The relay's name for a validated refusal (ssp-relay tronSponsorService). */
export const TRON_SPONSOR_REFUSAL = 'TronSponsorRefusal';

/** The key's own TRON account cannot pay a self-submitted operation. */
export class TronSelfPayBalanceError extends Error {
  readonly address: string;
  constructor(address: string, balance: bigint) {
    super(
      `SSP Key TRON account ${address} holds ${formatTronUnits(balance, TRX_DECIMALS)} TRX; at least ${formatTronUnits(TRON_SELF_PAY_MIN_BALANCE_SUN, TRX_DECIMALS)} TRX is needed to pay the network fee`,
    );
    this.name = 'TronSelfPayBalanceError';
    this.address = address;
  }
}

/** The relay's `POST /v1/tron/broadcast` body (TRON_WIRING_BRIEF.md). */
export interface TronBroadcastBody {
  chain: string;
  signers: string[];
  threshold: number;
  op: ReturnType<typeof tronSdk.opToJson>;
  /** 65-byte `0x` hex each, [wallet, key] (any order is accepted). */
  signatures: string[];
}

const TRON_BROADCAST_TIMEOUT_MS = 120000;
const TXID_RE = /^[0-9a-fA-F]{64}$/;

export async function postTronBroadcast(
  relayHost: string,
  body: TronBroadcastBody,
  fetchImpl: typeof fetch = (url, init) => fetch(url, init),
  timeoutMs: number = TRON_BROADCAST_TIMEOUT_MS,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetchImpl(`https://${relayHost}/v1/tron/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    throw new TronBroadcastUnknownError(
      `TRON broadcast did not complete: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  type RelayReply = {
    status?: string;
    data?: { txid?: unknown; message?: unknown; name?: unknown };
  };
  let json: RelayReply | null;
  try {
    json = (await resp.json()) as RelayReply | null;
  } catch {
    json = null;
  }
  if (json && json.status === 'error') {
    const message =
      typeof json.data?.message === 'string' && json.data.message
        ? json.data.message
        : 'TRON broadcast refused';
    if (json.data?.name === TRON_SPONSOR_REFUSAL) {
      throw new TronRelayRefusedError(message);
    }
    // Any other relay error may have happened after the relayer sent the
    // transaction: never reported as a rejection.
    throw new TronBroadcastUnknownError(
      `TRON broadcast did not complete: ${message}`,
      message,
    );
  }
  if (!resp.ok) {
    throw new TronBroadcastUnknownError(
      `TRON broadcast failed: HTTP ${resp.status}`,
    );
  }
  const txid = json?.status === 'success' ? json.data?.txid : undefined;
  if (typeof txid !== 'string' || !TXID_RE.test(txid)) {
    throw new TronBroadcastUnknownError('TRON broadcast reply has no txid');
  }
  return txid.toLowerCase();
}

/**
 * Strictly re-decode a transaction this device built for a self-submitted
 * operation and require it to be EXACTLY one of the two allowed shapes
 * (contract §5 rule 7): a TriggerSmartContract from our own leaf account to
 * `factory.deploy(configHash)` or to `vault.execute(<this op>)`, no TRX / TRC-10
 * attached, fee_limit within the cap. Returns the decoded raw transaction —
 * the only thing that is ever signed.
 */
export function assertTronSelfPayTransaction(
  raw: tronSdk.RawTransaction,
  expected:
    | {
        kind: 'deploy';
        owner: string;
        factory: string;
        configHash: Uint8Array;
      }
    | {
        kind: 'execute';
        owner: string;
        vault: string;
        config: tronSdk.VaultConfig;
        digest: Uint8Array;
        chainId: bigint;
      },
): tronSdk.RawTransaction {
  const decoded = tronSdk.decodeRawTransactionHex(
    tronSdk.encodeRawTransaction(raw),
  ).raw;
  if (decoded.contract.type !== 'TriggerSmartContract') {
    throw new Error('Refusing to sign: not a TriggerSmartContract');
  }
  const p = decoded.contract.parameter;
  if (
    p.ownerAddress !== expected.owner ||
    tronSdk.transactionOwner(decoded) !== expected.owner ||
    p.callValue !== 0n ||
    p.callTokenValue !== 0n ||
    p.tokenId !== 0n ||
    decoded.feeLimit <= 0n ||
    decoded.feeLimit > TRON_SELF_PAY_FEE_LIMIT_SUN
  ) {
    throw new Error('Refusing to sign: unexpected TRON transaction fields');
  }
  if (expected.kind === 'deploy') {
    if (
      p.contractAddress !== expected.factory ||
      !tronSdk.equalBytes(p.data, tronSdk.encodeDeploy(expected.configHash))
    ) {
      throw new Error('Refusing to sign: not the vault deployment');
    }
    return decoded;
  }
  const args = tronSdk.decodeExecuteTransaction(decoded);
  if (
    p.contractAddress !== expected.vault ||
    args === null ||
    args.threshold !== expected.config.threshold ||
    !tronSdk.equalBytes(
      args.signersPacked,
      tronSdk.packSigners(expected.config.signers),
    ) ||
    !tronSdk.equalBytes(
      tronSdk.opDigest(expected.chainId, expected.vault, args.op),
      expected.digest,
    )
  ) {
    throw new Error('Refusing to sign: not this vault operation');
  }
  return decoded;
}

async function signSubmitAndWait(
  client: TronHttpClient,
  raw: tronSdk.RawTransaction,
  signer: TronLocalSigner,
  sleep: (ms: number) => Promise<void>,
): Promise<{ txid: string; result: string }> {
  const signed = await tronSdk.signTransaction(raw, signer);
  const hex = tronSdk.serializeTransaction(signed);
  // Final self-check on the exact bytes that leave the device.
  const check = tronSdk.decodeTransaction(hex);
  if (check.txid !== tronSdk.txidHex(raw)) {
    throw new Error('Refusing to broadcast: serialized transaction differs');
  }
  const { txid } = await client.broadcastHex(hex);
  const info = await client.waitForTransaction(txid, {
    sleep,
    intervalMs: 3000,
    attempts: 40,
  });
  return { txid, result: info.result };
}

/**
 * Self-pay (fee.amount == 0): this device submits the fully signed Op from
 * its OWN leaf account and pays the energy itself — deploying the vault first
 * when it has no code. Only the two transaction shapes of
 * assertTronSelfPayTransaction are ever signed; the execute is simulated
 * first and never broadcast when it would revert.
 */
export async function selfSubmitTronOp(opts: {
  verified: TronConsumerVerified;
  walletSignature: Uint8Array;
  keySignature: Uint8Array;
  signer: TronLocalSigner;
  client: TronHttpClient;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => bigint;
}): Promise<string> {
  const { verified, signer, client } = opts;
  const sleep =
    opts.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nowMs = opts.nowMs ?? (() => BigInt(Date.now()));
  const { factory } = tronSdk.requireDeployment(verified.network);
  const owner = signer.address;
  if (owner !== verified.keySigner) {
    throw new Error('SSP Key TRON account does not match its vault leaf');
  }
  const balance = await fetchTronBalance(client, owner);
  if (balance < TRON_SELF_PAY_MIN_BALANCE_SUN) {
    throw new TronSelfPayBalanceError(owner, balance);
  }
  const vault = verified.vault.address;
  const signaturesPacked = tronSdk.assembleSignatures(
    verified.digest,
    verified.config,
    [opts.walletSignature, opts.keySignature],
  );

  if (!(await client.hasCode(vault))) {
    const block = await client.getNowBlock();
    const timestamp = nowMs();
    const deployRaw = assertTronSelfPayTransaction(
      tronSdk.buildDeployTransaction({
        owner,
        factory,
        configHash: verified.vault.configHash,
        feeLimit: TRON_SELF_PAY_FEE_LIMIT_SUN,
        ref: block.ref,
        timestamp,
        expiration: timestamp + tronSdk.DEFAULT_EXPIRATION_MS,
      }),
      {
        kind: 'deploy',
        owner,
        factory,
        configHash: verified.vault.configHash,
      },
    );
    const deployed = await signSubmitAndWait(client, deployRaw, signer, sleep);
    if (deployed.result !== 'SUCCESS') {
      throw new Error(
        `TRON vault deployment ${deployed.txid} failed: ${deployed.result}`,
      );
    }
  }

  const calldata = tronSdk.encodeExecute({
    signersPacked: tronSdk.packSigners(verified.config.signers),
    threshold: verified.config.threshold,
    op: verified.payload.op,
    signaturesPacked,
  });
  const simulation = await client.triggerConstant({
    owner,
    contract: vault,
    data: calldata,
  });
  if (!simulation.ok) {
    throw new Error(
      `TRON operation would fail: ${simulation.message ?? JSON.stringify(simulation.revert)}`,
    );
  }
  const block = await client.getNowBlock();
  const timestamp = nowMs();
  const executeRaw = assertTronSelfPayTransaction(
    tronSdk.buildExecuteTransaction({
      owner,
      target: vault,
      config: verified.config,
      op: verified.payload.op,
      signaturesPacked,
      feeLimit: TRON_SELF_PAY_FEE_LIMIT_SUN,
      ref: block.ref,
      timestamp,
      expiration: timestamp + tronSdk.DEFAULT_EXPIRATION_MS,
    }),
    {
      kind: 'execute',
      owner,
      vault,
      config: verified.config,
      digest: verified.digest,
      chainId: verified.network.chainId,
    },
  );
  const executed = await signSubmitAndWait(client, executeRaw, signer, sleep);
  if (executed.result !== 'SUCCESS') {
    throw new Error(
      `TRON operation ${executed.txid} failed on-chain: ${executed.result}`,
    );
  }
  return executed.txid;
}

/**
 * Consumer 2-of-2 co-sign + submit on the Key device (TRON_SSP_CONTRACT.md
 * §6). The wallet built and signed the Op and shipped the `ssp-tron-op`
 * payload. This device:
 *  1. re-runs the full §5 verification from scratch (own-derived vault,
 *     consumer policy, pinned collector + ceilings, deadline, recomputed
 *     digest, wallet signature) and requires the digest the approval screen
 *     displayed (`approved`);
 *  2. signs the digest with its leaf (m/48'/195'/0'/0'/0/i) — the signer is
 *     destroyed on every path;
 *  3. sponsored (fee > 0): POST /v1/tron/broadcast {chain, signers,
 *     threshold, op, signatures:[wallet, key]} → txid;
 *     self-pay (fee == 0): submits from its own leaf account.
 */
export async function cosignAndBroadcastTRON(opts: {
  chain: keyof cryptos;
  rawTx: string;
  approved: TronApprovedSummary;
  xpubWallet: string;
  xpubKey: string;
  path: string;
  keyPrivKeyHex: string;
  network: TronNetworkConfig;
  relayHost: string;
  now?: bigint;
  fetchImpl?: typeof fetch;
  client?: TronHttpClient;
  sleep?: (ms: number) => Promise<void>;
  nowMs?: () => bigint;
}): Promise<string> {
  const verified = verifyTronConsumerRequest(opts.rawTx, opts.chain, {
    xpubWallet: opts.xpubWallet,
    xpubKey: opts.xpubKey,
    path: opts.path,
    network: opts.network,
    now: opts.now ?? tronNowSeconds(),
  });
  const mismatch = tronApprovedSummaryMismatch(opts.approved, verified);
  if (mismatch) {
    throw new Error(
      `TRON operation changed since it was displayed (${mismatch}); review it again`,
    );
  }
  const signer = tronSignerFromPrivHex(opts.keyPrivKeyHex);
  try {
    if (
      signer.address !== verified.keySigner ||
      !verified.config.signers.includes(signer.address)
    ) {
      throw new Error('SSP Key does not belong to this TRON vault');
    }
    const keySignature = signer.signDigest(verified.digest);
    if (verified.payload.op.fee.amount > 0n) {
      return await postTronBroadcast(
        opts.relayHost,
        {
          chain: opts.chain,
          signers: [...verified.config.signers],
          threshold: verified.config.threshold,
          op: tronSdk.opToJson(verified.payload.op),
          signatures: [
            tronSdk.to0x(verified.payload.walletSignature),
            tronSdk.to0x(keySignature),
          ],
        },
        opts.fetchImpl,
      );
    }
    return await selfSubmitTronOp({
      verified,
      walletSignature: verified.payload.walletSignature,
      keySignature,
      signer,
      client: opts.client ?? tronHttpClient(opts.chain),
      sleep: opts.sleep,
      nowMs: opts.nowMs,
    });
  } finally {
    signer.destroy();
  }
}
