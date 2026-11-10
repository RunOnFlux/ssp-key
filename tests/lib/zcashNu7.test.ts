// @ts-nocheck test suite — utxo-lib ships no types
/**
 * Zcash NU7 (mainnet 2026-11-05): ZIP 2003 made v4 transactions invalid, so
 * ZEC is sent as v5 (ZIP 225 encoding, ZIP 244 txid + signature digests).
 * ZIP 244 signatures commit to the value AND scriptPubKey of EVERY input, so
 * the key must set them (`setPrevouts`) from its own data before verifying the
 * wallet's partial signatures or adding its own. Flux stays v4.
 */
import fs from 'fs';
import path from 'path';
import utxolib from '@runonflux/utxo-lib';
import { Buffer } from 'buffer';
import { blockchains } from '../../src/storage/blockchains';
import {
  generateAddressKeypair,
  getMasterXpriv,
  getMasterXpub,
} from '../../src/lib/wallet';
import {
  assertTransparentOnly,
  clearConsumerUtxoValueCache,
  deriveConsumerUtxoScripts,
  setZip244PrevoutsIfNeeded,
  verifyConsumerUtxoTransaction,
} from '../../src/lib/consumerUtxo';
import {
  finaliseTransaction,
  signTransaction,
} from '../../src/lib/constructTx';
import { checkVaultUtxoTransaction } from '../../src/lib/vaultDescriptorGate';
import { deriveVaultAddress } from '../../src/lib/vaultDescriptor';
import { verifyVaultUtxoAmounts } from '../../src/lib/vaultUtxoAmounts';

const WALLET_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KEY_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const NU7_BRANCH_ID = 0x77190ad9;
const SIGHASH_ALL = utxolib.Transaction.SIGHASH_ALL;

const net = (chain) => utxolib.networks[blockchains[chain].libid];

function material(chain) {
  const cfg = blockchains[chain];
  const xpub = (mn) =>
    getMasterXpub(mn, 48, cfg.slip, 0, cfg.scriptType, chain);
  const xpriv = (mn) =>
    getMasterXpriv(mn, 48, cfg.slip, 0, cfg.scriptType, chain);
  const keys = {
    path: '0-3',
    xpubWallet: xpub(WALLET_MNEMONIC),
    xpubKey: xpub(KEY_MNEMONIC),
  };
  return {
    keys,
    scripts: deriveConsumerUtxoScripts(chain, keys),
    walletKp: generateAddressKeypair(xpriv(WALLET_MNEMONIC), 0, 3, chain),
    keyKp: generateAddressKeypair(xpriv(KEY_MNEMONIC), 0, 3, chain),
  };
}

/** A v5 (ZEC) or v4 (Flux) previous transaction paying `value` to `script`. */
function fundingTx(chain, script, value, tag) {
  const tx = new utxolib.Transaction(net(chain));
  tx.overwintered = 1;
  if (chain === 'zec') {
    tx.version = 5;
    tx.versionGroupId = 0x26a7270a;
    tx.consensusBranchId = NU7_BRANCH_ID;
  } else {
    tx.version = 4;
    tx.versionGroupId = 0x892f2085;
  }
  tx.addInput(Buffer.alloc(32, tag), 0);
  tx.addOutput(script, value);
  return tx;
}

const payee = () =>
  utxolib.script.scriptHash.output.encode(
    utxolib.crypto.hash160(Buffer.from('payee')),
  );

/**
 * SSP Wallet: build like the wallet does (version from the chain config) and
 * sign every input. `claimed` = the values the wallet commits to (ZIP 244).
 */
function walletBuild(chain, m, inputs, outputs, opts = {}) {
  const network = net(chain);
  const txb = new utxolib.TransactionBuilder(network);
  txb.setVersion(opts.version ?? blockchains[chain].txVersion);
  if ((opts.version ?? blockchains[chain].txVersion) === 4) {
    txb.setVersionGroupId(0x892f2085);
  }
  inputs.forEach((input) => txb.addInput(input.tx.getId(), input.vout));
  outputs.forEach((out) => txb.addOutput(out.script, out.value));
  const claimed = opts.claimed ?? inputs.map((input) => input.value);
  if (txb.tx.isZcashV5()) {
    txb.setPrevouts(
      claimed.map((value) => ({ value, script: m.scripts.scriptPubKey })),
    );
  }
  const walletPair = utxolib.ECPair.fromWIF(m.walletKp.privKey, network);
  inputs.forEach((_, i) =>
    txb.sign(i, walletPair, m.scripts.redeemScript, SIGHASH_ALL, claimed[i]),
  );
  return txb.buildIncomplete().toHex();
}

function deps(inputs, overrides = {}) {
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
      return found
        ? Promise.resolve(found.tx.toHex())
        : Promise.reject(new Error('not found'));
    }),
    getUsdRate: jest.fn(() => Promise.resolve(0)),
    ...overrides,
  };
}

/**
 * Independent check of a fully signed P2SH 2-of-N input set: every signature
 * verifies against the ZIP 244 digest over the TRUE values / scriptPubKeys.
 * Returns, per input, whether each signature is valid.
 */
function zip244Validity(chain, finalHex, prevouts) {
  const tx = utxolib.Transaction.fromHex(finalHex, net(chain));
  tx.setZip244Prevouts(prevouts);
  return tx.ins.map((input, i) => {
    const chunks = utxolib.script.decompile(input.script);
    const redeemScript = chunks[chunks.length - 1];
    const pubKeys = utxolib.script.multisig.output.decode(redeemScript).pubKeys;
    const hash = tx.hashForZcashSignature(
      i,
      redeemScript,
      prevouts[i].value,
      SIGHASH_ALL,
    );
    // OP_0 <sig>... <redeemScript>: each sig must verify for some pubkey
    return chunks.slice(1, -1).map((sig) => {
      const parsed = utxolib.ECSignature.parseScriptSignature(sig);
      return (
        parsed.hashType === SIGHASH_ALL &&
        pubKeys.some((pk) =>
          utxolib.ECPair.fromPublicKeyBuffer(pk, net(chain)).verify(
            hash,
            parsed.signature,
          ),
        )
      );
    });
  });
}

beforeEach(() => {
  clearConsumerUtxoValueCache();
});

describe('chain config', () => {
  it('ZEC is v5 (NU7) and Flux stays v4', () => {
    expect(blockchains.zec.txVersion).toBe(5);
    expect(blockchains.zec.txGroupID).toBe(0x26a7270a);
    expect(net('zec').consensusBranchId[5]).toBe(NU7_BRANCH_ID);
    expect(blockchains.flux.txVersion).toBe(4);
    expect(blockchains.flux.txGroupID).toBe(0x892f2085);
  });
});

describe('consumer ZEC v5 2-of-2', () => {
  const chain = 'zec';

  it('verifies the wallet half and co-signs; both signatures verify under ZIP 244', async () => {
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
    const verified = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      deps(inputs),
    );
    expect(verified.fee).toBe('5000');

    const signed = signTransaction(raw, chain, m.keyKp.privKey, verified);
    const finalHex = finaliseTransaction(signed, chain);
    const final = utxolib.Transaction.fromHex(finalHex, net(chain));
    expect(final.version).toBe(5);
    expect(final.versionGroupId).toBe(0x26a7270a);
    expect(final.consensusBranchId).toBe(NU7_BRANCH_ID);
    expect(finalHex.slice(0, 24)).toBe('050000800a27a726d90a1977');

    const validity = zip244Validity(chain, finalHex, [
      { value: 150000, script: m.scripts.scriptPubKey },
      { value: 90000, script: m.scripts.scriptPubKey },
    ]);
    expect(validity).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it('refuses when its own backend values disagree with what the wallet signed', async () => {
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 150000, 3);
    const f2 = fundingTx(chain, m.scripts.scriptPubKey, 90000, 4);
    const inputs = [
      { tx: f1, vout: 0, value: 150000 },
      { tx: f2, vout: 0, value: 90000 },
    ];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 230000 },
    ]);
    // A lying backend under-values input 1 only. Input 0's wallet signature
    // already fails: ZIP 244 commits to every input's amount.
    const lying = inputs.map((input, i) =>
      i === 1 ? { ...input, value: 80000 } : input,
    );
    await expect(
      verifyConsumerUtxoTransaction(
        raw,
        chain,
        m.keys,
        deps(inputs, { fetchOwnUtxos: deps(lying).fetchOwnUtxos }),
      ),
    ).rejects.toThrow(/Input 0 wallet signature is invalid/);
  });

  it('compromised wallet + backend under-valuing an input: what the key signs is invalid on chain', async () => {
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 150000, 5);
    const f2 = fundingTx(chain, m.scripts.scriptPubKey, 90000, 6);
    const truth = [
      { tx: f1, vout: 0, value: 150000 },
      { tx: f2, vout: 0, value: 90000 },
    ];
    const lies = [truth[0], { ...truth[1], value: 10000 }];
    // Real fee 80,000; the key is shown 0 (both sides lie consistently).
    const raw = walletBuild(
      chain,
      m,
      truth,
      [{ script: payee(), value: 160000 }],
      { claimed: [150000, 10000] },
    );
    const verified = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      deps(lies),
    );
    expect(verified.fee).toBe('0');
    const finalHex = finaliseTransaction(
      signTransaction(raw, chain, m.keyKp.privKey, verified),
      chain,
    );
    // Under the real input values no signature verifies — not even input
    // 0's, whose own amount was told truthfully.
    const validity = zip244Validity(chain, finalHex, [
      { value: 150000, script: m.scripts.scriptPubKey },
      { value: 90000, script: m.scripts.scriptPubKey },
    ]);
    expect(validity.flat().every((ok) => ok === false)).toBe(true);
  });

  it('refuses a v4 ZEC transaction (invalid since NU7) with a clear message', async () => {
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 150000, 7);
    const inputs = [{ tx: f1, vout: 0, value: 150000 }];
    const raw = walletBuild(
      chain,
      m,
      inputs,
      [{ script: payee(), value: 140000 }],
      { version: 4 },
    );
    expect(raw.slice(0, 8)).toBe('04000080');
    await expect(
      verifyConsumerUtxoTransaction(raw, chain, m.keys, deps(inputs)),
    ).rejects.toThrow(/must be version 5/);
  });

  it('refuses a v5 transaction with shielded (Sapling/Orchard) components', async () => {
    const { txHex } = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'zip244-shielded-vector.json'),
        'utf8',
      ),
    );
    const tx = utxolib.Transaction.fromHex(txHex, net(chain));
    expect(tx.version).toBe(5);
    expect(tx.sapling.spends.length).toBe(1);
    expect(() => assertTransparentOnly(tx)).toThrow(/Shielded/);
    const m = material(chain);
    await expect(
      verifyConsumerUtxoTransaction(txHex, chain, m.keys, deps([])),
    ).rejects.toThrow(/Shielded/);

    // Orchard actions are refused the same way.
    const orchardOnly = utxolib.Transaction.fromHex(txHex, net(chain));
    orchardOnly.sapling.spends = [];
    orchardOnly.orchard.actions = [{}];
    expect(() => assertTransparentOnly(orchardOnly)).toThrow(/Shielded/);
  });

  it('values an input missing from the UTXO list from a hash-checked v5 previous transaction', async () => {
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 150000, 8);
    const inputs = [{ tx: f1, vout: 0, value: 150000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 140000 },
    ]);
    const lagging = deps(inputs, {
      fetchOwnUtxos: jest.fn(() => Promise.resolve([])),
    });
    const verified = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      lagging,
    );
    expect(lagging.fetchRawTransaction).toHaveBeenCalledWith(f1.getId(), chain);
    expect(verified.fee).toBe('10000');

    // A tampered v5 previous transaction no longer matches its ZIP 244 txid.
    clearConsumerUtxoValueCache();
    const lied = fundingTx(chain, m.scripts.scriptPubKey, 900000, 8);
    await expect(
      verifyConsumerUtxoTransaction(
        raw,
        chain,
        m.keys,
        deps(inputs, {
          fetchOwnUtxos: jest.fn(() => Promise.resolve([])),
          fetchRawTransaction: () => Promise.resolve(lied.toHex()),
        }),
      ),
    ).rejects.toThrow(/hash mismatch/);
  });
});

describe('consumer Flux stays v4', () => {
  it('signs and verifies a v4 Flux 2-of-2 exactly as before', async () => {
    const chain = 'flux';
    const m = material(chain);
    const f1 = fundingTx(chain, m.scripts.scriptPubKey, 500000, 9);
    const inputs = [{ tx: f1, vout: 0, value: 500000 }];
    const raw = walletBuild(chain, m, inputs, [
      { script: payee(), value: 490000 },
    ]);
    expect(raw.slice(0, 16)).toBe('0400008085202f89');
    const verified = await verifyConsumerUtxoTransaction(
      raw,
      chain,
      m.keys,
      deps(inputs),
    );
    const finalHex = finaliseTransaction(
      signTransaction(raw, chain, m.keyKp.privKey, verified),
      chain,
    );
    const final = utxolib.Transaction.fromHex(finalHex, net(chain));
    expect(final.version).toBe(4);
    expect(final.isZcashV5()).toBe(false);
    // v4 / ZIP 243 digest, which needs no prevouts
    const chunks = utxolib.script.decompile(final.ins[0].script);
    const hash = final.hashForZcashSignature(
      0,
      m.scripts.redeemScript,
      500000,
      SIGHASH_ALL,
    );
    const sigs = chunks
      .slice(1, -1)
      .map((s) => utxolib.ECSignature.parseScriptSignature(s).signature);
    [m.scripts.walletPubKey, m.scripts.keyPubKey].forEach((pk) => {
      const pair = utxolib.ECPair.fromPublicKeyBuffer(pk, net(chain));
      expect(sigs.some((sig) => pair.verify(hash, sig))).toBe(true);
    });
    // setZip244PrevoutsIfNeeded is a no-op for v4
    const txb = utxolib.TransactionBuilder.fromTransaction(final, net(chain));
    expect(() =>
      setZip244PrevoutsIfNeeded(txb, [1], [m.scripts.scriptPubKey]),
    ).not.toThrow();
  });
});

describe('enterprise ZEC v5 vault (2-of-3 P2SH)', () => {
  const V = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, 'fixtures', 'vd-vectors.json'),
      'utf8',
    ),
  );
  const FLUX = V.vectors.find((v) => v.name === 'flux-p2sh-key_only-2of3');
  // Same xpubs, ZEC chain: derivation and scripts are chain-agnostic P2SH.
  const descriptor = { ...FLUX.descriptor, chain: 'zec' };
  const member = (name) => V.members.find((x) => x.name === name);
  const vaultPair = (name, addressIndex) => {
    const xpriv = getMasterXpriv(
      member(name).keyMnemonic,
      48,
      blockchains.flux.slip,
      descriptor.orgIndex,
      'p2sh',
      'flux',
    );
    const kp = generateAddressKeypair(
      xpriv,
      descriptor.vaultIndex,
      addressIndex,
      'zec',
    );
    return utxolib.ECPair.fromWIF(kp.privKey, net('zec'));
  };

  it('mirrors handleVaultSignAction: prevouts from the derived scripts, both signatures valid', async () => {
    const at = (i) => deriveVaultAddress(descriptor, descriptor.vaultIndex, i);
    const a0 = at(0);
    const a1 = at(1);
    const values = [700000, 300000];
    const network = net('zec');

    // The proposer's builder (enterprise app) + first signer (bob's wallet).
    const txb = new utxolib.TransactionBuilder(network);
    txb.setVersion(5);
    txb.addInput('11'.repeat(32), 0);
    txb.addInput('22'.repeat(32), 1);
    txb.addOutput(payee(), 900000);
    txb.addOutput(Buffer.from(a0.scriptPubKey, 'hex'), 95000);
    const rawUnsignedTx = txb.buildIncomplete().toHex();
    const inputDetails = [
      {
        index: 0,
        addressIndex: 0,
        redeemScript: a0.redeemScript,
        amount: '700000',
      },
      {
        index: 1,
        addressIndex: 1,
        redeemScript: a1.redeemScript,
        amount: '300000',
      },
    ];
    txb.setPrevouts([
      { value: values[0], script: Buffer.from(a0.scriptPubKey, 'hex') },
      { value: values[1], script: Buffer.from(a1.scriptPubKey, 'hex') },
    ]);
    [a0, a1].forEach((a, i) =>
      txb.sign(
        i,
        vaultPair('bob', i),
        Buffer.from(a.redeemScript, 'hex'),
        SIGHASH_ALL,
        values[i],
      ),
    );
    const walletSignedHex = txb.buildIncomplete().toHex();

    // The Key (alice), step by step as in handleVaultSignAction.
    const utxoCheck = checkVaultUtxoTransaction(
      descriptor,
      rawUnsignedTx,
      inputDetails,
    );
    expect(utxoCheck.ok).toBe(true);
    const amountCheck = await verifyVaultUtxoAmounts(
      'zec',
      rawUnsignedTx,
      inputDetails,
      utxoCheck.inputs,
      {
        fetchRawTransaction: jest.fn(() => Promise.reject(new Error('no'))),
        getUsdRate: jest.fn(() => Promise.resolve(0)),
      },
    );
    expect(amountCheck).toMatchObject({ ok: true, amounts: values });
    const signedTx = utxolib.Transaction.fromHex(walletSignedHex, network);
    const keyTxb = utxolib.TransactionBuilder.fromTransaction(
      signedTx,
      network,
    );
    // Without prevouts utxo-lib refuses to sign a v5 input.
    expect(() =>
      keyTxb.sign(
        0,
        vaultPair('alice', 0),
        Buffer.from(a0.redeemScript, 'hex'),
        SIGHASH_ALL,
        values[0],
      ),
    ).toThrow(/setPrevouts/);
    setZip244PrevoutsIfNeeded(
      keyTxb,
      amountCheck.amounts,
      utxoCheck.inputs.map((d) => Buffer.from(d.scriptPubKey, 'hex')),
    );
    utxoCheck.inputs.forEach((derived, i) =>
      keyTxb.sign(
        i,
        vaultPair('alice', derived.addressIndex),
        Buffer.from(derived.redeemScript, 'hex'),
        SIGHASH_ALL,
        amountCheck.amounts[i],
      ),
    );
    const finalHex = keyTxb.build().toHex();
    const validity = zip244Validity('zec', finalHex, [
      { value: values[0], script: Buffer.from(a0.scriptPubKey, 'hex') },
      { value: values[1], script: Buffer.from(a1.scriptPubKey, 'hex') },
    ]);
    expect(validity).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it('refuses a v4 ZEC vault transaction and a shielded one', () => {
    const a0 = deriveVaultAddress(descriptor, descriptor.vaultIndex, 0);
    const txb = new utxolib.TransactionBuilder(net('zec'));
    txb.setVersion(4);
    txb.setVersionGroupId(0x892f2085);
    txb.addInput('11'.repeat(32), 0);
    txb.addOutput(payee(), 900000);
    const res = checkVaultUtxoTransaction(
      descriptor,
      txb.buildIncomplete().toHex(),
      [
        {
          index: 0,
          addressIndex: 0,
          redeemScript: a0.redeemScript,
          amount: '1000000',
        },
      ],
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/must be version 5/);

    const { txHex } = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'zip244-shielded-vector.json'),
        'utf8',
      ),
    );
    const shielded = checkVaultUtxoTransaction(descriptor, txHex, []);
    expect(shielded.ok).toBe(false);
    expect(shielded.reason).toMatch(/Shielded/);
  });
});
