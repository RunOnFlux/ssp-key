import * as K from '@runonflux/kaspa-core';
import {
  decodeVaultKasTransaction,
  signKasVaultBundle,
  verifyKasVaultBundle,
} from '../../src/lib/kaspaVault';
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

describe('Kaspa vault co-sign', () => {
  it('signs every input with the right leaf and returns a finalisable bundle', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n), fakeUtxo(spend1, 200000000n)];
    const { data, tx } = await proposal(utxos, [0, 1], 600000000n);
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

  it('refuses a ledger mismatch', async () => {
    const utxos = [fakeUtxo(spend0, 500000000n)];
    const { data } = await proposal(utxos, [0]);
    const ledger = memoryLedger();
    ledger.set(`${K.bytesToHex(utxos[0].outpoint.transactionId)}:0`, 1n);
    await expect(
      signKasVaultBundle({
        data,
        vaultXpriv: xprivs.Kk,
        vaultIndex: VAULT,
        ledger,
        fetchUtxos: lookup(utxos),
      }),
    ).rejects.toThrow(/different amount/);
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
