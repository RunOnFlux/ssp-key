// Shared Kaspa test fixtures (not a test file itself).
import * as K from '@runonflux/kaspa-core';
import {
  generateAddressKeypair,
  getMasterXpriv,
  getMasterXpub,
} from '../../src/lib/wallet';

/** BIP-39 test mnemonics from KASPA_SSP_CONTRACT.md §2 — never fund them. */
export const MNEMONIC_W =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
export const MNEMONIC_KK =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
export const MNEMONIC_S3 =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
export const MNEMONIC_Z = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

export const KAS = 'kas';

export function kasXpub(mnemonic: string, account: number): string {
  return getMasterXpub(mnemonic, 48, 111111, account, 'p2sh', KAS);
}

export function kasXpriv(mnemonic: string, account: number): string {
  return getMasterXpriv(mnemonic, 48, 111111, account, 'p2sh', KAS);
}

let txCounter = 1;

/** A fake UTXO of `spend` in the shape kaspa-core's REST client returns. */
export function fakeUtxo(
  spend: K.Spend,
  amount: bigint,
): K.InputPlan & {
  address: string;
} {
  const spk = K.spendScriptPublicKey(spend);
  const id = new Uint8Array(32);
  id[0] = 0xaa;
  id[31] = txCounter;
  txCounter += 1;
  return {
    address: K.scriptPublicKeyToAddress(spk, 'kaspa') as string,
    outpoint: { transactionId: id, index: 0 },
    entry: {
      amount,
      scriptPublicKey: spk,
      blockDaaScore: 1000n,
      isCoinbase: false,
    },
    spend,
  };
}

/** A standard P2PK recipient address. */
export function recipientAddress(seed: number): string {
  const priv = new Uint8Array(32);
  priv[31] = seed;
  const signer = K.localSigner(priv);
  const address = K.scriptPublicKeyToAddress(
    K.p2pkScript(signer.xOnlyPublicKey),
    'kaspa',
  ) as string;
  signer.destroy();
  return address;
}

/** Unsigned transaction paying `pay` to `to` with change back to `change`. */
export function buildTx(
  inputs: K.InputPlan[],
  to: string,
  pay: bigint,
  fee: bigint,
  change: K.Spend,
): K.Transaction {
  const total = inputs.reduce((a, p) => a + p.entry.amount, 0n);
  return K.createTransaction({
    inputs,
    outputs: [
      { value: pay, scriptPublicKey: K.addressToScriptPublicKey(to, 'kaspa') },
      {
        value: total - pay - fee,
        scriptPublicKey: K.spendScriptPublicKey(change),
      },
    ],
  });
}

/** REST `/addresses/{addr}/utxos` JSON for the given UTXOs. */
export function restUtxoJson(
  utxos: { address: string; outpoint: K.Outpoint; entry: K.UtxoEntry }[],
): unknown[] {
  return utxos.map((u) => ({
    address: u.address,
    outpoint: {
      transactionId: K.bytesToHex(u.outpoint.transactionId),
      index: u.outpoint.index,
    },
    utxoEntry: {
      amount: u.entry.amount.toString(),
      scriptPublicKey: {
        scriptPublicKey: K.bytesToHex(u.entry.scriptPublicKey.script),
      },
      blockDaaScore: u.entry.blockDaaScore.toString(),
      isCoinbase: u.entry.isCoinbase,
    },
  }));
}

/** In-memory SignedAmountLedger. */
export function memoryLedger(): K.SignedAmountLedger & {
  map: Map<string, bigint>;
} {
  const map = new Map<string, bigint>();
  return {
    map,
    get: (o) => map.get(o),
    set: (o, a) => {
      map.set(o, a);
    },
  };
}

/** Leaf signer from an account xpriv (raw key zeroed after). */
export function leafSigner(xpriv: string, a: number, b: number): K.LocalSigner {
  const kp = generateAddressKeypair(xpriv, a, b, KAS);
  const key = K.hexToBytes(kp.privKey);
  const signer = K.localSigner(key);
  key.fill(0);
  return signer;
}
