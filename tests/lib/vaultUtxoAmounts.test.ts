// @ts-nocheck test suite — utxo-lib ships no types
/**
 * Review round 1, Key item 2: enterprise DOGE/RVN vault fees trusted the
 * relay's inputDetails[].amount. Legacy P2SH sighashes do not commit to input
 * amounts, so an under-stated amount still yields a valid Key signature on a
 * transaction whose real fee is far higher than the one shown.
 *
 * verifyVaultUtxoAmounts checks each amount against a hash-verified previous
 * transaction paying the input's derived vault script (DOGE/RVN), and caps
 * the fee on every UTXO vault chain.
 */
import utxolib from '@runonflux/utxo-lib';
import { Buffer } from 'buffer';
import { blockchains } from '../../src/storage/blockchains';
import { verifyVaultUtxoAmounts } from '../../src/lib/vaultUtxoAmounts';
import { VAULT_MAX_FEE_USD } from '../../src/lib/consumerGuards';

const network = (chain) => utxolib.networks[blockchains[chain].libid];

function vaultScripts(chain, seed) {
  const net = network(chain);
  const keys = [1, 2, 3].map((i) =>
    utxolib.ECPair.fromPrivateKeyBuffer
      ? utxolib.ECPair.fromPrivateKeyBuffer(Buffer.alloc(32, seed + i), net)
      : utxolib.ECPair.makeRandom({ network: net }),
  );
  const multisig = utxolib.script.multisig.output.encode(
    2,
    keys.map((k) => k.getPublicKeyBuffer()),
  );
  if (blockchains[chain].scriptType === 'p2wsh') {
    return {
      witnessScript: multisig.toString('hex'),
      scriptPubKey: utxolib.script.witnessScriptHash.output
        .encode(utxolib.crypto.sha256(multisig))
        .toString('hex'),
    };
  }
  return {
    redeemScript: multisig.toString('hex'),
    scriptPubKey: utxolib.script.scriptHash.output
      .encode(utxolib.crypto.hash160(multisig))
      .toString('hex'),
  };
}

function fundingTx(chain, scriptHex, values, tag) {
  const tx = new utxolib.Transaction(network(chain));
  tx.addInput(Buffer.alloc(32, tag), 0);
  values.forEach((value) => tx.addOutput(Buffer.from(scriptHex, 'hex'), value));
  return tx;
}

const PAYEE = utxolib.script.scriptHash.output.encode(
  utxolib.crypto.hash160(Buffer.from('payee')),
);

function spend(chain, prevouts, outputs) {
  const txb = new utxolib.TransactionBuilder(network(chain));
  prevouts.forEach(({ tx, vout }) => txb.addInput(tx.getId(), vout));
  outputs.forEach((value) => txb.addOutput(PAYEE, value));
  return txb.buildIncomplete().toHex();
}

function deps(prevTxs, rate = 0, overrides = {}) {
  return {
    fetchRawTransaction: jest.fn((txid) => {
      const found = prevTxs.find((tx) => tx.getId() === txid);
      return found
        ? Promise.resolve(found.toHex())
        : Promise.reject(new Error('not found'));
    }),
    getUsdRate: jest.fn(() => Promise.resolve(rate)),
    ...overrides,
  };
}

const details = (scripts, amounts) =>
  amounts.map((amount, index) => ({
    index,
    addressIndex: 0,
    ...(scripts.redeemScript ? { redeemScript: scripts.redeemScript } : {}),
    ...(scripts.witnessScript ? { witnessScript: scripts.witnessScript } : {}),
    amount,
  }));

const derived = (scripts, count) =>
  Array.from({ length: count }, () => ({
    addressIndex: 0,
    redeemScript: scripts.redeemScript,
    witnessScript: scripts.witnessScript,
    scriptPubKey: scripts.scriptPubKey,
  }));

describe.each(['doge', 'rvn'])(
  '%s vault (sighash ignores input amounts)',
  (chain) => {
    const scripts = vaultScripts(chain, 0x10);
    const COIN = 100000000;
    const fund = fundingTx(chain, scripts.scriptPubKey, [10000 * COIN], 1);
    const raw = spend(chain, [{ tx: fund, vout: 0 }], [9999 * COIN]);

    it('accepts amounts that match the hash-verified previous transaction', async () => {
      const d = deps([fund]);
      const result = await verifyVaultUtxoAmounts(
        chain,
        raw,
        details(scripts, [String(10000 * COIN)]),
        derived(scripts, 1),
        d,
      );
      expect(result).toEqual({
        ok: true,
        amounts: [10000 * COIN],
        fee: String(COIN),
        maxFee: String(blockchains[chain].maxFee),
      });
      expect(d.fetchRawTransaction).toHaveBeenCalledWith(fund.getId(), chain);
    });

    it('refuses an amount the relay under-stated (hidden fee)', async () => {
      // the relay claims 9,999.5 so the screen would show a 0.5 fee while the
      // real fee is 1 coin; with bigger inputs it is the whole difference
      const result = await verifyVaultUtxoAmounts(
        chain,
        raw,
        details(scripts, [String(9999.5 * COIN)]),
        derived(scripts, 1),
        deps([fund]),
      );
      expect(result).toEqual({
        ok: false,
        reason: 'input 0 amount does not match its previous transaction',
      });
    });

    it('refuses a tampered previous transaction (hash mismatch)', async () => {
      const lied = fund.clone();
      lied.outs[0].value = 9999.5 * COIN;
      const result = await verifyVaultUtxoAmounts(
        chain,
        raw,
        details(scripts, [String(9999.5 * COIN)]),
        derived(scripts, 1),
        deps([fund], 0, {
          fetchRawTransaction: () => Promise.resolve(lied.toHex()),
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/hash mismatch/);
    });

    it('refuses a previous output that does not pay the derived vault script', async () => {
      const other = vaultScripts(chain, 0x40);
      const foreign = fundingTx(chain, other.scriptPubKey, [10000 * COIN], 2);
      const foreignRaw = spend(
        chain,
        [{ tx: foreign, vout: 0 }],
        [9999 * COIN],
      );
      const result = await verifyVaultUtxoAmounts(
        chain,
        foreignRaw,
        details(scripts, [String(10000 * COIN)]),
        derived(scripts, 1),
        deps([foreign]),
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/not owned by this wallet address/);
    });

    it('fails closed when the previous transaction cannot be fetched', async () => {
      const result = await verifyVaultUtxoAmounts(
        chain,
        raw,
        details(scripts, [String(10000 * COIN)]),
        derived(scripts, 1),
        deps([]),
      );
      expect(result.ok).toBe(false);
    });

    it('caps the fee at the chain maxFee even when every amount is true', async () => {
      const big = fundingTx(chain, scripts.scriptPubKey, [100000 * COIN], 3);
      const rawBig = spend(
        chain,
        [{ tx: big, vout: 0 }],
        [100000 * COIN - blockchains[chain].maxFee - 1],
      );
      const result = await verifyVaultUtxoAmounts(
        chain,
        rawBig,
        details(scripts, [String(100000 * COIN)]),
        derived(scripts, 1),
        deps([big]),
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/exceeds the maximum/);
    });

    it('fetches each distinct previous transaction once', async () => {
      const multi = fundingTx(
        chain,
        scripts.scriptPubKey,
        [5 * COIN, 5 * COIN, 5 * COIN],
        4,
      );
      const rawMulti = spend(
        chain,
        [0, 1, 2].map((vout) => ({ tx: multi, vout })),
        [15 * COIN - 1000000],
      );
      const d = deps([multi]);
      const result = await verifyVaultUtxoAmounts(
        chain,
        rawMulti,
        details(
          scripts,
          [5, 5, 5].map((v) => String(v * COIN)),
        ),
        derived(scripts, 3),
        d,
      );
      expect(result.ok).toBe(true);
      expect(d.fetchRawTransaction).toHaveBeenCalledTimes(1);
    });
  },
);

describe('amount-committing vault chains (btc)', () => {
  const chain = 'btc';
  const scripts = vaultScripts(chain, 0x20);
  const fund = fundingTx(chain, scripts.scriptPubKey, [1000000], 5);
  const raw = spend(chain, [{ tx: fund, vout: 0 }], [990000]);

  it('uses the committed amounts without fetching previous transactions', async () => {
    const d = deps([]);
    const result = await verifyVaultUtxoAmounts(
      chain,
      raw,
      details(scripts, ['1000000']),
      derived(scripts, 1),
      d,
    );
    expect(result).toMatchObject({ ok: true, fee: '10000' });
    expect(d.fetchRawTransaction).not.toHaveBeenCalled();
  });

  it(`applies the $${VAULT_MAX_FEE_USD} vault USD cap below the chain cap`, async () => {
    // 0.009 BTC fee: under maxFee (0.01 BTC), above $1000 at $200k
    const pricey = spend(chain, [{ tx: fund, vout: 0 }], [100000]);
    const result = await verifyVaultUtxoAmounts(
      chain,
      pricey,
      details(scripts, ['1000000']),
      derived(scripts, 1),
      deps([], 200000),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/exceeds the maximum of 500000/);
    const ok = await verifyVaultUtxoAmounts(
      chain,
      pricey,
      details(scripts, ['1000000']),
      derived(scripts, 1),
      deps([], 0),
    );
    expect(ok).toMatchObject({ ok: true, fee: '900000' });
  });

  it.each([
    ['missing', undefined],
    ['zero', '0'],
    ['negative', '-5'],
    ['fractional', '1.5'],
    ['garbage', 'lots'],
  ])('refuses a %s input amount', async (_label, amount) => {
    const result = await verifyVaultUtxoAmounts(
      chain,
      raw,
      details(scripts, [amount]),
      derived(scripts, 1),
      deps([]),
    );
    expect(result).toEqual({
      ok: false,
      reason: 'input 0 has no valid amount',
    });
  });

  it('refuses outputs above the inputs', async () => {
    const result = await verifyVaultUtxoAmounts(
      chain,
      raw,
      details(scripts, ['900000']),
      derived(scripts, 1),
      deps([]),
    );
    expect(result).toEqual({
      ok: false,
      reason: 'the transaction outputs exceed its inputs',
    });
  });

  it('refuses input details that do not match the transaction', async () => {
    const result = await verifyVaultUtxoAmounts(
      chain,
      raw,
      details(scripts, ['500000', '500000']),
      derived(scripts, 2),
      deps([]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/do not match the transaction inputs/);
  });
});
