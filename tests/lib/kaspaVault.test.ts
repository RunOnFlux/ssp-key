import * as K from '@runonflux/kaspa-core';
import {
  decodeVaultKasTransaction,
  kasVaultIndicesError,
  signKasVaultBundle,
  verifyKasVaultBundle,
} from '../../src/lib/kaspaVault';
import { KasLedgerConflictError } from '../../src/lib/kaspaLedger';
import { generateAddressKeypair } from '../../src/lib/wallet';
import {
  KAS,
  MNEMONIC_KK,
  MNEMONIC_S3,
  MNEMONIC_W,
  MNEMONIC_Z,
  buildTx,
  fakeUtxo,
  kasXpriv,
  leafSigner,
  memoryLedger,
  recipientAddress,
} from './kaspaFixtures';

/**
 * Enterprise M-of-N flow (contract §5), org 100, vault 0: the single-device
 * 2-of-3 vector vault (W, Kk, S3). The backend builds the unsigned bundle
 * (rawUnsignedTx), W signs first (walletSignedHex), SSP Key (Kk) co-signs.
 */

const ORG = 100;
const VAULT = 0;
const xprivs = {
  W: kasXpriv(MNEMONIC_W, ORG),
  Kk: kasXpriv(MNEMONIC_KK, ORG),
  S3: kasXpriv(MNEMONIC_S3, ORG),
  Z: kasXpriv(MNEMONIC_Z, ORG),
};
const leafKey = (xpriv: string, addressIndex: number) =>
  K.hexToBytes(generateAddressKeypair(xpriv, VAULT, addressIndex, KAS).pubKey);
const vaultSpend = (addressIndex: number) =>
  K.multisigSpend(
    [xprivs.W, xprivs.Kk, xprivs.S3].map((x) => leafKey(x, addressIndex)),
    2,
  );
const spend0 = vaultSpend(0);
const spend1 = vaultSpend(1);
const to = recipientAddress(9);

type Utxo = ReturnType<typeof fakeUtxo>;
const redeemHex = (s: K.Spend) =>
  s.kind === 'p2sh-multisig' ? K.bytesToHex(s.redeem) : '';

async function proposal(
  claimed: Utxo[],
  addressIndices: number[],
  pay = 300000000n,
  fee = 30000n,
) {
  const tx = buildTx(claimed, to, pay, fee, claimed[0].spend);
  const unsigned = JSON.stringify(K.createSigningBundle(tx, claimed, []));
  const signers = [...new Set(addressIndices)].map((i) =>
    leafSigner(xprivs.W, VAULT, i),
  );
  const partials = await K.signTransaction(tx, claimed, signers);
  signers.forEach((s) => s.destroy());
  const walletSigned = JSON.stringify(
    K.createSigningBundle(tx, claimed, partials),
  );
  return {
    tx,
    data: {
      chain: KAS,
      orgIndex: ORG,
      vaultIndex: VAULT,
      rawUnsignedTx: unsigned,
      walletSignedHex: walletSigned,
      inputDetails: JSON.stringify(
        claimed.map((u, index) => ({
          index,
          addressIndex: addressIndices[index],
          redeemScript: redeemHex(u.spend),
          amount: u.entry.amount.toString(),
        })),
      ),
      recipients: [{ address: to, amount: pay.toString() }],
      fee: fee.toString(),
    },
  };
}

const lookup = (utxos: Utxo[]) =>
  jest.fn((addresses: string[]) =>
    Promise.resolve(utxos.filter((u) => addresses.includes(u.address))),
  );

describe('Kaspa vault decode', () => {
  it('opens with its own lookup and matches the relay payload', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const fetch = lookup(utxos);
    const { decoded, state } = await decodeVaultKasTransaction(data, fetch);
    expect(fetch).toHaveBeenCalledWith([utxos[0].address]);
    expect(state).toEqual({ status: 'ok', reasons: [], warnings: [] });
    expect(decoded).toEqual({
      sender: utxos[0].address,
      recipients: [{ address: to, amount: '300000000' }],
      fee: '30000',
    });
  });

  it('fails when the relay recipients differ from the bundle', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const { state, decoded } = await decodeVaultKasTransaction(
      { ...data, recipients: [{ address: to, amount: '300000001' }] },
      lookup(utxos),
    );
    expect(state.status).toBe('failed');
    expect(state.reasons).toContain('recipients differ from the proposal');
    expect(decoded.error).toBeTruthy();
  });

  it('fails when the relay fee differs from the bundle', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const { state } = await decodeVaultKasTransaction(
      { ...data, fee: '1' },
      lookup(utxos),
    );
    expect(state.status).toBe('failed');
  });

  it('fails when the bundle lies about an input amount', async () => {
    const real = fakeUtxo(spend0, 5000000000n);
    const lie = { ...real, entry: { ...real.entry, amount: 500000000n } };
    const { data } = await proposal([lie], [0]);
    const { state } = await decodeVaultKasTransaction(data, lookup([real]));
    expect(state.status).toBe('failed');
    expect(state.reasons[0]).toMatch(/amount differs/);
  });

  it('fails when the signed and unsigned bundles are different transactions', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const a = await proposal(utxos, [0]);
    const b = await proposal(utxos, [0], 200000000n);
    const { state } = await decodeVaultKasTransaction(
      { ...a.data, walletSignedHex: b.data.walletSignedHex },
      lookup(utxos),
    );
    expect(state.status).toBe('failed');
    expect(state.reasons[0]).toMatch(/differ/);
  });

  it('fails when input details disagree with the bundle', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const { state } = await decodeVaultKasTransaction(
      {
        ...data,
        inputDetails: [
          { index: 0, addressIndex: 0, redeemScript: redeemHex(spend1) },
        ],
      },
      lookup(utxos),
    );
    expect(state.status).toBe('failed');
  });

  it('never throws on garbage', async () => {
    const { state, decoded } = await decodeVaultKasTransaction(
      { chain: KAS, rawUnsignedTx: 'deadbeef', inputDetails: [] },
      lookup([]),
    );
    expect(state.status).toBe('failed');
    expect(decoded.error).toBeTruthy();
  });
});

describe('Kaspa vault consolidation (recipient is the vault itself)', () => {
  async function consolidation(claimed: Utxo[], pay: bigint, fee = 30000n) {
    const vaultAddress = claimed[0].address;
    const tx = buildTx(claimed, vaultAddress, pay, fee, claimed[0].spend);
    const signer = leafSigner(xprivs.W, VAULT, 0);
    const partials = await K.signTransaction(tx, claimed, [signer]);
    signer.destroy();
    return {
      vaultAddress,
      data: {
        chain: KAS,
        orgIndex: ORG,
        vaultIndex: VAULT,
        rawUnsignedTx: JSON.stringify(K.createSigningBundle(tx, claimed, [])),
        walletSignedHex: JSON.stringify(
          K.createSigningBundle(tx, claimed, partials),
        ),
        inputDetails: JSON.stringify(
          claimed.map((u, index) => ({
            index,
            addressIndex: 0,
            redeemScript: redeemHex(u.spend),
            amount: u.entry.amount.toString(),
          })),
        ),
        recipients: [{ address: vaultAddress, amount: pay.toString() }],
        fee: fee.toString(),
      },
    };
  }

  it('accepts a recipient that is the vault and shows the vault as recipient', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n), fakeUtxo(spend0, 200000000n)];
    const { data, vaultAddress } = await consolidation(utxos, 400000000n);
    const { state, decoded } = await decodeVaultKasTransaction(
      data,
      lookup(utxos),
    );
    expect(state.status).toBe('ok');
    expect(decoded.recipients.map((r) => r.address)).toEqual([
      vaultAddress,
      vaultAddress,
    ]);
    const result = await signKasVaultBundle({
      data,
      vaultXpriv: xprivs.Kk,
      vaultIndex: VAULT,
      ledger: memoryLedger(),
      fetchUtxos: lookup(utxos),
    });
    expect(JSON.parse(result.signedHex).partials).toHaveLength(4);
  });

  it('refuses a self recipient whose amount matches no own output', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data, vaultAddress } = await consolidation(utxos, 400000000n);
    const { state } = await decodeVaultKasTransaction(
      {
        ...data,
        recipients: [{ address: vaultAddress, amount: '400000001' }],
      },
      lookup(utxos),
    );
    expect(state.status).toBe('failed');
    expect(state.reasons).toContain('recipients differ from the proposal');
  });

  it('a self recipient cannot hide an external payment', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const { state } = await decodeVaultKasTransaction(
      {
        ...data,
        recipients: [{ address: utxos[0].address, amount: '300000000' }],
      },
      lookup(utxos),
    );
    expect(state.status).toBe('failed');
  });
});

describe('Kaspa vault co-sign', () => {
  it('signs every input with the right leaf and returns a finalisable bundle', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n), fakeUtxo(spend0, 200000000n)];
    const { data, tx } = await proposal(utxos, [0, 0], 600000000n);
    const ledger = memoryLedger();
    const result = await signKasVaultBundle({
      data,
      vaultXpriv: xprivs.Kk,
      vaultIndex: VAULT,
      ledger,
      fetchUtxos: lookup(utxos),
    });
    expect(result.keyPubKey).toBe(K.bytesToHex(leafKey(xprivs.Kk, 0)));
    expect(result.txid).toBe(K.bytesToHex(K.transactionId(tx)));
    const bundle = JSON.parse(result.signedHex) as K.SigningBundle;
    expect(bundle.format).toBe('kaspa-core-signing-bundle');
    expect(bundle.partials).toHaveLength(4); // W + Kk on each of 2 inputs
    // 2-of-3 reached: the merged bundle finalises
    const opened = K.openSigningBundle(bundle, { trustedUtxos: utxos });
    expect(() =>
      K.finalizeTransaction(opened.tx, opened.inputs, opened.partials),
    ).not.toThrow();
    expect(ledger.map.size).toBe(2);
    expect(ledger.flush).toHaveBeenCalledTimes(1);
  });

  it('refuses a proposal spending two addresses of the same vault (§4.7)', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n), fakeUtxo(spend1, 200000000n)];
    const { data } = await proposal(utxos, [0, 1], 600000000n);
    const ledger = memoryLedger();
    await expect(
      signKasVaultBundle({
        data,
        vaultXpriv: xprivs.Kk,
        vaultIndex: VAULT,
        ledger,
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/more than one vault script/);
    expect(ledger.map.size).toBe(0);
  });

  it('refuses a dual-mode proposal whose script cannot be a dual vault', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)]; // 2-of-3: n is odd
    const { data } = await proposal(utxos, [0]);
    const { state } = await decodeVaultKasTransaction(
      { ...data, signingMode: 'dual' },
      lookup(utxos),
    );
    expect(state.status).toBe('failed');
    expect(state.reasons[0]).toMatch(/dual-signing/);
  });

  it('signs a first-signer rawUnsignedTx (no walletSignedHex)', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const result = await signKasVaultBundle({
      data: { ...data, walletSignedHex: undefined },
      vaultXpriv: xprivs.Kk,
      vaultIndex: VAULT,
      ledger: memoryLedger(),
      fetchUtxos: lookup(utxos),
    });
    const bundle = JSON.parse(result.signedHex) as K.SigningBundle;
    expect(bundle.partials).toHaveLength(1);
  });

  it('refuses a key that is not a signer of the vault', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    await expect(
      signKasVaultBundle({
        data,
        vaultXpriv: xprivs.Z,
        vaultIndex: VAULT,
        ledger: memoryLedger(),
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/not a signer/);
  });

  it('refuses a relay payload mismatch before touching a key', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const ledger = memoryLedger();
    await expect(
      signKasVaultBundle({
        data: { ...data, fee: '0' },
        vaultXpriv: xprivs.Kk,
        vaultIndex: VAULT,
        ledger,
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/mismatch/);
    expect(ledger.map.size).toBe(0);
  });

  it('refuses a ledger mismatch it cannot resolve by a proof', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const ledger = memoryLedger();
    const outpoint = `${K.bytesToHex(utxos[0].outpoint.transactionId)}:0`;
    ledger.set(outpoint, 1n);
    const prove = jest.fn(() => Promise.reject(new Error('unprovable')));
    const err = await signKasVaultBundle({
      data,
      vaultXpriv: xprivs.Kk,
      vaultIndex: VAULT,
      ledger,
      fetchUtxos: lookup(utxos),
      prove,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KasLedgerConflictError);
    expect((err as KasLedgerConflictError).unprovable).toEqual([outpoint]);
    expect(prove).toHaveBeenCalledWith(
      K.bytesToHex(utxos[0].outpoint.transactionId),
      0,
    );
    expect(ledger.map.get(outpoint)).toBe(1n); // untouched
    expect(ledger.flush).not.toHaveBeenCalled();
  });

  it('KAS-2: a poisoned entry the chain proves wrong is replaced and the real amount signs', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const ledger = memoryLedger();
    const outpoint = `${K.bytesToHex(utxos[0].outpoint.transactionId)}:0`;
    ledger.set(outpoint, 499999999n); // a lying backend, once
    const result = await signKasVaultBundle({
      data,
      vaultXpriv: xprivs.Kk,
      vaultIndex: VAULT,
      ledger,
      fetchUtxos: lookup(utxos),
      prove: () => Promise.resolve(500000000n),
    });
    expect(JSON.parse(result.signedHex).partials).toHaveLength(2);
    expect(ledger.map.get(outpoint)).toBe(500000000n);
    expect(ledger.flush).toHaveBeenCalledTimes(1);
  });

  it('KAS-2: an entry the chain proves RIGHT keeps refusing a lying lookup', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)]; // the lookup lies: real 600
    const { data } = await proposal(utxos, [0]);
    const ledger = memoryLedger();
    const outpoint = `${K.bytesToHex(utxos[0].outpoint.transactionId)}:0`;
    ledger.set(outpoint, 600000000n);
    const err = await signKasVaultBundle({
      data,
      vaultXpriv: xprivs.Kk,
      vaultIndex: VAULT,
      ledger,
      fetchUtxos: lookup(utxos),
      prove: () => Promise.resolve(600000000n),
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KasLedgerConflictError);
    expect((err as KasLedgerConflictError).refused).toEqual([outpoint]);
    expect(ledger.map.get(outpoint)).toBe(600000000n);
  });

  it('refuses a bundle carrying an invalid partial signature', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const bundle = JSON.parse(data.walletSignedHex) as K.SigningBundle;
    bundle.partials[0].signature = '11'.repeat(64);
    await expect(
      signKasVaultBundle({
        data: { ...data, walletSignedHex: JSON.stringify(bundle) },
        vaultXpriv: xprivs.Kk,
        vaultIndex: VAULT,
        ledger: memoryLedger(),
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/invalid signature/);
  });

  it('verify exposes the own-lookup description', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const v = await verifyKasVaultBundle(data, lookup(utxos));
    expect(v.description.fee).toBe(30000n);
    expect(v.mismatches).toEqual([]);
  });
});

/**
 * C1 regression (contract §4.7): an attacker who knows the signer xpubs
 * builds S_att = 1-of-2 {keyLeaf, attackerKey}, funds it with 0.2 KAS and
 * proposes inputs [vault 1000 KAS, S_att 0.2 KAS] → outputs [R 1 KAS (the
 * relay recipients), S_att ~999 KAS]. Before the fix the S_att output was
 * hidden as "own" change and the key signed both inputs — draining the vault.
 */
describe('Kaspa vault: mixed-script drain (C1)', () => {
  const R = recipientAddress(3);
  const attacker = K.localSigner(new Uint8Array(32).fill(0x42));
  const sAtt = K.multisigSpend(
    [leafKey(xprivs.Kk, 0), attacker.xOnlyPublicKey],
    1,
  );

  function attack(detailRedeems: (vault: string, att: string) => string[]) {
    const vaultUtxo = fakeUtxo(spend0, 100000000000n); // 1000 KAS
    const attUtxo = fakeUtxo(sAtt, 20000000n); // 0.2 KAS
    const utxos = [vaultUtxo, attUtxo];
    const fee = 30000n;
    const pay = 100000000n; // 1 KAS to R, matches the relay recipients
    const tx = K.createTransaction({
      inputs: utxos,
      outputs: [
        { value: pay, scriptPublicKey: K.addressToScriptPublicKey(R, 'kaspa') },
        {
          value: 100000000000n + 20000000n - pay - fee,
          scriptPublicKey: K.spendScriptPublicKey(sAtt),
        },
      ],
    });
    const unsigned = JSON.stringify(K.createSigningBundle(tx, utxos, []));
    const redeems = detailRedeems(redeemHex(spend0), redeemHex(sAtt));
    const data = {
      chain: KAS,
      orgIndex: ORG,
      vaultIndex: VAULT,
      rawUnsignedTx: unsigned,
      inputDetails: utxos.map((u, index) => ({
        index,
        addressIndex: 0,
        redeemScript: redeems[index],
        amount: u.entry.amount.toString(),
      })),
      recipients: [{ address: R, amount: pay.toString() }],
      fee: fee.toString(),
    };
    return { data, utxos };
  }

  const variants: Array<
    [string, (vault: string, att: string) => string[], RegExp]
  > = [
    [
      'each input with its own redeem script',
      (vault, att) => [vault, att],
      /more than one vault script/,
    ],
    [
      'both details claiming the vault redeem script',
      (vault) => [vault, vault],
      /own UTXO lookup|does not spend the proposal's vault script/,
    ],
    [
      'both details claiming the attacker redeem script',
      (_vault, att) => [att, att],
      /own UTXO lookup|does not spend the proposal's vault script/,
    ],
  ];

  it.each(variants)(
    'decode fails and signing refuses: %s',
    async (_label, redeems, reason) => {
      const { data, utxos } = attack(redeems);
      // the lookup is honest: it serves both scripts' real UTXOs
      const fetch = lookup(utxos);
      const { state, decoded } = await decodeVaultKasTransaction(data, fetch);
      expect(state.status).toBe('failed');
      expect(state.reasons.join(' ')).toMatch(reason);
      expect(decoded.error).toBeTruthy();
      const ledger = memoryLedger();
      await expect(
        signKasVaultBundle({
          data,
          vaultXpriv: xprivs.Kk,
          vaultIndex: VAULT,
          ledger,
          fetchUtxos: fetch,
        }),
      ).rejects.toThrow(reason);
      expect(ledger.map.size).toBe(0); // nothing was signed
      expect(ledger.flush).not.toHaveBeenCalled();
    },
  );

  it('only ever looks up the single vault address', async () => {
    const { data, utxos } = attack((vault) => [vault, vault]);
    const fetch = lookup(utxos);
    await decodeVaultKasTransaction(data, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith([utxos[0].address]);
  });

  it('refuses a proposal whose single script does not contain the key leaf', async () => {
    // all inputs spend S_att-like script without the key: sign must refuse
    const foreign = K.multisigSpend(
      [leafKey(xprivs.W, 0), attacker.xOnlyPublicKey],
      1,
    );
    const utxos = [fakeUtxo(foreign, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    await expect(
      signKasVaultBundle({
        data: { ...data, walletSignedHex: undefined },
        vaultXpriv: xprivs.Kk,
        vaultIndex: VAULT,
        ledger: memoryLedger(),
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/not a signer/);
  });
});

/**
 * KAS-1 regression (poc/kas-poc-orgindex0.mjs): orgIndex 0 + vault 0 is the
 * CONSUMER account; a forged "enterprise" request naming the consumer 2-of-2
 * script used to pass every check and get the consumer UTXOs co-signed.
 */
describe('Kaspa vault: organisation / vault / address indices (KAS-1)', () => {
  it.each([
    ['orgIndex 0 (the consumer account)', { orgIndex: 0 }],
    ['orgIndex 99 (the reserved recovery account)', { orgIndex: 99 }],
    ['orgIndex as a string', { orgIndex: '100' }],
    ['a fractional orgIndex', { orgIndex: 100.5 }],
    ['orgIndex above 99999', { orgIndex: 100000 }],
    ['no orgIndex', { orgIndex: undefined }],
    ['a negative vaultIndex', { vaultIndex: -1 }],
    ['a hardened vaultIndex', { vaultIndex: 2 ** 31 }],
    ['a string vaultIndex', { vaultIndex: '0' }],
  ])('decode and co-sign refuse %s', async (_label, over) => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const bad = { ...data, ...over };
    expect(kasVaultIndicesError(bad)).toMatch(/Invalid Kaspa/);
    const { state } = await decodeVaultKasTransaction(bad, lookup(utxos));
    expect(state.status).toBe('failed');
    expect(state.reasons[0]).toMatch(
      /Invalid Kaspa (organisation|vault) index/,
    );
    const ledger = memoryLedger();
    await expect(
      signKasVaultBundle({
        data: bad,
        vaultXpriv: xprivs.Kk,
        vaultIndex: VAULT,
        ledger,
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/Invalid Kaspa/);
    expect(ledger.map.size).toBe(0);
  });

  it('the consumer 0-0 script under orgIndex 0 is never co-signed', async () => {
    const consumer = K.multisigSpend(
      [MNEMONIC_W, MNEMONIC_KK].map((m) =>
        K.hexToBytes(generateAddressKeypair(kasXpriv(m, 0), 0, 0, KAS).pubKey),
      ),
      2,
    );
    const utxos = [fakeUtxo(consumer, 100000000000n)];
    const { data } = await proposal(utxos, [0]);
    const forged = { ...data, orgIndex: 0, signingMode: 'dual' };
    const ledger = memoryLedger();
    await expect(
      signKasVaultBundle({
        data: forged,
        vaultXpriv: kasXpriv(MNEMONIC_KK, 0),
        vaultIndex: 0,
        ledger,
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/Invalid Kaspa organisation index 0/);
    expect(ledger.map.size).toBe(0);
  });

  it('refuses address indices that are not non-hardened integers', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    for (const addressIndex of [-1, 0.5, 2 ** 31, '0']) {
      const bad = {
        ...data,
        inputDetails: [
          { index: 0, addressIndex, redeemScript: redeemHex(spend0) },
        ],
      };
      const { state } = await decodeVaultKasTransaction(bad, lookup(utxos));
      expect(state.status).toBe('failed');
      expect(state.reasons[0]).toMatch(/Invalid Kaspa input detail/);
    }
  });

  it('the key derives with the request’s own vault index only', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    await expect(
      signKasVaultBundle({
        data,
        vaultXpriv: xprivs.Kk,
        vaultIndex: VAULT + 1,
        ledger: memoryLedger(),
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/Invalid Kaspa vault index/);
  });
});
