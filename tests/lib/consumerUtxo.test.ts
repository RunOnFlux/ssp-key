// @ts-nocheck test suite — utxo-lib ships no types
import utxolib from '@runonflux/utxo-lib';
import { Buffer } from 'buffer';
import { blockchains } from '../../src/storage/blockchains';
import {
  generateAddressKeypair,
  generateMultisigAddress,
  getMasterXpriv,
  getMasterXpub,
} from '../../src/lib/wallet';
import {
  clearConsumerUtxoValueCache,
  deriveConsumerUtxoScripts,
  PREVOUT_FETCH_CONCURRENCY,
  sighashCommitsToInputAmount,
  verifyConsumerUtxoTransaction,
  verifyWalletPartialSignatures,
} from '../../src/lib/consumerUtxo';
import {
  finaliseTransaction,
  signTransaction,
} from '../../src/lib/constructTx';
import { decodeTransactionForApproval } from '../../src/lib/transactions';

/**
 * Regression suite for the consumer UTXO co-sign (C-2 / UTXO-1, H-2 /
 * UTXO-4, UTXO-5, UTXO-8, KAS-4). The PoCs in the 2026-10 review
 * (poc_p2wsh_change_hide.js, poc_fee_display.js, poc_sighash_amounts.js) are
 * reproduced here against the real key code.
 */

const WALLET_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KEY_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PATH = '0-3';

function material(chain) {
  const cfg = blockchains[chain];
  const xpubWallet = getMasterXpub(
    WALLET_MNEMONIC,
    48,
    cfg.slip,
    0,
    cfg.scriptType,
    chain,
  );
  const xpubKey = getMasterXpub(
    KEY_MNEMONIC,
    48,
    cfg.slip,
    0,
    cfg.scriptType,
    chain,
  );
  const xprivWallet = getMasterXpriv(
    WALLET_MNEMONIC,
    48,
    cfg.slip,
    0,
    cfg.scriptType,
    chain,
  );
  const xprivKey = getMasterXpriv(
    KEY_MNEMONIC,
    48,
    cfg.slip,
    0,
    cfg.scriptType,
    chain,
  );
  const walletKp = generateAddressKeypair(xprivWallet, 0, 3, chain);
  const keyKp = generateAddressKeypair(xprivKey, 0, 3, chain);
  const ms = generateMultisigAddress(xpubWallet, xpubKey, 0, 3, chain);
  const keys = { path: PATH, xpubWallet, xpubKey };
  const scripts = deriveConsumerUtxoScripts(chain, keys);
  return { cfg, keys, walletKp, keyKp, ms, scripts };
}

beforeEach(() => {
  clearConsumerUtxoValueCache();
});

const network = (chain) => utxolib.networks[blockchains[chain].libid];
const isZcashLike = (chain) => utxolib.coins.isZcash(network(chain));

/** A previous transaction paying `value` to `script`. */
function fundingTx(chain, script, value, tag) {
  const tx = new utxolib.Transaction(network(chain));
  if (isZcashLike(chain)) {
    tx.version = 4;
    tx.overwintered = 1;
    tx.versionGroupId = 0x892f2085;
  }
  tx.addInput(Buffer.alloc(32, tag), 0);
  tx.addOutput(script, value);
  return tx;
}

function hashTypeFor(chain) {
  return blockchains[chain].hashType
    ? utxolib.Transaction.SIGHASH_ALL |
        utxolib.Transaction.SIGHASH_BITCOINCASHBIP143
    : utxolib.Transaction.SIGHASH_ALL;
}

/** Honest SSP Wallet: spend own inputs, wallet-sign every input. */
function walletBuild(chain, m, inputs, outputs, opts = {}) {
  const net = network(chain);
  const txb = new utxolib.TransactionBuilder(net);
  if (isZcashLike(chain)) {
    txb.setVersion(4);
    txb.setVersionGroupId(0x892f2085);
  }
  inputs.forEach((input) => txb.addInput(input.tx.getId(), input.vout));
  outputs.forEach((out) => txb.addOutput(out.script, out.value));
  const walletPair = utxolib.ECPair.fromWIF(m.walletKp.privKey, net);
  inputs.forEach((input, i) => {
    if (opts.skipSignIndex === i) return;
    txb.sign(
      i,
      walletPair,
      m.scripts.redeemScript,
      opts.hashType ?? hashTypeFor(chain),
      opts.signValues?.[i] ?? opts.signValue ?? input.value,
      m.scripts.witnessScript,
    );
  });
  return txb.buildIncomplete().toHex();
}

function depsFor(chain, inputs, overrides = {}) {
  return {
    fetchOwnUtxos: jest.fn(() =>
      Promise.resolve(
        inputs.map((input) => ({
          txid: input.tx.getId(),
          vout: input.vout,
          scriptPubKey: '',
          satoshis: String(input.value),
          confirmations: 1,
          coinbase: false,
        })),
      ),
    ),
    fetchRawTransaction: jest.fn((txid) => {
      const found = inputs.find((input) => input.tx.getId() === txid);
      if (!found) return Promise.reject(new Error('not found'));
      return Promise.resolve(found.tx.toHex());
    }),
    getUsdRate: jest.fn(() => Promise.resolve(0)),
    ...overrides,
  };
}

const payee = () =>
  utxolib.script.scriptHash.output.encode(
    utxolib.crypto.hash160(Buffer.from('payee')),
  );

/** Assert both signatures on every input of a finalised tx are valid. */
function expectFullySigned(chain, m, finalHex, values) {
  const net = network(chain);
  const txb = utxolib.TransactionBuilder.fromTransaction(
    utxolib.Transaction.fromHex(finalHex, net),
    net,
  );
  verifyWalletPartialSignatures(txb, chain, m.scripts, values);
  verifyWalletPartialSignatures(
    txb,
    chain,
    { ...m.scripts, walletPubKey: m.scripts.keyPubKey },
    values,
  );
}

describe('consumer UTXO: own-script derivation', () => {
  it.each(['btc', 'ltc', 'flux', 'doge', 'rvn', 'bch', 'zec'])(
    '%s derives the same 2-of-2 the wallet pairs with',
    (chain) => {
      const m = material(chain);
      expect(m.scripts.address).toBe(m.ms.address);
      expect(m.scripts.keyPubKey.toString('hex')).toBe(m.keyKp.pubKey);
      expect(m.scripts.walletPubKey.toString('hex')).toBe(m.walletKp.pubKey);
    },
  );

  it('refuses identity / non-consumer branches (KEY-8)', () => {
    const m = material('btc');
    expect(() =>
      deriveConsumerUtxoScripts('btc', { ...m.keys, path: '10-0' }),
    ).toThrow(/not a consumer spending branch/);
  });
});

describe('consumer UTXO: honest round trips', () => {
  it.each(['btc', 'flux', 'bch', 'ltc'])(
    '%s: verifies, shows every recipient + change + fee, then co-signs',
    async (chain) => {
      const m = material(chain);
      const f1 = fundingTx(chain, m.scripts.scriptPubKey, 150000, 1);
      const f2 = fundingTx(chain, m.scripts.scriptPubKey, 90000, 2);
      const inputs = [
        { tx: f1, vout: 0, value: 150000 },
        { tx: f2, vout: 0, value: 90000 },
      ];
      const raw = walletBuild(chain, m, inputs, [
        { script: payee(), value: 100000 },
        { script: m.scripts.scriptPubKey, value: 135000 },
      ]);
      const deps = depsFor(chain, inputs);
      const verified = await verifyConsumerUtxoTransaction(
        raw,
        chain,
        m.keys,
        deps,
      );
      expect(verified.sender).toBe(m.ms.address);
      expect(verified.recipients).toHaveLength(1);
      expect(verified.recipients[0].amount).toBe('100000');
      expect(verified.change).toBe('135000');
      expect(verified.fee).toBe('5000');

      const signed = signTransaction(raw, chain, m.keyKp.privKey, verified);
      const finalHex = finaliseTransaction(signed, chain);
      expectFullySigned(chain, m, finalHex, [150000, 90000]);
    },
  );

  it('doge (no amount commitment) reads values from hash-verified previous transactions (UTXO-5)', async () => {
    const chain = 'doge';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 1000000000000, 3);
    const inputs = [{ tx: f1, vout: 0, value: 1000000000000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 400000000 },
      { script: m.scripts.scriptPubKey, value: 999500000000 },
    ]);
    // A lying backend: claims the 10,000 DOGE UTXO is worth 5 DOGE. It must
    // never be consulted on a chain whose sighash ignores amounts.
    const deps = depsFor(chain, inputs, {
      fetchOwnUtxos: jest.fn(() =>
        Promise.resolve([{ txid: f1.getId(), vout: 0, satoshis: '500000000' }]),
      ),
    });
    const verified = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      deps,
    );
    expect(deps.fetchOwnUtxos).not.toHaveBeenCalled();
    expect(deps.fetchRawTransaction).toHaveBeenCalledWith(f1.getId(), chain);
    expect(verified.fee).toBe('100000000');
    const signed = signTransaction(raw, chain, m.keyKp.privKey, verified);
    expectFullySigned(
      chain,
      m,
      finaliseTransaction(signed, chain),
      [1000000000000],
    );
  });

  it('decodeTransactionForApproval lists every non-change output (KAS-4)', async () => {
    const chain = 'btc';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 300000, 4);
    const inputs = [{ tx: f1, vout: 0, value: 300000 }];
    const second = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(Buffer.from('second payee')),
    );
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 100000 },
      { script: second, value: 50000 },
      { script: m.scripts.scriptPubKey, value: 140000 },
    ]);
    const info = await decodeTransactionForApproval(
      raw,
      chain,
      m.keys,
      depsFor(chain, inputs),
    );
    expect(info.sender).toBe(m.ms.address);
    expect(info.recipientCount).toBe(2);
    expect(info.recipients.map((r) => r.amount)).toEqual(['0.001', '0.0005']);
    expect(info.amount).toBe('0.0015');
    expect(info.fee).toBe('0.0001');
  });

  it('decodeTransactionForApproval fails closed without key material', async () => {
    const chain = 'btc';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 300000, 5);
    const inputs = [{ tx: f1, vout: 0, value: 300000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 290000 },
    ]);
    const info = await decodeTransactionForApproval(raw, chain);
    expect(info.amount).toBe('decodingError');
    expect(info.error).toMatch(/key material/);
  });
});

describe('C-2 / UTXO-1: P2WSH hidden "change" (poc_p2wsh_change_hide)', () => {
  it('refuses a foreign 1-of-2 [attacker, key] input and never signs it', async () => {
    const chain = 'btc';
    const net = network(chain);
    const m = material(chain);
    const attacker = utxolib.ECPair.makeRandom({ network: net });
    const sA = utxolib.script.multisig.output.encode(1, [
      attacker.getPublicKeyBuffer(),
      m.scripts.keyPubKey,
    ]);
    const p2wsh = (s) =>
      utxolib.script.witnessScriptHash.output.encode(utxolib.crypto.sha256(s));
    const dust = fundingTx(chain, p2wsh(sA), 1000, 6);
    const userFunds = fundingTx(chain, m.scripts.scriptPubKey, 100000000, 7);

    // compromised wallet builds + half-signs exactly like the PoC
    const txb = new utxolib.TransactionBuilder(net);
    txb.addInput(dust.getId(), 0, 0xfffffffd);
    txb.addInput(userFunds.getId(), 0, 0xfffffffd);
    txb.addOutput(p2wsh(sA), 99000000); // "change" on the old screen
    txb.addOutput(payee(), 989000);
    txb.sign(
      1,
      utxolib.ECPair.fromWIF(m.walletKp.privKey, net),
      undefined,
      utxolib.Transaction.SIGHASH_ALL,
      100000000,
      m.scripts.witnessScript,
    );
    const half = txb.buildIncomplete();
    half.setWitness(0, [Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0), sA]);
    const attackRaw = half.toHex();
    const inputs = [
      { tx: dust, vout: 0, value: 1000 },
      { tx: userFunds, vout: 0, value: 100000000 },
    ];

    await expect(
      verifyConsumerUtxoTransaction(
        attackRaw,
        chain,
        m.keys,
        depsFor(chain, inputs),
      ),
    ).rejects.toThrow(/Input 0 does not spend from this wallet/);

    const info = await decodeTransactionForApproval(
      attackRaw,
      chain,
      m.keys,
      depsFor(chain, inputs),
    );
    expect(info.receiver).toBe('decodingError');

    // signTransaction re-checks the scripts itself: even a verification
    // result of another (honest) transaction cannot be used to sign this one.
    const honestRaw = walletBuild(
      chain,
      m,
      [{ tx: userFunds, vout: 0, value: 100000000 }],
      [{ script: payee(), value: 99990000 }],
    );
    const honestVerified = await verifyConsumerUtxoTransaction(
      honestRaw,
      chain,
      m.keys,
      depsFor(chain, [{ tx: userFunds, vout: 0, value: 100000000 }]),
    );
    expect(() =>
      signTransaction(attackRaw, chain, m.keyKp.privKey, honestVerified),
    ).toThrow(/does not spend from this wallet/);
  });

  it('refuses a P2SH-wrapped input on a native P2WSH chain', async () => {
    const chain = 'btc';
    const net = network(chain);
    const m = material(chain);
    const wrapped = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(
        utxolib.script.witnessScriptHash.output.encode(
          utxolib.crypto.sha256(m.scripts.witnessScript),
        ),
      ),
    );
    const f = fundingTx(chain, wrapped, 100000, 8);
    const txb = new utxolib.TransactionBuilder(net);
    txb.addInput(f.getId(), 0);
    txb.addOutput(payee(), 90000);
    txb.sign(
      0,
      utxolib.ECPair.fromWIF(m.walletKp.privKey, net),
      utxolib.script.witnessScriptHash.output.encode(
        utxolib.crypto.sha256(m.scripts.witnessScript),
      ),
      utxolib.Transaction.SIGHASH_ALL,
      100000,
      m.scripts.witnessScript,
    );
    await expect(
      verifyConsumerUtxoTransaction(
        txb.buildIncomplete().toHex(),
        chain,
        m.keys,
        depsFor(chain, [{ tx: f, vout: 0, value: 100000 }]),
      ),
    ).rejects.toThrow(/does not spend from this wallet/);
  });
});

describe('H-2 / UTXO-4: fee comes from the key, always, capped (poc_fee_display)', () => {
  const chain = 'btc';

  it('(a) a 0.999 BTC fee is computed from the key lookup and refused', async () => {
    const m = material(chain);
    const fund = fundingTx(chain, m.scripts.scriptPubKey, 100000000, 9);
    const inputs = [{ tx: fund, vout: 0, value: 100000000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 100000 },
    ]);
    await expect(
      verifyConsumerUtxoTransaction(raw, chain, m.keys, depsFor(chain, inputs)),
    ).rejects.toThrow(/exceeds the maximum/);
  });

  it('(b) request-supplied utxo lists cannot reach the fee at all', async () => {
    // The verification API has no `utxos` input: values only come from the
    // key's own lookup. A request with negative/bogus entries is irrelevant.
    const m = material(chain);
    const fund = fundingTx(chain, m.scripts.scriptPubKey, 100000000, 10);
    const inputs = [{ tx: fund, vout: 0, value: 100000000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 99990000 },
    ]);
    const verified = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      depsFor(chain, inputs),
    );
    expect(verified.fee).toBe('10000');
    expect(verified.inputs).toEqual([
      { txid: fund.getId(), vout: 0, satoshis: '100000000' },
    ]);
  });

  it('applies the USD cap below the chain cap', async () => {
    const m = material(chain);
    const fund = fundingTx(chain, m.scripts.scriptPubKey, 1000000, 11);
    const inputs = [{ tx: fund, vout: 0, value: 1000000 }];
    // 150,000 sats fee: under maxFee (0.01 BTC) but above $100 at $100k
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 850000 },
    ]);
    await expect(
      verifyConsumerUtxoTransaction(
        raw,
        chain,
        m.keys,
        depsFor(chain, inputs, { getUsdRate: () => Promise.resolve(100000) }),
      ),
    ).rejects.toThrow(/exceeds the maximum of 100000/);
    const ok = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      depsFor(chain, inputs),
    );
    expect(ok.fee).toBe('150000');
  });

  it('refuses outputs above inputs (negative fee)', async () => {
    const m = material(chain);
    const fund = fundingTx(chain, m.scripts.scriptPubKey, 100000, 12);
    const inputs = [{ tx: fund, vout: 0, value: 100000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 120000 },
    ]);
    await expect(
      verifyConsumerUtxoTransaction(raw, chain, m.keys, depsFor(chain, inputs)),
    ).rejects.toThrow(/exceed its inputs/);
  });

  it('fails closed when an input cannot be valued', async () => {
    const m = material(chain);
    const fund = fundingTx(chain, m.scripts.scriptPubKey, 100000, 13);
    const inputs = [{ tx: fund, vout: 0, value: 100000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 90000 },
    ]);
    await expect(
      verifyConsumerUtxoTransaction(
        raw,
        chain,
        m.keys,
        depsFor(chain, inputs, {
          fetchOwnUtxos: () => Promise.resolve([]),
          fetchRawTransaction: () => Promise.reject(new Error('backend down')),
        }),
      ),
    ).rejects.toThrow(/backend down/);
  });

  it('falls back to a hash-verified previous transaction when the UTXO list lags', async () => {
    const m = material(chain);
    const fund = fundingTx(chain, m.scripts.scriptPubKey, 100000, 14);
    const inputs = [{ tx: fund, vout: 0, value: 100000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 90000 },
    ]);
    const verified = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      depsFor(chain, inputs, { fetchOwnUtxos: () => Promise.resolve([]) }),
    );
    expect(verified.fee).toBe('10000');
  });
});

describe('UTXO-5: DOGE/RVN previous-transaction verification (poc_sighash_amounts)', () => {
  it.each([
    ['btc', true],
    ['ltc', true],
    ['bch', true],
    ['zec', true],
    ['flux', true],
    ['doge', false],
    ['rvn', false],
  ])('%s commits to input amounts: %s', (chain, commits) => {
    expect(sighashCommitsToInputAmount(chain)).toBe(commits);
    // Empirical anchor, as in the PoC: sign the same input with two claimed
    // amounts; identical signatures mean the amount is not committed.
    const m = material(chain);
    const net = network(chain);
    const sigFor = (amount) => {
      const txb = new utxolib.TransactionBuilder(net);
      if (isZcashLike(chain)) {
        txb.setVersion(4);
        txb.setVersionGroupId(0x892f2085);
      }
      txb.addInput(Buffer.alloc(32, 0x42).toString('hex'), 0);
      txb.addOutput(payee(), 1000);
      txb.sign(
        0,
        utxolib.ECPair.fromWIF(m.walletKp.privKey, net),
        m.scripts.redeemScript,
        hashTypeFor(chain),
        amount,
        m.scripts.witnessScript,
      );
      return txb.inputs[0].signatures.find(Boolean).toString('hex');
    };
    expect(sigFor(100000000) !== sigFor(5000)).toBe(commits);
  });

  it('refuses a tampered previous transaction (hash mismatch)', async () => {
    const chain = 'doge';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 1000000000000, 15);
    const inputs = [{ tx: f1, vout: 0, value: 1000000000000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 999900000000 },
    ]);
    const lied = f1.clone();
    lied.outs[0].value = 1000000000;
    await expect(
      verifyConsumerUtxoTransaction(
        raw,
        chain,
        m.keys,
        depsFor(chain, inputs, {
          fetchRawTransaction: () => Promise.resolve(lied.toHex()),
        }),
      ),
    ).rejects.toThrow(/hash mismatch/);
  });

  it('refuses a previous output that does not pay this address', async () => {
    const chain = 'rvn';
    const m = material(chain);
    const foreign = fundingTx(chain, payee(), 500000000, 16);
    const inputs = [{ tx: foreign, vout: 0, value: 500000000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 400000000 },
    ]);
    await expect(
      verifyConsumerUtxoTransaction(raw, chain, m.keys, depsFor(chain, inputs)),
    ).rejects.toThrow(/not owned by this wallet address/);
  });
});

describe('prevout fetches: deduplicated, bounded, reused at sign time', () => {
  /** One previous transaction paying `count` outputs to `script`. */
  function multiOutputFunding(chain, script, count, value, tag) {
    const tx = new utxolib.Transaction(network(chain));
    tx.addInput(Buffer.alloc(32, tag), 0);
    for (let i = 0; i < count; i += 1) tx.addOutput(script, value);
    return tx;
  }

  it('doge consolidation: one fetch per distinct previous tx, at most PREVOUT_FETCH_CONCURRENCY in flight', async () => {
    const chain = 'doge';
    const m = material(chain);
    const VALUE = 100000000; // 1 DOGE
    // 20 previous transactions with 3 of our outputs each = 60 inputs
    const prevTxs = Array.from({ length: 20 }, (_, i) =>
      multiOutputFunding(chain, m.scripts.scriptPubKey, 3, VALUE, 100 + i),
    );
    const inputs = prevTxs.flatMap((tx) =>
      [0, 1, 2].map((vout) => ({ tx, vout, value: VALUE })),
    );
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: inputs.length * VALUE - 10000000 },
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchRawTransaction = jest.fn(async (txid) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      const found = prevTxs.find((tx) => tx.getId() === txid);
      if (!found) throw new Error('not found');
      return found.toHex();
    });
    const deps = depsFor(chain, inputs, { fetchRawTransaction });
    const verified = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      deps,
    );
    expect(verified.fee).toBe('10000000');
    expect(fetchRawTransaction).toHaveBeenCalledTimes(prevTxs.length);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(PREVOUT_FETCH_CONCURRENCY);
    // 60 inputs are signed and verified: CPU-bound, and slower under CI coverage.
  }, 30_000);

  it('the signing pass reuses the display pass values (no second round of fetches)', async () => {
    const chain = 'doge';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 500000000, 120);
    const inputs = [{ tx: f1, vout: 0, value: 500000000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 400000000 },
    ]);
    const deps = depsFor(chain, inputs);
    const display = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      deps,
    );
    expect(deps.fetchRawTransaction).toHaveBeenCalledTimes(1);
    const signing = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      deps,
    );
    expect(deps.fetchRawTransaction).toHaveBeenCalledTimes(1);
    expect(signing.fee).toBe(display.fee);
  });

  it('a failed verification remembers nothing', async () => {
    const chain = 'btc';
    const m = material(chain);
    const fund = fundingTx(chain, m.scripts.scriptPubKey, 100000, 121);
    const inputs = [{ tx: fund, vout: 0, value: 100000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 90000 },
    ]);
    // backend under-values the input: the honest wallet signature refuses it
    const lying = depsFor(chain, inputs, {
      fetchOwnUtxos: () =>
        Promise.resolve([{ txid: fund.getId(), vout: 0, satoshis: '95000' }]),
    });
    await expect(
      verifyConsumerUtxoTransaction(raw, chain, m.keys, lying),
    ).rejects.toThrow(/wallet signature is invalid/);
    const honest = depsFor(chain, inputs);
    const ok = await verifyConsumerUtxoTransaction(raw, chain, m.keys, honest);
    expect(ok.fee).toBe('10000');
    expect(honest.fetchOwnUtxos).toHaveBeenCalledTimes(1);
  });

  it('two-approval attack (compromised wallet + backend, a different input under-valued each time) is refused', async () => {
    const chain = 'btc';
    const m = material(chain);
    const fa = fundingTx(chain, m.scripts.scriptPubKey, 600000, 122);
    const fb = fundingTx(chain, m.scripts.scriptPubKey, 600000, 123);
    const inputs = [
      { tx: fa, vout: 0, value: 600000 },
      { tx: fb, vout: 0, value: 600000 },
    ];
    const outputs = [{ script: payee(), value: 1000000 }]; // real fee 200,000
    const backend = (a, b) =>
      depsFor(chain, inputs, {
        fetchOwnUtxos: () =>
          Promise.resolve([
            { txid: fa.getId(), vout: 0, satoshis: String(a) },
            { txid: fb.getId(), vout: 0, satoshis: String(b) },
          ]),
      });
    // approval 1: input A under-valued -> shown fee 20,000; B's key
    // signature would be valid on chain
    const raw1 = walletBuild(chain, m, inputs, outputs, {
      signValues: [420000, 600000],
    });
    const first = await verifyConsumerUtxoTransaction(
      raw1,
      chain,
      m.keys,
      backend(420000, 600000),
    );
    expect(first.fee).toBe('20000');
    // approval 2: now B under-valued, A true -> A's key signature would be
    // valid on chain; combined with approval 1 the real 200,000 fee confirms
    const raw2 = walletBuild(chain, m, inputs, outputs, {
      signValues: [600000, 420000],
    });
    await expect(
      verifyConsumerUtxoTransaction(
        raw2,
        chain,
        m.keys,
        backend(600000, 420000),
      ),
    ).rejects.toThrow(/wallet signature is invalid/);
  });
});

describe('UTXO-8: shielded data and wallet partial signatures', () => {
  it('refuses Zcash/Flux transactions with a shielded value balance', async () => {
    const chain = 'flux';
    const m = material(chain);
    const fund = fundingTx(chain, m.scripts.scriptPubKey, 100000, 17);
    const inputs = [{ tx: fund, vout: 0, value: 100000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 90000 },
    ]);
    const tx = utxolib.Transaction.fromHex(raw, network(chain));
    tx.valueBalance = 5000;
    await expect(
      verifyConsumerUtxoTransaction(
        tx.toHex(),
        chain,
        m.keys,
        depsFor(chain, inputs),
      ),
    ).rejects.toThrow(/Shielded/);
  });

  it('refuses an input without the wallet signature', async () => {
    const chain = 'btc';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 100000, 18);
    const f2 = fundingTx(chain, m.scripts.scriptPubKey, 100000, 19);
    const inputs = [
      { tx: f1, vout: 0, value: 100000 },
      { tx: f2, vout: 0, value: 100000 },
    ];
    const raw = walletBuild(
      chain,
      m,
      inputs,
      [{ script: payee(), value: 190000 }],
      { skipSignIndex: 1 },
    );
    await expect(
      verifyConsumerUtxoTransaction(raw, chain, m.keys, depsFor(chain, inputs)),
    ).rejects.toThrow(/Input 1/);
  });

  it('refuses a wallet signature over a different amount (invalid)', async () => {
    const chain = 'btc';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 100000, 20);
    const inputs = [{ tx: f1, vout: 0, value: 100000 }];
    const raw = walletBuild(
      chain,
      m,
      inputs,
      [{ script: payee(), value: 90000 }],
      { signValue: 100001 },
    );
    await expect(
      verifyConsumerUtxoTransaction(raw, chain, m.keys, depsFor(chain, inputs)),
    ).rejects.toThrow(/wallet signature is invalid/);
  });

  it('refuses a wallet signature with a non-ALL sighash type', async () => {
    const chain = 'flux';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 100000, 21);
    const inputs = [{ tx: f1, vout: 0, value: 100000 }];
    const raw = walletBuild(
      chain,
      m,
      inputs,
      [{ script: payee(), value: 90000 }],
      { hashType: utxolib.Transaction.SIGHASH_NONE },
    );
    await expect(
      verifyConsumerUtxoTransaction(raw, chain, m.keys, depsFor(chain, inputs)),
    ).rejects.toThrow(/non-ALL sighash/);
  });
});
