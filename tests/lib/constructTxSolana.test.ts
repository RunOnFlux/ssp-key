import { Buffer } from 'buffer';
import {
  PublicKey,
  Transaction,
  Keypair,
  SystemProgram,
} from '@solana/web3.js';

import {
  getMasterXpriv,
  generateAddressKeypairSOL,
} from '../../src/lib/wallet';
import { cosignAndBroadcastSOLTransaction } from '../../src/lib/constructTx';

const mnemonic =
  'silver trouble mountain crouch angry park film strong escape theory illegal bunker cargo taxi tuna real drift alert state match great escape option explain';
const xprivWallet = getMasterXpriv(mnemonic, 48, 1, 0, 'p2sh', 'solDevnet');
const xprivKey = getMasterXpriv(mnemonic, 48, 1, 1, 'p2sh', 'solDevnet');
const walletKp = generateAddressKeypairSOL(xprivWallet, 0, 0, 'solDevnet');
const keyKp = generateAddressKeypairSOL(xprivKey, 0, 0, 'solDevnet');
const blockhash = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';

// Build a tx where the key device's pubkey is a required signer (so
// partialSign(keyKeypair) attaches its sig to a real slot).
function buildKeySignableTx() {
  const paymaster = Keypair.generate();
  const recipient = new PublicKey(walletKp.pubKey);
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.feePayer = paymaster.publicKey;
  tx.add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(keyKp.pubKey),
      toPubkey: recipient,
      lamports: 1,
    }),
  );
  return {
    paymaster,
    serialized: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString('base64'),
  };
}

describe('cosignAndBroadcastSOLTransaction (key device)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('throws if key privkey does not match the supplied key pubkey', async () => {
    const { serialized } = buildKeySignableTx();
    await expect(
      cosignAndBroadcastSOLTransaction({
        chain: 'solDevnet',
        serializedTxBase64: serialized,
        keyPubkeyBase58: walletKp.pubKey, // wrong pubkey
        keyPrivKeyHex: keyKp.privKey,
        relayHost: 'relay.example',
      }),
    ).rejects.toThrow(/privkey\/pubkey mismatch/);
  });

  test('attaches the key signature and POSTs the partial-signed tx to /v1/sol/broadcast', async () => {
    const { paymaster, serialized } = buildKeySignableTx();
    let capturedBody: { chain?: string; serializedTxBase64?: string } = {};
    global.fetch = jest.fn((_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'success',
            data: { signature: 'TXSIGNATURE_FAKE' },
          }),
      } as Response);
    }) as unknown as typeof fetch;

    const sig = await cosignAndBroadcastSOLTransaction({
      chain: 'solDevnet',
      serializedTxBase64: serialized,
      keyPubkeyBase58: keyKp.pubKey,
      keyPrivKeyHex: keyKp.privKey,
      relayHost: 'relay.example',
    });
    expect(sig).toBe('TXSIGNATURE_FAKE');
    expect(capturedBody.chain).toBe('solDevnet');
    expect(typeof capturedBody.serializedTxBase64).toBe('string');

    const sentTx = Transaction.from(
      Buffer.from(capturedBody.serializedTxBase64!, 'base64'),
    );
    const keySig = sentTx.signatures.find(
      (s) => s.publicKey.toBase58() === keyKp.pubKey,
    );
    expect(keySig).toBeDefined();
    expect(keySig!.signature).not.toBeNull();
    // Paymaster slot is still unsigned — relay adds that on broadcast.
    const paySig = sentTx.signatures.find(
      (s) => s.publicKey.toBase58() === paymaster.publicKey.toBase58(),
    );
    expect(paySig).toBeDefined();
    expect(paySig!.signature).toBeNull();
  });

  test('surfaces a relay error response', async () => {
    const { serialized } = buildKeySignableTx();
    global.fetch = jest.fn(() => {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'error',
            data: { message: 'paymaster simulation failed' },
          }),
      } as Response);
    });

    await expect(
      cosignAndBroadcastSOLTransaction({
        chain: 'solDevnet',
        serializedTxBase64: serialized,
        keyPubkeyBase58: keyKp.pubKey,
        keyPrivKeyHex: keyKp.privKey,
        relayHost: 'relay.example',
      }),
    ).rejects.toThrow(/paymaster simulation failed/);
  });
});
