import * as K from '@runonflux/kaspa-core';
import type { FetchLike } from '@runonflux/kaspa-core/rest';
import {
  KasMaybeBroadcastError,
  cosignAndBroadcastKASTransaction,
} from '../../src/lib/constructTx';
import { decodeTransactionForApproval } from '../../src/lib/transactions';
import {
  describeKasOpened,
  kasApprovedSummary,
  kasRestClient,
  kasVaultSpend,
  openKasBundle,
  type KasApprovedSummary,
} from '../../src/lib/kaspa';
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

/** What the approval screen would have shown for `json` over `utxos`. */
const approvedFor = (json: string, utxos: Utxo[]): KasApprovedSummary =>
  kasApprovedSummary(
    describeKasOpened(openKasBundle(json, utxos), KAS, [
      K.spendScriptPublicKey(spend),
    ]),
  );

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
      approved: approvedFor(json, utxos),
      rest: kasRestClient(KAS, node.fetch),
    });
    expect(result).toBe(txid);
    expect(ledger.flush).toHaveBeenCalledTimes(1);
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
        approved: approvedFor(json, [lie]),
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
        approved: approvedFor(json, [utxo]),
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
        approved: approvedFor(json, [utxo]),
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
        approved: approvedFor(json, [utxo]),
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
      approved: approvedFor(json, [utxo]),
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
      approved: approvedFor(json, [utxo]),
      rest: kasRestClient(KAS, node.fetch),
    });
    await expect(p).rejects.toBeInstanceOf(KasMaybeBroadcastError);
    await expect(p).rejects.toMatchObject({ txid });
    expect(new Set(node.submitted).size).toBe(1);
  });
});

describe('cosignAndBroadcastKASTransaction: display ↔ sign binding (L1)', () => {
  const run = (
    json: string,
    utxos: Utxo[],
    approved: KasApprovedSummary,
    extra: { maxFee?: bigint } = {},
  ) => {
    const node = mockNode(utxos);
    const ledger = memoryLedger();
    return {
      node,
      ledger,
      p: cosignAndBroadcastKASTransaction({
        chain: KAS,
        bundleJson: json,
        vaultSpend: spend,
        keyPrivKeyHex: keyPriv(),
        ledger,
        approved,
        rest: kasRestClient(KAS, node.fetch),
        ...extra,
      }),
    };
  };

  it('refuses when the fee differs from what was displayed', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 150000000n, 20000n);
    const { p, node, ledger } = run(json, utxos, {
      ...approvedFor(json, utxos),
      fee: '1',
    });
    await expect(p).rejects.toThrow(/changed since it was displayed.*fee/);
    expect(node.submitted).toHaveLength(0);
    expect(ledger.map.size).toBe(0);
  });

  it('refuses when the external outputs differ from what was displayed', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 150000000n, 20000n);
    const { p, node } = run(json, utxos, {
      ...approvedFor(json, utxos),
      outputs: [`${recipientAddress(8)}|150000000`],
    });
    await expect(p).rejects.toThrow(/recipients differ/);
    expect(node.submitted).toHaveLength(0);
  });

  it('refuses a different transaction than the displayed one', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const shown = await walletBundle(utxos, 150000000n, 20000n);
    const other = await walletBundle(utxos, 150000000n, 30000n);
    const { p } = run(other.json, utxos, approvedFor(shown.json, utxos));
    await expect(p).rejects.toThrow(/transaction differs/);
  });

  it('enforces an explicit maxFee (min($100-equivalent, 5 KAS))', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 100000000n, 200000000n); // 2 KAS
    const { p, node } = run(json, utxos, approvedFor(json, utxos), {
      maxFee: 100000000n, // 1 KAS ceiling: $100 at $100/KAS
    });
    await expect(p).rejects.toThrow(/exceeds the ceiling/);
    expect(node.submitted).toHaveLength(0);
  });

  it('flushes the ledger before submitting', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json, txid } = await walletBundle(utxos, 150000000n, 20000n);
    const order: string[] = [];
    const node = mockNode(utxos, () => {
      order.push('submit');
      return acceptWithId(txid)();
    });
    const ledger = memoryLedger();
    ledger.flush.mockImplementation(() => order.push('flush'));
    await cosignAndBroadcastKASTransaction({
      chain: KAS,
      bundleJson: json,
      vaultSpend: spend,
      keyPrivKeyHex: keyPriv(),
      ledger,
      approved: approvedFor(json, utxos),
      rest: kasRestClient(KAS, node.fetch),
    });
    expect(order).toEqual(['flush', 'submit']);
  });

  it('never submits when the ledger flush fails', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 150000000n, 20000n);
    const node = mockNode(utxos);
    const ledger = memoryLedger();
    ledger.flush.mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(
      cosignAndBroadcastKASTransaction({
        chain: KAS,
        bundleJson: json,
        vaultSpend: spend,
        keyPrivKeyHex: keyPriv(),
        ledger,
        approved: approvedFor(json, utxos),
        rest: kasRestClient(KAS, node.fetch),
      }),
    ).rejects.toThrow('disk full');
    expect(node.submitted).toHaveLength(0);
  });
});

describe('submit: already-known is success on any attempt (L5)', () => {
  const reject = (message: string) => () =>
    Promise.resolve({ ok: false, status: 500, body: { detail: message } });

  it.each([
    'Rejected transaction abc: transaction abc is already in the mempool',
    'transaction abc was already accepted by the consensus',
  ])('first-attempt "%s" returns the txid', async (message) => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json, txid } = await walletBundle(utxos, 150000000n, 20000n);
    const node = mockNode(utxos, reject(message));
    await expect(
      cosignAndBroadcastKASTransaction({
        chain: KAS,
        bundleJson: json,
        vaultSpend: spend,
        keyPrivKeyHex: keyPriv(),
        ledger: memoryLedger(),
        approved: approvedFor(json, utxos),
        rest: kasRestClient(KAS, node.fetch),
      }),
    ).resolves.toBe(txid);
    expect(node.submitted).toHaveLength(1);
  });

  it('a double-spend ("already spent") is NOT success', async () => {
    const utxos = [fakeUtxo(spend, 500000000n)];
    const { json } = await walletBundle(utxos, 150000000n, 20000n);
    const node = mockNode(
      utxos,
      reject('output abc:0 already spent by transaction def in the mempool'),
    );
    await expect(
      cosignAndBroadcastKASTransaction({
        chain: KAS,
        bundleJson: json,
        vaultSpend: spend,
        keyPrivKeyHex: keyPriv(),
        ledger: memoryLedger(),
        approved: approvedFor(json, utxos),
        rest: kasRestClient(KAS, node.fetch),
      }),
    ).rejects.toThrow(/already spent/);
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
      kasApproved: approvedFor(json, utxos),
    });
    // the summary is exactly what is shown: txid, fee, external outputs
    expect(info.kasApproved).toEqual({
      txid: K.bytesToHex(
        K.transactionId(
          K.transactionFromJson((JSON.parse(json) as K.SigningBundle).tx),
        ),
      ),
      fee: '20000',
      outputs: [`${to}|150000000`],
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

  it('a bundle for another vault path fails closed with a clear reason (L4)', async () => {
    // A bare bundle entered manually is routed to path 0-0; one that spends
    // the vault at 0-1 must be refused with the wrong-vault reason.
    const spend01 = kasVaultSpend(walletXpub, keyXpub, 0, 1, KAS);
    const utxos = [fakeUtxo(spend01, 500000000n)];
    const tx = buildTx(utxos, to, 150000000n, 20000n, spend01);
    const json = JSON.stringify(K.createSigningBundle(tx, utxos, []));
    const c = ctx(utxos);
    const info = await decodeTransactionForApproval(json, KAS, [], c);
    expect(info.amount).toBe('decodingError');
    expect(info.errorReason).toBe('kas_wrong_vault');
    expect(c.fetchUtxos).not.toHaveBeenCalled();
    // …and the same bundle decodes at its real path
    const ok = await decodeTransactionForApproval(json, KAS, [], {
      ...c,
      path: '0-1',
    });
    expect(ok.amount).toBe('1.5');
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
