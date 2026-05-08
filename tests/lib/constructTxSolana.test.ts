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

describe('Solana constructTx (key device)', () => {
  describe('cosignAndBroadcastSOLTransaction', () => {
    test('throws if key privkey does not match the supplied key pubkey', async () => {
      const { serialized } = buildKeySignableTx();
      await expect(
        cosignAndBroadcastSOLTransaction({
          chain: 'solDevnet',
          serializedTxBase64: serialized,
          keyPubkeyBase58: walletKp.pubKey, // wrong pubkey
          keyPrivKeyHex: keyKp.privKey,
          relayHost: 'relay.sspwallet.com',
        }),
      ).rejects.toThrow(/privkey\/pubkey mismatch/);
    });

    test('on relay success returns the broadcast signature and posts to /v1/sol/broadcast', async () => {
      const { serialized } = buildKeySignableTx();
      const fakeSig = '5xKeyDeviceFakeBroadcastSig';
      const fetchSpy = jest
        .spyOn(globalThis as any, 'fetch')
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: 'success',
              data: { signature: fakeSig },
            }),
        } as any);

      const sig = await cosignAndBroadcastSOLTransaction({
        chain: 'solDevnet',
        serializedTxBase64: serialized,
        keyPubkeyBase58: keyKp.pubKey,
        keyPrivKeyHex: keyKp.privKey,
        relayHost: 'relay.sspwallet.com',
      });
      expect(sig).toBe(fakeSig);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://relay.sspwallet.com/v1/sol/broadcast');
      const body = JSON.parse((opts as any).body);
      expect(body.chain).toBe('solDevnet');
      expect(typeof body.serializedTxBase64).toBe('string');

      fetchSpy.mockRestore();
    });

    test('on relay 4xx/5xx HTTP throws "Relay broadcast failed"', async () => {
      const { serialized } = buildKeySignableTx();
      const fetchSpy = jest
        .spyOn(globalThis as any, 'fetch')
        .mockResolvedValue({
          ok: false,
          status: 503,
          json: () => Promise.resolve({}),
        } as any);

      await expect(
        cosignAndBroadcastSOLTransaction({
          chain: 'solDevnet',
          serializedTxBase64: serialized,
          keyPubkeyBase58: keyKp.pubKey,
          keyPrivKeyHex: keyKp.privKey,
          relayHost: 'relay.sspwallet.com',
        }),
      ).rejects.toThrow(/Relay broadcast failed: 503/);

      fetchSpy.mockRestore();
    });

    test('on relay error response (status="error") throws "Relay broadcast error"', async () => {
      const { serialized } = buildKeySignableTx();
      const fetchSpy = jest
        .spyOn(globalThis as any, 'fetch')
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              status: 'error',
              data: { message: 'paymaster funds depleted' },
            }),
        } as any);

      await expect(
        cosignAndBroadcastSOLTransaction({
          chain: 'solDevnet',
          serializedTxBase64: serialized,
          keyPubkeyBase58: keyKp.pubKey,
          keyPrivKeyHex: keyKp.privKey,
          relayHost: 'relay.sspwallet.com',
        }),
      ).rejects.toThrow(/Relay broadcast error: paymaster funds depleted/);

      fetchSpy.mockRestore();
    });

    test('co-signing attaches the key device signature to the relayed tx', async () => {
      const { paymaster, serialized } = buildKeySignableTx();
      let capturedBody: any = null;
      const fetchSpy = jest
        .spyOn(globalThis as any, 'fetch')
        .mockImplementation((_url, opts: any) => {
          capturedBody = JSON.parse(opts.body);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                status: 'success',
                data: { signature: 'sigFromRelay' },
              }),
          } as any);
        });

      await cosignAndBroadcastSOLTransaction({
        chain: 'solDevnet',
        serializedTxBase64: serialized,
        keyPubkeyBase58: keyKp.pubKey,
        keyPrivKeyHex: keyKp.privKey,
        relayHost: 'relay.sspwallet.com',
      });

      const sentTx = Transaction.from(
        Buffer.from(capturedBody.serializedTxBase64, 'base64'),
      );
      const keySig = sentTx.signatures.find(
        (s) => s.publicKey.toBase58() === keyKp.pubKey,
      );
      expect(keySig).toBeDefined();
      expect(keySig!.signature).not.toBeNull();
      // Paymaster slot is still unsigned — relay adds that.
      const paySig = sentTx.signatures.find(
        (s) => s.publicKey.toBase58() === paymaster.publicKey.toBase58(),
      );
      expect(paySig).toBeDefined();
      expect(paySig!.signature).toBeNull();

      fetchSpy.mockRestore();
    });
  });
});
