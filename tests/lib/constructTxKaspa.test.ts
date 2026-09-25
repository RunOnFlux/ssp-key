import * as K from '@runonflux/kaspa-core';
import type { FetchLike } from '@runonflux/kaspa-core/rest';
import {
  KasMaybeBroadcastError,
  cosignAndBroadcastKASTransaction,
} from '../../src/lib/constructTx';
import { decodeTransactionForApproval } from '../../src/lib/transactions';
import { kasRestClient, kasVaultSpend } from '../../src/lib/kaspa';
import {
  KAS,
  MNEMONIC_KK,
  MNEMONIC_W,
  buildTx,
  fakeUtxo,
  kasXpriv,
  kasXpub,
  leafSigner,
  memoryLedger,
  recipientAddress,
  restUtxoJson,
} from './kaspaFixtures';
import { generateAddressKeypair } from '../../src/lib/wallet';

/**
 * Consumer 2-of-2 flow (contract §5): SSP Wallet plans + half-signs and ships
 * the bundle JSON; SSP Key opens it against ITS OWN UTXO lookup, co-signs,
 * finalises and broadcasts. The lookups below go through the real kaspa-core
 * REST client over a mocked fetch.
 */

const walletXpub = kasXpub(MNEMONIC_W, 0);
const keyXpub = kasXpub(MNEMONIC_KK, 0);
const walletXpriv = kasXpriv(MNEMONIC_W, 0);
const keyXpriv = kasXpriv(MNEMONIC_KK, 0);
const spend = kasVaultSpend(walletXpub, keyXpub, 0, 0, KAS);
const vaultAddress = K.scriptPublicKeyToAddress(
  K.spendScriptPublicKey(spend),
  'kaspa',
) as string;
const to = recipientAddress(7);

type Utxo = ReturnType<typeof fakeUtxo>;

/** The wallet's half: unsigned tx over `claimed` entries, wallet partials. */
async function walletBundle(
  claimed: Utxo[],
  pay: bigint,
  fee: bigint,
): Promise<{ json: string; txid: string }> {
  const tx = buildTx(claimed, to, pay, fee, spend);
  const signer = leafSigner(walletXpriv, 0, 0);
  const partials = await K.signTransaction(tx, claimed, [signer], {
    onlyScripts: [K.spendScriptPublicKey(spend)],
  });
  signer.destroy();
  return {
    json: JSON.stringify(K.createSigningBundle(tx, claimed, partials)),
    txid: K.bytesToHex(K.transactionId(tx)),
  };
}

interface MockNode {
  fetch: FetchLike;
  submitted: string[];
  utxoCalls: string[];
}

/** A kaspa-rest-server double: serves `utxos` for the vault, accepts submits. */
function mockNode(
  utxos: Utxo[],
  submit: (
    body: string,
    n: number,
  ) => Promise<{
    ok: boolean;
    status: number;
    body: unknown;
  }> = (body) =>
    Promise.resolve({
      ok: true,
      status: 200,
      body: JSON.parse(body) as unknown,
    }),
): MockNode {
  const node: MockNode = { submitted: [], utxoCalls: [], fetch: undefined! };
  node.fetch = async (url, init) => {
    if (url.includes('/utxos')) {
      node.utxoCalls.push(url);
      return {
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(restUtxoJson(utxos))),
      };
    }
    if (url.includes('/transactions')) {
      node.submitted.push(init.body ?? '');
      const r = await submit(init.body ?? '', node.submitted.length);
      return {
        ok: r.ok,
        status: r.status,
        text: () => Promise.resolve(JSON.stringify(r.body)),
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  return node;
}

function acceptWithId(txid: string) {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      body: { transactionId: txid },
    });
}

const keyPriv = () => generateAddressKeypair(keyXpriv, 0, 0, KAS).privKey;

describe('cosignAndBroadcastKASTransaction', () => {
  it('opens with its own lookup, co-signs, finalises and submits', async () => {
    const utxos = [fakeUtxo(spend, 500000000n), fakeUtxo(spend, 300000000n)];
    const { json, txid } = await walletBundle(utxos, 600000000n, 20000n);
    const node = mockNode(utxos, acceptWithId(txid));
    const ledger = memoryLedger();
    const result = await cosignAndBroadcastKASTransaction({
      chain: KAS,
      bundleJson: json,
      vaultSpend: spend,
      keyPrivKeyHex: keyPriv(),
      ledger,
      rest: kasRestClient(KAS, node.fetch),
    });
    expect(result).toBe(txid);
    expect(node.utxoCalls).toHaveLength(1);
    expect(node.utxoCalls[0]).toContain(
      `https://api-kaspa.sspwallet.io/addresses/${encodeURIComponent(vaultAddress)}/utxos`,
    );
    // Submitted a fully signed transaction: every input has a 2-sig script.
    const sent = JSON.parse(node.submitted[0]) as {
      transaction: { inputs: { signatureScript: string }[] };
    };
    expect(sent.transaction.inputs).toHaveLength(2);
    for (const i of sent.transaction.inputs) {
      expect(i.signatureScript.length).toBeGreaterThan(260);
    }
    // ledger recorded both outpoints at the trusted amounts
    expect([...ledger.map.values()].sort()).toEqual([300000000n, 500000000n]);
  });

  it('refuses a bundle whose claimed amounts differ from its own lookup', async () => {
    // Real UTXO holds 50 KAS; the wallet claims 5 KAS, hiding a 45 KAS fee.
    const real = fakeUtxo(spend, 5000000000n);
    const lie = { ...real, entry: { ...real.entry, amount: 500000000n } };
    const { json } = await walletBundle([lie], 400000000n, 20000n);
    const node = mockNode([real]);
    await expect(
      cosignAndBroadcastKASTransaction({
        chain: KAS,
        bundleJson: json,
        vaultSpend: spend,
        keyPrivKeyHex: keyPriv(),
        ledger: memoryLedger(),
        rest: kasRestClient(KAS, node.fetch),
      }),
    ).rejects.toThrow(/amount differs/);
    expect(node.submitted).toHaveLength(0);
  });

  it('refuses an input missing from its own lookup', async () => {
    const utxo = fakeUtxo(spend, 500000000n);
    const { json } = await walletBundle([utxo], 400000000n, 20000n);
    const node = mockNode([]); // spent / never existed
    await expect(
      cosignAndBroadcastKASTransaction({
        chain: KAS,
        bundleJson: json,
        vaultSpend: spend,
        keyPrivKeyHex: keyPriv(),
        ledger: memoryLedger(),
        rest: kasRestClient(KAS, node.fetch),
      }),
    ).rejects.toThrow(/own UTXO lookup/);
  });

  it('refuses to re-sign an outpoint under a different amount (ledger)', async () => {
    const utxo = fakeUtxo(spend, 500000000n);
    const { json } = await walletBundle([utxo], 400000000n, 20000n);
    const node = mockNode([utxo]);
    const ledger = memoryLedger();
    ledger.set(
      `${K.bytesToHex(utxo.outpoint.transactionId)}:0`,
      499999999n, // signed earlier under another amount
    );
    await expect(
      cosignAndBroadcastKASTransaction({
        chain: KAS,
        bundleJson: json,
        vaultSpend: spend,
        keyPrivKeyHex: keyPriv(),
        ledger,
        rest: kasRestClient(KAS, node.fetch),
      }),
    ).rejects.toThrow(/different amount/);
    expect(node.submitted).toHaveLength(0);
  });

  it('refuses a key that is not in the vault', async () => {
    const utxo = fakeUtxo(spend, 500000000n);
    const { json } = await walletBundle([utxo], 400000000n, 20000n);
    const node = mockNode([utxo]);
    await expect(
      cosignAndBroadcastKASTransaction({
        chain: KAS,
        bundleJson: json,
        vaultSpend: spend,
        keyPrivKeyHex: generateAddressKeypair(keyXpriv, 0, 1, KAS).privKey,
        ledger: memoryLedger(),
        rest: kasRestClient(KAS, node.fetch),
      }),
    ).rejects.toThrow(/does not belong/);
  });

  it('re-submits the identical transaction after an unknown outcome', async () => {
    const utxo = fakeUtxo(spend, 500000000n);
    const { json, txid } = await walletBundle([utxo], 400000000n, 20000n);
    const node = mockNode([utxo], (_body, n) =>
      n === 1
        ? Promise.reject(new Error('network down'))
        : Promise.resolve({
            ok: true,
            status: 200,
            body: { transactionId: txid },
          }),
    );
    const result = await cosignAndBroadcastKASTransaction({
      chain: KAS,
      bundleJson: json,
      vaultSpend: spend,
      keyPrivKeyHex: keyPriv(),
      ledger: memoryLedger(),
      rest: kasRestClient(KAS, node.fetch),
    });
    expect(result).toBe(txid);
    expect(node.submitted).toHaveLength(2);
    expect(node.submitted[1]).toBe(node.submitted[0]); // never rebuilt
  });

  it('reports "may have been broadcast" when every attempt is unknown', async () => {
    const utxo = fakeUtxo(spend, 500000000n);
    const { json, txid } = await walletBundle([utxo], 400000000n, 20000n);
    const node = mockNode([utxo], () => Promise.reject(new Error('timeout')));
    const p = cosignAndBroadcastKASTransaction({
      chain: KAS,
      bundleJson: json,
      vaultSpend: spend,
      keyPrivKeyHex: keyPriv(),
      ledger: memoryLedger(),
      rest: kasRestClient(KAS, node.fetch),
    });
    await expect(p).rejects.toBeInstanceOf(KasMaybeBroadcastError);
    await expect(p).rejects.toMatchObject({ txid });
    expect(new Set(node.submitted).size).toBe(1);
  });
});

describe('decodeTransactionForApproval (kas)', () => {
  const ctx = (utxos: Utxo[]) => ({
    xpubWallet: walletXpub,
    xpubKey: keyXpub,
    path: '0-0',
    fetchUtxos: jest.fn(() => Promise.resolve(utxos)),
  });

  it("describes the bundle from the key's own lookup", async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 150000000n, 20000n);
    const c = ctx(utxos);
    const info = await decodeTransactionForApproval(json, KAS, [], c);
    expect(c.fetchUtxos).toHaveBeenCalledWith([vaultAddress]);
    expect(info).toEqual({
      sender: vaultAddress,
      receiver: to,
      amount: '1.5',
      fee: '0.0002',
      tokenSymbol: 'KAS',
      recipientCount: 1,
      warnings: [],
    });
  });

  it('ignores relay-supplied utxos and still uses its own lookup', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 150000000n, 20000n);
    const c = ctx(utxos);
    const relayUtxos = [
      {
        txid: 'x',
        vout: 0,
        scriptPubKey: '',
        satoshis: '1',
        confirmations: 1,
        coinbase: false,
      },
    ];
    const info = await decodeTransactionForApproval(json, KAS, relayUtxos, c);
    expect(info.fee).toBe('0.0002');
    expect(c.fetchUtxos).toHaveBeenCalledTimes(1);
  });

  it('surfaces describeTransaction warnings', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 100000000n, 200000000n); // 2 KAS fee
    const info = await decodeTransactionForApproval(json, KAS, [], ctx(utxos));
    expect(info.fee).toBe('2');
    expect(info.warnings).toEqual(
      expect.arrayContaining(['fee-above-threshold']),
    );
  });

  it('fails closed on a lying bundle', async () => {
    const real = fakeUtxo(spend, 5000000000n);
    const lie = { ...real, entry: { ...real.entry, amount: 500000000n } };
    const { json } = await walletBundle([lie], 400000000n, 20000n);
    const info = await decodeTransactionForApproval(json, KAS, [], ctx([real]));
    expect(info.amount).toBe('decodingError');
    expect(info.sender).toBe('decodingError');
  });

  it('fails closed with a UTXO-fetch reason when the lookup fails', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 150000000n, 20000n);
    const info = await decodeTransactionForApproval(json, KAS, [], {
      ...ctx(utxos),
      fetchUtxos: () => Promise.reject(new Error('offline')),
    });
    expect(info.amount).toBe('decodingError');
    expect(info.errorReason).toBe('kas_utxo_fetch');
  });

  it('fails closed without the paired xpubs, or on the wrong path', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 150000000n, 20000n);
    expect((await decodeTransactionForApproval(json, KAS, [])).amount).toBe(
      'decodingError',
    );
    // path 0-1 is a different vault: its lookup cannot contain these inputs
    expect(
      (
        await decodeTransactionForApproval(json, KAS, [], {
          ...ctx(utxos),
          path: '0-1',
        })
      ).amount,
    ).toBe('decodingError');
    expect(
      (
        await decodeTransactionForApproval(json, KAS, [], {
          ...ctx(utxos),
          path: 'bogus',
        })
      ).amount,
    ).toBe('decodingError');
  });

  it('never treats a kas payload as a utxolib hex transaction', async () => {
    const info = await decodeTransactionForApproval(
      '0100000001',
      KAS,
      [],
      ctx([]),
    );
    expect(info.amount).toBe('decodingError');
  });
});
