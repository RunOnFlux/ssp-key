/**
 * Consumer 2-of-2 UTXO verification (C-2 / UTXO-1, H-2 / UTXO-4, UTXO-5,
 * UTXO-8, KAS-4 UTXO part).
 *
 * The key never trusts the wallet-built transaction to say whose coins it
 * spends or how much they are worth:
 *
 *  - It derives its OWN 2-of-2 script for the request path from the stored
 *    wallet xpub and its own xpub, and requires EVERY input's embedded
 *    redeemScript / witnessScript to equal it. The sender and the "change"
 *    output are derived from that script only, never from input 0.
 *  - Input values come from the key's own backend lookup of the transaction's
 *    actual inputs, never from the request. On chains whose sighash does not
 *    commit to input amounts (legacy P2SH: DOGE, RVN) each previous
 *    transaction is fetched, hashed and checked against its txid, and the
 *    value is read from it locally (each distinct previous transaction once,
 *    at most PREVOUT_FETCH_CONCURRENCY at a time).
 *  - The fee (inputs - outputs) is always computed, must be non-negative and
 *    is capped. The same values are used to sign and to verify the wallet's
 *    partial signatures; an honest wallet signs the true amounts, so a lying
 *    backend is refused there.
 *  - Values that passed a full verification are remembered per outpoint (and
 *    derived script) for the life of the process: the signing pass reuses the
 *    display pass's values (no second round of fetches), and a later request
 *    for the same outpoint cannot be valued differently.
 *
 * Residual on amount-committing chains (BTC/LTC/BCH/ZEC/FLUX), where values
 * come from the key's own UTXO lookup and are not hash-checked: a wallet AND
 * the key's backend that are both compromised could get the same transaction
 * approved twice with a different input under-valued each time (BIP143 /
 * FORKID / ZIP-243 sighashes commit only to the signed input's own amount)
 * and combine the valid half of each, so the real fee exceeds the one shown.
 * The outpoint cache defeats this within one app session; across an app
 * restart it remains (both approvals still show a fee under the cap).
 * Hash-checking these prevouts was not adopted: utxo-lib cannot compute
 * Zcash v5 (ZIP-244) txids, so ZEC spends of v5 outputs would be refused, and
 * it costs one extra fetch per previous transaction on every spend.
 *  - Zcash/Flux shielded components are refused, and the wallet's partial
 *    signature on every input is verified before the key adds its own.
 *
 * Display (TransactionRequest) and signing (approveTransaction) both run
 * `verifyConsumerUtxoTransaction`, so they enforce one rulebook.
 */
import utxolib from '@runonflux/utxo-lib';
import BigNumber from 'bignumber.js';
import { HDKey } from '@scure/bip32';
import { Buffer } from 'buffer';
import { toCashAddress } from 'bchaddrjs';
import { blockchains } from '@storage/blockchains';
import { generateMultisigAddress, getLibId } from './wallet';
import { maxConsumerFee, parseConsumerDerivationPath } from './consumerGuards';
import type { cryptos, utxo } from '../types';

// utxo-lib ships no types and the local declaration (src/utxolib.d.ts) only
// covers the few members older code used. Verification needs the full API
// (coins, ECSignature, per-coin sighash helpers), so it goes through an
// untyped view of the same module.
const lib: any = utxolib;
type UtxoLibTx = any;
type UtxoLibTxb = any;
type UtxoLibNetwork = any;

export interface ConsumerUtxoScripts {
  /** Display address of the derived 2-of-2 (cashaddr on BCH). */
  address: string;
  /** Exact output script of the derived 2-of-2. */
  scriptPubKey: Buffer;
  redeemScript?: Buffer;
  witnessScript?: Buffer;
  walletPubKey: Buffer;
  keyPubKey: Buffer;
}

export interface ConsumerUtxoInput {
  txid: string;
  vout: number;
}

export interface ConsumerUtxoRecipient {
  address: string;
  /** Base units (satoshis). */
  amount: string;
}

export interface VerifiedConsumerUtxoTx {
  scripts: ConsumerUtxoScripts;
  /** Derived sender address — never read from the transaction. */
  sender: string;
  /** Every value-bearing output that does not pay the derived 2-of-2. */
  recipients: ConsumerUtxoRecipient[];
  /** Base units returned to the derived 2-of-2. */
  change: string;
  /** Base units, computed from the key's own input values. */
  fee: string;
  /** Base-unit ceiling the fee was checked against. */
  maxFee: string;
  /** Key-verified value of every input, in input order. */
  inputs: Array<ConsumerUtxoInput & { satoshis: string }>;
}

export interface ConsumerUtxoDeps {
  /** UTXO set of the derived address, from the key's own backend. */
  fetchOwnUtxos: (address: string, chain: keyof cryptos) => Promise<utxo[]>;
  /** Raw hex of a previous transaction, from the key's own backend. */
  fetchRawTransaction: (txid: string, chain: keyof cryptos) => Promise<string>;
  /** USD price of the chain's native asset; 0 when unknown. */
  getUsdRate: (chain: keyof cryptos) => Promise<number>;
}

export interface ConsumerKeyMaterial {
  /** `typeIndex-addressIndex` from the request. */
  path: string;
  /** Decrypted wallet xpub of this chain (stored at pairing). */
  xpubWallet: string;
  /** Decrypted key xpub of this chain. */
  xpubKey: string;
}

function getNetwork(chain: keyof cryptos): UtxoLibNetwork {
  return lib.networks[getLibId(chain)];
}

function scriptTypeOf(chain: keyof cryptos): string {
  return blockchains[chain].scriptType;
}

function deriveLeafPublicKey(
  xpub: string,
  chain: keyof cryptos,
  typeIndex: number,
  addressIndex: number,
): Buffer {
  const bipParams = blockchains[chain].bip32;
  let node: HDKey;
  try {
    node = HDKey.fromExtendedKey(xpub, bipParams);
  } catch {
    node = HDKey.fromExtendedKey(xpub, getNetwork(chain).bip32);
  }
  const leaf = node.deriveChild(typeIndex).deriveChild(addressIndex);
  if (!leaf.publicKey) {
    throw new Error('Failed to derive public key');
  }
  return Buffer.from(leaf.publicKey);
}

/**
 * Derive the key's own 2-of-2 for the request path. Every input must spend
 * from exactly this script and only outputs to exactly this script are
 * change.
 */
export function deriveConsumerUtxoScripts(
  chain: keyof cryptos,
  keys: ConsumerKeyMaterial,
): ConsumerUtxoScripts {
  if (blockchains[chain].chainType) {
    throw new Error('Not a UTXO chain');
  }
  const { typeIndex, addressIndex } = parseConsumerDerivationPath(keys.path);
  const derived = generateMultisigAddress(
    keys.xpubWallet,
    keys.xpubKey,
    typeIndex,
    addressIndex,
    chain,
  );
  const redeemScript = derived.redeemScript
    ? Buffer.from(derived.redeemScript, 'hex')
    : undefined;
  const witnessScript = derived.witnessScript
    ? Buffer.from(derived.witnessScript, 'hex')
    : undefined;
  const scriptType = scriptTypeOf(chain);
  let scriptPubKey: Buffer;
  if (scriptType === 'p2wsh') {
    if (!witnessScript || redeemScript) {
      throw new Error('Unexpected script derivation for p2wsh');
    }
    scriptPubKey = lib.script.witnessScriptHash.output.encode(
      lib.crypto.sha256(witnessScript),
    );
  } else if (scriptType === 'p2sh-p2wsh') {
    if (!witnessScript || !redeemScript) {
      throw new Error('Unexpected script derivation for p2sh-p2wsh');
    }
    scriptPubKey = lib.script.scriptHash.output.encode(
      lib.crypto.hash160(redeemScript),
    );
  } else {
    if (!redeemScript || witnessScript) {
      throw new Error('Unexpected script derivation for p2sh');
    }
    scriptPubKey = lib.script.scriptHash.output.encode(
      lib.crypto.hash160(redeemScript),
    );
  }
  const walletPubKey = deriveLeafPublicKey(
    keys.xpubWallet,
    chain,
    typeIndex,
    addressIndex,
  );
  const keyPubKey = deriveLeafPublicKey(
    keys.xpubKey,
    chain,
    typeIndex,
    addressIndex,
  );
  if (walletPubKey.equals(keyPubKey)) {
    throw new Error('Wallet and key public keys must differ');
  }
  // Sanity: the multisig script must be exactly 2-of-2 over these two keys.
  const multisigScript = witnessScript ?? redeemScript;
  const expectedMultisig = lib.script.multisig.output.encode(
    2,
    [walletPubKey, keyPubKey].sort((a, b) => Buffer.compare(a, b)),
  );
  if (
    !multisigScript ||
    !Buffer.from(multisigScript).equals(expectedMultisig)
  ) {
    throw new Error('Derived multisig script mismatch');
  }
  return {
    address: derived.address,
    scriptPubKey: Buffer.from(scriptPubKey),
    redeemScript,
    witnessScript,
    walletPubKey,
    keyPubKey,
  };
}

/**
 * True when the chain's signature hash commits to each input's amount
 * (BIP143 witness v0, BCH FORKID, ZIP-243). False for legacy P2SH on
 * BTC-family coins (DOGE, RVN): there a wrong amount still yields a valid
 * signature, so amounts must come from hash-verified previous transactions.
 */
export function sighashCommitsToInputAmount(chain: keyof cryptos): boolean {
  const scriptType = scriptTypeOf(chain);
  if (scriptType === 'p2wsh' || scriptType === 'p2sh-p2wsh') {
    return true;
  }
  const network = getNetwork(chain);
  if (blockchains[chain].hashType || lib.coins.isBitcoinCash(network)) {
    return true;
  }
  return lib.coins.isZcash(network);
}

function txidOfInput(tx: UtxoLibTx, index: number): string {
  return Buffer.from(tx.ins[index].hash).reverse().toString('hex');
}

/** Refuse Zcash/Flux transactions that carry shielded or JoinSplit data. */
function assertTransparentOnly(tx: UtxoLibTx): void {
  const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  if (
    count(tx.joinsplits) > 0 ||
    count(tx.vShieldedSpend) > 0 ||
    count(tx.vShieldedOutput) > 0
  ) {
    throw new Error('Shielded transaction components are not supported');
  }
  if (tx.valueBalance !== undefined && Number(tx.valueBalance) !== 0) {
    throw new Error('Shielded value balance is not supported');
  }
}

/**
 * Parse the request transaction and require every input to spend from the
 * derived 2-of-2. Throws on any foreign, missing or differently-wrapped
 * script.
 */
export function inspectConsumerUtxoTransaction(
  rawTx: string,
  chain: keyof cryptos,
  scripts: ConsumerUtxoScripts,
): { tx: UtxoLibTx; txb: UtxoLibTxb; inputs: ConsumerUtxoInput[] } {
  const network = getNetwork(chain);
  const tx = lib.Transaction.fromHex(rawTx, network);
  assertTransparentOnly(tx);
  const txb = lib.TransactionBuilder.fromTransaction(tx, network);
  if (!txb.inputs.length || !tx.outs.length) {
    throw new Error('Transaction has no inputs or no outputs');
  }
  const scriptType = scriptTypeOf(chain);
  const seen = new Set<string>();
  const inputs: ConsumerUtxoInput[] = [];
  for (let i = 0; i < txb.inputs.length; i += 1) {
    const input = txb.inputs[i];
    const witnessScript: Buffer | undefined = input.witnessScript;
    const redeemScript: Buffer | undefined = input.redeemScript;
    let bound: boolean;
    if (scriptType === 'p2wsh') {
      bound =
        !!witnessScript &&
        !!scripts.witnessScript &&
        Buffer.from(witnessScript).equals(scripts.witnessScript) &&
        redeemScript === undefined &&
        tx.ins[i].script.length === 0;
    } else if (scriptType === 'p2sh-p2wsh') {
      bound =
        !!witnessScript &&
        !!redeemScript &&
        !!scripts.witnessScript &&
        !!scripts.redeemScript &&
        Buffer.from(witnessScript).equals(scripts.witnessScript) &&
        Buffer.from(redeemScript).equals(scripts.redeemScript);
    } else {
      bound =
        !!redeemScript &&
        !!scripts.redeemScript &&
        Buffer.from(redeemScript).equals(scripts.redeemScript) &&
        witnessScript === undefined &&
        !input.witness;
    }
    if (!bound) {
      throw new Error(
        `Input ${i} does not spend from this wallet's 2-of-2 address`,
      );
    }
    const txid = txidOfInput(tx, i);
    const vout = tx.ins[i].index;
    const outpoint = `${txid}:${vout}`;
    if (seen.has(outpoint)) {
      throw new Error(`Input ${outpoint} is spent twice`);
    }
    seen.add(outpoint);
    inputs.push({ txid, vout });
  }
  return { tx, txb, inputs };
}

/** Parallel previous-transaction fetches per request (bounded). */
export const PREVOUT_FETCH_CONCURRENCY = 6;
/** Outpoint values remembered after a full verification. */
const VALUE_CACHE_MAX = 5000;
const verifiedValueCache = new Map<string, number>();

function valueCacheKey(
  chain: keyof cryptos,
  scripts: ConsumerUtxoScripts,
  input: ConsumerUtxoInput,
): string {
  return `${chain}:${scripts.scriptPubKey.toString('hex')}:${input.txid}:${
    input.vout
  }`;
}

/** Drop every remembered outpoint value (tests; wallet reset). */
export function clearConsumerUtxoValueCache(): void {
  verifiedValueCache.clear();
}

function rememberVerifiedValues(
  chain: keyof cryptos,
  scripts: ConsumerUtxoScripts,
  inputs: ConsumerUtxoInput[],
  values: number[],
): void {
  inputs.forEach((input, i) => {
    const key = valueCacheKey(chain, scripts, input);
    verifiedValueCache.delete(key);
    verifiedValueCache.set(key, values[i]);
  });
  while (verifiedValueCache.size > VALUE_CACHE_MAX) {
    const oldest = verifiedValueCache.keys().next().value;
    if (oldest === undefined) break;
    verifiedValueCache.delete(oldest);
  }
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Rejects with the first
 * error; no new item starts after a failure.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

function toSafeSatoshis(value: unknown, label: string): number {
  const bn = new BigNumber(value as BigNumber.Value);
  if (
    !bn.isFinite() ||
    !bn.isInteger() ||
    bn.isNegative() ||
    bn.isGreaterThan(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(`Invalid value for ${label}`);
  }
  return bn.toNumber();
}

/**
 * Fetch one previous transaction and check the fetched bytes hash to its txid.
 */
async function fetchVerifiedPrevTx(
  chain: keyof cryptos,
  txid: string,
  deps: Pick<ConsumerUtxoDeps, 'fetchRawTransaction'>,
): Promise<UtxoLibTx> {
  const network = getNetwork(chain);
  const rawHex = await deps.fetchRawTransaction(txid, chain);
  if (typeof rawHex !== 'string' || !/^[0-9a-fA-F]+$/.test(rawHex)) {
    throw new Error(`Previous transaction ${txid} unavailable`);
  }
  const prevTx = lib.Transaction.fromHex(rawHex, network);
  if (prevTx.getId() !== txid) {
    throw new Error(`Previous transaction ${txid} hash mismatch`);
  }
  const hasWitness = prevTx.ins.some(
    (txIn: { witness?: Buffer[] }) => !!txIn.witness && txIn.witness.length > 0,
  );
  if (!hasWitness) {
    // Non-witness serialization: sha256d of the exact fetched bytes is the
    // txid. Checked directly on the raw bytes, not on a re-serialization.
    const digest = Buffer.from(lib.crypto.hash256(Buffer.from(rawHex, 'hex')))
      .reverse()
      .toString('hex');
    if (digest !== txid) {
      throw new Error(`Previous transaction ${txid} hash mismatch`);
    }
  }
  return prevTx;
}

/** Value of one outpoint of a hash-verified previous transaction. */
function prevoutValue(
  prevTx: UtxoLibTx,
  input: ConsumerUtxoInput,
  scriptPubKey: Buffer,
): number {
  const out = prevTx.outs[input.vout];
  if (!out) {
    throw new Error(`Previous output ${input.txid}:${input.vout} not found`);
  }
  if (!Buffer.from(out.script).equals(scriptPubKey)) {
    throw new Error(
      `Input ${input.txid}:${input.vout} is not owned by this wallet address`,
    );
  }
  return toSafeSatoshis(out.value, `${input.txid}:${input.vout}`);
}

/**
 * Value of one outpoint read from its previous transaction, after checking
 * the fetched bytes hash to the txid and the output pays the derived script.
 */
export async function verifiedPrevoutValue(
  chain: keyof cryptos,
  input: ConsumerUtxoInput,
  scripts: ConsumerUtxoScripts,
  deps: Pick<ConsumerUtxoDeps, 'fetchRawTransaction'>,
): Promise<number> {
  const prevTx = await fetchVerifiedPrevTx(chain, input.txid, deps);
  return prevoutValue(prevTx, input, scripts.scriptPubKey);
}

/**
 * `verifiedPrevoutValue` for many inputs: each distinct previous transaction
 * is fetched and hash-checked once, with bounded concurrency.
 */
export async function verifiedPrevoutValues(
  chain: keyof cryptos,
  inputs: ConsumerUtxoInput[],
  scripts: ConsumerUtxoScripts,
  deps: Pick<ConsumerUtxoDeps, 'fetchRawTransaction'>,
): Promise<number[]> {
  return verifiedPrevoutValuesFor(
    chain,
    inputs.map((input) => ({ ...input, scriptPubKey: scripts.scriptPubKey })),
    deps,
  );
}

/**
 * Same, where each input names the output script it must spend (enterprise
 * vault inputs come from different vault addresses). Every previous output
 * must pay exactly that script.
 */
export async function verifiedPrevoutValuesFor(
  chain: keyof cryptos,
  inputs: Array<ConsumerUtxoInput & { scriptPubKey: Buffer }>,
  deps: Pick<ConsumerUtxoDeps, 'fetchRawTransaction'>,
): Promise<number[]> {
  const txids = [...new Set(inputs.map((input) => input.txid))];
  const prevTxs = await mapWithConcurrency(
    txids,
    PREVOUT_FETCH_CONCURRENCY,
    (txid) => fetchVerifiedPrevTx(chain, txid, deps),
  );
  const byTxid = new Map<string, UtxoLibTx>();
  txids.forEach((txid, i) => byTxid.set(txid, prevTxs[i]));
  return inputs.map((input) =>
    prevoutValue(byTxid.get(input.txid), input, input.scriptPubKey),
  );
}

/**
 * Resolve the value of every input from the key's own data. Never uses the
 * request's `utxos`. Fails closed when any input cannot be valued. Outpoints
 * already valued by an earlier full verification (e.g. this request's
 * display pass) are reused, not fetched again.
 */
export async function resolveConsumerInputValues(
  chain: keyof cryptos,
  inputs: ConsumerUtxoInput[],
  scripts: ConsumerUtxoScripts,
  deps: Pick<ConsumerUtxoDeps, 'fetchOwnUtxos' | 'fetchRawTransaction'>,
): Promise<number[]> {
  const values: Array<number | undefined> = inputs.map((input) =>
    verifiedValueCache.get(valueCacheKey(chain, scripts, input)),
  );
  const pending = inputs
    .map((input, index) => ({ input, index }))
    .filter(({ index }) => values[index] === undefined);
  if (!pending.length) {
    return values as number[];
  }
  if (!sighashCommitsToInputAmount(chain)) {
    // DOGE/RVN: the signature does not commit to the amount, so a backend
    // that lies about a UTXO value would silently burn the difference as
    // fee. Read every value from a hash-verified previous transaction.
    const fetched = await verifiedPrevoutValues(
      chain,
      pending.map(({ input }) => input),
      scripts,
      deps,
    );
    pending.forEach(({ index }, i) => {
      values[index] = fetched[i];
    });
    return values as number[];
  }
  // Amount-committing chains: values from the key's own UTXO lookup (not
  // hash-checked; see the residual in the header). The key signs with these
  // values and they must also verify the wallet's partial signature on each
  // input, so an honest wallet plus a lying backend is refused.
  const own = await deps.fetchOwnUtxos(scripts.address, chain);
  const byOutpoint = new Map<string, utxo>();
  (Array.isArray(own) ? own : []).forEach((u) => {
    if (u && typeof u.txid === 'string') {
      byOutpoint.set(`${u.txid}:${Number(u.vout)}`, u);
    }
  });
  const missing: Array<{ input: ConsumerUtxoInput; index: number }> = [];
  for (const { input, index } of pending) {
    const found = byOutpoint.get(`${input.txid}:${input.vout}`);
    if (found) {
      values[index] = toSafeSatoshis(
        found.satoshis,
        `${input.txid}:${input.vout}`,
      );
    } else {
      missing.push({ input, index });
    }
  }
  if (missing.length) {
    const fetched = await verifiedPrevoutValues(
      chain,
      missing.map(({ input }) => input),
      scripts,
      deps,
    );
    missing.forEach(({ index }, i) => {
      values[index] = fetched[i];
    });
  }
  return values as number[];
}

/** Split outputs into change (exactly the derived script) and recipients. */
export function summarizeConsumerUtxoOutputs(
  tx: UtxoLibTx,
  chain: keyof cryptos,
  scripts: ConsumerUtxoScripts,
): {
  recipients: ConsumerUtxoRecipient[];
  change: BigNumber;
  total: BigNumber;
} {
  const network = getNetwork(chain);
  const cashAddr = !!blockchains[chain].cashaddr;
  const recipients: ConsumerUtxoRecipient[] = [];
  let change = new BigNumber(0);
  let total = new BigNumber(0);
  tx.outs.forEach((out: { script: Buffer; value: number }) => {
    const value = toSafeSatoshis(out.value, 'output');
    if (value === 0) {
      return; // zero-value outputs (OP_RETURN memo) move no funds
    }
    total = total.plus(value);
    if (Buffer.from(out.script).equals(scripts.scriptPubKey)) {
      change = change.plus(value);
      return;
    }
    // Throws for any value-bearing output that has no address form — the
    // decode then fails closed.
    let address: string = lib.address.fromOutputScript(out.script, network);
    if (cashAddr) {
      address = toCashAddress(address);
    }
    recipients.push({ address, amount: String(value) });
  });
  return { recipients, change, total };
}

function expectedHashType(chain: keyof cryptos): number {
  return blockchains[chain].hashType
    ? lib.Transaction.SIGHASH_ALL | lib.Transaction.SIGHASH_BITCOINCASHBIP143
    : lib.Transaction.SIGHASH_ALL;
}

function inputSignatureHash(
  txb: UtxoLibTxb,
  chain: keyof cryptos,
  vin: number,
  value: number,
  hashType: number,
): Buffer {
  const network = getNetwork(chain);
  const input = txb.inputs[vin];
  if (lib.coins.isBitcoinCash(network)) {
    return txb.tx.hashForCashSignature(vin, input.signScript, value, hashType);
  }
  if (lib.coins.isZcash(network)) {
    return txb.tx.hashForZcashSignature(vin, input.signScript, value, hashType);
  }
  if (input.witness) {
    return txb.tx.hashForWitnessV0(vin, input.signScript, value, hashType);
  }
  return txb.tx.hashForSignature(vin, input.signScript, hashType);
}

/**
 * UTXO-8: verify the wallet's partial signature on EVERY input (SIGHASH_ALL,
 * or ALL|FORKID on BCH) before the key adds its own and broadcasts.
 */
export function verifyWalletPartialSignatures(
  txb: UtxoLibTxb,
  chain: keyof cryptos,
  scripts: ConsumerUtxoScripts,
  values: number[],
): void {
  const network = getNetwork(chain);
  const hashType = expectedHashType(chain);
  const walletKey = lib.ECPair.fromPublicKeyBuffer(
    scripts.walletPubKey,
    network,
  );
  for (let i = 0; i < txb.inputs.length; i += 1) {
    const input = txb.inputs[i];
    const pubKeys: Buffer[] = input.pubKeys ?? [];
    const slot = pubKeys.findIndex((pk) =>
      Buffer.from(pk).equals(scripts.walletPubKey),
    );
    const signature: Buffer | undefined =
      slot >= 0 && Array.isArray(input.signatures)
        ? input.signatures[slot]
        : undefined;
    if (!signature) {
      throw new Error(`Input ${i} is missing the wallet signature`);
    }
    let parsed: { signature: unknown; hashType: number };
    try {
      parsed = lib.ECSignature.parseScriptSignature(signature);
    } catch {
      throw new Error(`Input ${i} has a malformed wallet signature`);
    }
    if (parsed.hashType !== hashType) {
      throw new Error(`Input ${i} wallet signature uses a non-ALL sighash`);
    }
    const hash = inputSignatureHash(txb, chain, i, values[i], hashType);
    if (!walletKey.verify(hash, parsed.signature)) {
      throw new Error(`Input ${i} wallet signature is invalid`);
    }
  }
}

/**
 * Full consumer UTXO verification, shared by the approval screen and the
 * signing action. Throws (fail closed) on any problem.
 */
export async function verifyConsumerUtxoTransaction(
  rawTx: string,
  chain: keyof cryptos,
  keys: ConsumerKeyMaterial,
  deps: ConsumerUtxoDeps,
): Promise<VerifiedConsumerUtxoTx> {
  const scripts = deriveConsumerUtxoScripts(chain, keys);
  const { tx, txb, inputs } = inspectConsumerUtxoTransaction(
    rawTx,
    chain,
    scripts,
  );
  const values = await resolveConsumerInputValues(chain, inputs, scripts, deps);
  const totalIn = values.reduce((sum, v) => sum.plus(v), new BigNumber(0));
  const { recipients, change, total } = summarizeConsumerUtxoOutputs(
    tx,
    chain,
    scripts,
  );
  const fee = totalIn.minus(total);
  if (!fee.isFinite() || fee.isNegative()) {
    throw new Error('Transaction outputs exceed its inputs');
  }
  // Per-chain hard cap from the local chain spec (the wallet's `maxFee`).
  const hardCap = blockchains[chain].maxFee;
  if (typeof hardCap !== 'number' || !(hardCap > 0)) {
    throw new Error('No fee cap configured for this chain');
  }
  const usdRate = await deps.getUsdRate(chain).catch(() => 0);
  const maxFee = maxConsumerFee(hardCap, blockchains[chain].decimals, usdRate);
  if (fee.isGreaterThan(maxFee)) {
    throw new Error(
      `Network fee ${fee.toFixed()} exceeds the maximum of ${maxFee.toFixed()}`,
    );
  }
  verifyWalletPartialSignatures(txb, chain, scripts, values);
  // Only values that passed everything (incl. the wallet's signatures) are
  // remembered for reuse.
  rememberVerifiedValues(chain, scripts, inputs, values);
  return {
    scripts,
    sender: scripts.address,
    recipients,
    change: change.toFixed(),
    fee: fee.toFixed(),
    maxFee: maxFee.toFixed(),
    inputs: inputs.map((input, i) => ({
      ...input,
      satoshis: String(values[i]),
    })),
  };
}
