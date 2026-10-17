/**
 * Enterprise UTXO vault: input amounts and fee (review round 1, Key item 2).
 *
 * The relay supplies each vault input's `amount` in `inputDetails`. The fee
 * shown on the approval screen is sum(amounts) - sum(outputs), and the Key
 * signs with those amounts.
 *
 *  - On chains whose sighash does NOT commit to input amounts (legacy P2SH:
 *    DOGE, RVN — `sighashCommitsToInputAmount`), a relay that under-states an
 *    amount would get a valid signature on a transaction whose real fee is
 *    far higher than the one shown. There every amount is checked against the
 *    previous transaction, fetched from the Key's OWN backend: its bytes must
 *    hash to the txid, and the output must pay the input's vault script
 *    derived from the pinned descriptor. Any mismatch blocks approval.
 *  - On amount-committing chains (BIP143 / FORKID / ZIP-243) a wrong amount
 *    only yields a signature that does not verify on chain, so the relay's
 *    amounts are used as committed values.
 *  - On every UTXO vault chain the fee must be non-negative and at most
 *    `maxVaultFee`: min(chain maxFee — the enterprise builder's own absurd-fee
 *    limit — and VAULT_MAX_FEE_USD at the Key's own rate).
 *
 * Run at receipt (before the request can be approved) and again in the sign
 * action, which signs with the amounts returned here.
 */
import BigNumber from 'bignumber.js';
import utxolib from '@runonflux/utxo-lib';
import { Buffer } from 'buffer';
import { blockchains } from '@storage/blockchains';
import { fetchRawTransactionHex } from './constructTx';
import { getCryptoUsdRate } from './rates';
import { maxVaultFee } from './consumerGuards';
import {
  sighashCommitsToInputAmount,
  verifiedPrevoutValuesFor,
} from './consumerUtxo';
import type { ConsumerUtxoDeps } from './consumerUtxo';
import { parseInputDetails } from './enterpriseGuards';
import type { VaultUtxoInputScripts } from './vaultDescriptorGate';
import type { cryptos } from '../types';

export type VaultUtxoAmountDeps = Pick<
  ConsumerUtxoDeps,
  'fetchRawTransaction' | 'getUsdRate'
>;

/** The Key's own backends. */
export const vaultUtxoAmountDeps: VaultUtxoAmountDeps = {
  fetchRawTransaction: (txid, chain) => fetchRawTransactionHex(txid, chain),
  getUsdRate: (chain) => getCryptoUsdRate(chain),
};

export type VaultUtxoAmountCheck =
  | {
      ok: true;
      /** Verified (or committed) amount of every input, base units. */
      amounts: number[];
      /** Base units. */
      fee: string;
      /** Base-unit ceiling the fee was checked against. */
      maxFee: string;
    }
  | { ok: false; reason: string };

function parseAmount(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let bn: BigNumber;
  try {
    bn = new BigNumber(value);
  } catch {
    return null; // bignumber.js throws on garbage strings
  }
  if (
    !bn.isFinite() ||
    !bn.isInteger() ||
    !bn.isPositive() ||
    bn.isZero() ||
    bn.isGreaterThan(Number.MAX_SAFE_INTEGER)
  ) {
    return null;
  }
  return bn.toNumber();
}

/**
 * Verify every vault input amount (hash-checked previous transactions where
 * the sighash ignores amounts) and cap the fee. Never throws.
 *
 * `derivedInputs` are the per-input scripts `checkVaultUtxoTransaction`
 * derived from the pinned descriptor, in input order.
 */
export async function verifyVaultUtxoAmounts(
  chain: keyof cryptos,
  rawTxHex: unknown,
  rawInputDetails: unknown,
  derivedInputs: VaultUtxoInputScripts[],
  deps: VaultUtxoAmountDeps = vaultUtxoAmountDeps,
): Promise<VaultUtxoAmountCheck> {
  try {
    const config = blockchains[chain];
    if (!config || config.chainType) {
      return { ok: false, reason: 'not a UTXO vault' };
    }
    if (typeof rawTxHex !== 'string' || !rawTxHex) {
      return { ok: false, reason: 'no transaction to verify' };
    }
    const network = utxolib.networks[config.libid];
    const tx = utxolib.Transaction.fromHex(rawTxHex, network) as {
      ins: Array<{ hash: Buffer; index: number }>;
      outs: Array<{ value: number; script: Buffer }>;
    };
    const entries = parseInputDetails(rawInputDetails);
    if (
      entries.length === 0 ||
      entries.length !== tx.ins.length ||
      derivedInputs.length !== tx.ins.length
    ) {
      return {
        ok: false,
        reason: 'the input details do not match the transaction inputs',
      };
    }
    const claimed: number[] = [];
    for (let i = 0; i < entries.length; i++) {
      const amount = parseAmount(entries[i].amount);
      if (amount === null) {
        return { ok: false, reason: `input ${i} has no valid amount` };
      }
      claimed.push(amount);
    }

    if (!sighashCommitsToInputAmount(chain)) {
      const verified = await verifiedPrevoutValuesFor(
        chain,
        tx.ins.map((txIn, i) => ({
          txid: Buffer.from(txIn.hash).reverse().toString('hex'),
          vout: txIn.index,
          scriptPubKey: Buffer.from(derivedInputs[i].scriptPubKey, 'hex'),
        })),
        deps,
      );
      for (let i = 0; i < verified.length; i++) {
        if (verified[i] !== claimed[i]) {
          return {
            ok: false,
            reason: `input ${i} amount does not match its previous transaction`,
          };
        }
      }
    }

    const totalIn = claimed.reduce(
      (sum, value) => sum.plus(value),
      new BigNumber(0),
    );
    const totalOut = tx.outs.reduce(
      (sum, out) => sum.plus(out.value),
      new BigNumber(0),
    );
    const fee = totalIn.minus(totalOut);
    if (!fee.isFinite() || fee.isNegative()) {
      return { ok: false, reason: 'the transaction outputs exceed its inputs' };
    }
    const hardCap = config.maxFee;
    if (typeof hardCap !== 'number' || !(hardCap > 0)) {
      return { ok: false, reason: 'no fee cap configured for this chain' };
    }
    const usdRate = await deps.getUsdRate(chain).catch(() => 0);
    const maxFee = maxVaultFee(hardCap, config.decimals, usdRate);
    if (fee.isGreaterThan(maxFee)) {
      return {
        ok: false,
        reason: `the network fee ${fee.toFixed()} exceeds the maximum of ${maxFee.toFixed()}`,
      };
    }
    return {
      ok: true,
      amounts: claimed,
      fee: fee.toFixed(),
      maxFee: maxFee.toFixed(),
    };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error
          ? `could not verify the input amounts: ${error.message}`
          : 'could not verify the input amounts',
    };
  }
}
