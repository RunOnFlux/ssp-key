/**
 * Zcash TEX addresses (ZIP 320) on the approval screens.
 *
 * SSP Wallet pays a `tex1…` address as the P2PKH output of its key hash and
 * tells this device which TEX address the user entered. The screens show that
 * address only when it encodes the key hash an output pays; a TEX recipient
 * that no output pays blocks the request. Fully offline.
 */
import utxolib from '@runonflux/utxo-lib';
import { Buffer } from 'buffer';
import {
  decodeTexKeyHash,
  texToTransparentAddress,
  transparentToTexAddress,
} from '../../src/lib/zcashTex';
import {
  applyZcashTexReceiver,
  labelVaultTexRecipients,
} from '../../src/lib/transactions';

// The example in ZIP 320 itself ("Reference implementation" section).
const ZIP320_T1 = 't1VmmGiyjVNeCjxDZzg7vZmd99WyzVby9yC';
const ZIP320_TEX = 'tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte';
const ZIP320_KEY_HASH = '8286bf790866805397e3a947640b77a43f0b43a5';
// Same key hash on testnet (cross-checked in SSP Wallet's suite).
const TESTNET_TEX = 'textest1s2rt77ggv6q989lr49rkgzmh5slsksa90ej7wz';
// Bech32 (BIP-173) checksum instead of Bech32m: ZIP 320 forbids it.
const TEX_WITH_BECH32_CHECKSUM = 'tex1s2rt77ggv6q989lr49rkgzmh5slsksa9rtaywm';

/** A second, unrelated transparent address and its TEX form. */
const OTHER_HASH = Buffer.alloc(20, 7);
const OTHER_T1 = utxolib.address.fromOutputScript(
  utxolib.script.pubKeyHash.output.encode(OTHER_HASH),
  utxolib.networks.zcash,
);

type ApprovalInfo = Parameters<typeof applyZcashTexReceiver>[0];

const decoded = (
  recipients: Array<{ address: string; amount: string }>,
): ApprovalInfo => ({
  sender: 't3sender',
  receiver: recipients[0].address,
  amount: '1',
  fee: '0.0001',
  tokenSymbol: 'ZEC',
  recipientCount: recipients.length,
  recipients,
});

describe('TEX decoding', () => {
  it('decodes the ZIP 320 example to its key hash and t1 address', () => {
    const keyHash = decodeTexKeyHash(ZIP320_TEX, 'zcash');
    expect(Buffer.from(keyHash as Uint8Array).toString('hex')).toBe(
      ZIP320_KEY_HASH,
    );
    expect(texToTransparentAddress(ZIP320_TEX, 'zcash')).toBe(ZIP320_T1);
    expect(texToTransparentAddress(ZIP320_TEX.toUpperCase(), 'zcash')).toBe(
      ZIP320_T1,
    );
  });

  it('refuses other networks, Bech32 checksums and non-TEX input', () => {
    expect(texToTransparentAddress(TESTNET_TEX, 'zcash')).toBeNull();
    expect(texToTransparentAddress(ZIP320_TEX, 'bitcoin')).toBeNull();
    expect(texToTransparentAddress(TEX_WITH_BECH32_CHECKSUM, 'zcash')).toBe(
      null,
    );
    expect(texToTransparentAddress(ZIP320_T1, 'zcash')).toBeNull();
    expect(texToTransparentAddress('', 'zcash')).toBeNull();
  });
});

describe('TEX encoding (what the screens show)', () => {
  it('encodes the ZIP 320 example from its t1 address', () => {
    expect(transparentToTexAddress(ZIP320_T1, 'zcash')).toBe(ZIP320_TEX);
  });

  it('round-trips any key hash', () => {
    for (const fill of [0, 1, 0x7f, 0x80, 0xff]) {
      const t1 = utxolib.address.fromOutputScript(
        utxolib.script.pubKeyHash.output.encode(Buffer.alloc(20, fill)),
        utxolib.networks.zcash,
      );
      const tex = transparentToTexAddress(t1, 'zcash') as string;
      expect(tex.startsWith('tex1')).toBe(true);
      expect(texToTransparentAddress(tex, 'zcash')).toBe(t1);
    }
  });

  it('encodes nothing but a Zcash P2PKH address', () => {
    const t3 = utxolib.address.fromOutputScript(
      utxolib.script.scriptHash.output.encode(Buffer.alloc(20, 3)),
      utxolib.networks.zcash,
    );
    expect(transparentToTexAddress(t3, 'zcash')).toBeNull();
    expect(transparentToTexAddress(ZIP320_T1, 'bitcoin')).toBeNull();
    expect(transparentToTexAddress(ZIP320_TEX, 'zcash')).toBeNull();
    expect(transparentToTexAddress('garbage', 'zcash')).toBeNull();
  });
});

describe('applyZcashTexReceiver (consumer approval)', () => {
  it('shows the TEX address the user entered for the output it encodes', () => {
    const info = applyZcashTexReceiver(
      decoded([{ address: ZIP320_T1, amount: '1' }]),
      'zec',
      ZIP320_TEX,
    );
    expect(info.error).toBeUndefined();
    expect(info.receiver).toBe(ZIP320_TEX);
    expect(info.recipients).toEqual([
      { address: ZIP320_TEX, amount: '1', transparentAddress: ZIP320_T1 },
    ]);
  });

  it('labels only the matching output of a multi-recipient send', () => {
    const info = applyZcashTexReceiver(
      decoded([
        { address: OTHER_T1, amount: '2' },
        { address: ZIP320_T1, amount: '1' },
      ]),
      'zec',
      ` ${ZIP320_TEX.toUpperCase()} `,
    );
    expect(info.receiver).toBe(OTHER_T1);
    expect(info.recipients).toEqual([
      { address: OTHER_T1, amount: '2' },
      { address: ZIP320_TEX, amount: '1', transparentAddress: ZIP320_T1 },
    ]);
  });

  it('refuses a TEX recipient that no output pays', () => {
    const info = applyZcashTexReceiver(
      decoded([{ address: OTHER_T1, amount: '1' }]),
      'zec',
      ZIP320_TEX,
    );
    expect(info.receiver).toBe('decodingError');
    expect(info.amount).toBe('decodingError');
    expect(info.error).toMatch(/TEX recipient/);
  });

  it('leaves the decode alone without a TEX hint', () => {
    const plain = decoded([{ address: ZIP320_T1, amount: '1' }]);
    expect(applyZcashTexReceiver(plain, 'zec')).toBe(plain);
    expect(applyZcashTexReceiver(plain, 'zec', '')).toBe(plain);
    // a t1 hint, a testnet TEX on mainnet, another chain: nothing to show
    expect(applyZcashTexReceiver(plain, 'zec', ZIP320_T1)).toBe(plain);
    expect(applyZcashTexReceiver(plain, 'zec', TESTNET_TEX)).toBe(plain);
    expect(applyZcashTexReceiver(plain, 'btc', ZIP320_TEX)).toBe(plain);
  });

  it('keeps a failed decode failed', () => {
    const failed: ApprovalInfo = {
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
      tokenSymbol: 'decodingError',
      error: 'boom',
    };
    expect(applyZcashTexReceiver(failed, 'zec', ZIP320_TEX)).toBe(failed);
  });
});

describe('labelVaultTexRecipients (vault approval)', () => {
  it('shows the proposal TEX address for the output it encodes', () => {
    const result = labelVaultTexRecipients(
      [
        { address: ZIP320_T1, amount: '100000' },
        { address: OTHER_T1, amount: '5' },
      ],
      [
        { address: ZIP320_TEX, amount: '0.001' },
        { address: OTHER_T1, amount: '0.00000005' },
      ],
      'zec',
    );
    expect(result.error).toBeUndefined();
    expect(result.recipients).toEqual([
      { address: ZIP320_TEX, amount: '100000', transparentAddress: ZIP320_T1 },
      { address: OTHER_T1, amount: '5' },
    ]);
  });

  it('refuses a proposal TEX recipient that no output pays', () => {
    const recipients = [{ address: OTHER_T1, amount: '100000' }];
    const result = labelVaultTexRecipients(
      recipients,
      [{ address: ZIP320_TEX, amount: '0.001' }],
      'zec',
    );
    expect(result.recipients).toBe(recipients);
    expect(result.error).toMatch(/TEX recipient/);
  });

  it('changes nothing without TEX recipients in the request', () => {
    const recipients = [{ address: ZIP320_T1, amount: '1' }];
    for (const requestRecipients of [
      undefined,
      'not-an-array',
      [{ address: ZIP320_T1 }],
      [{ address: 42 }, null],
    ]) {
      expect(
        labelVaultTexRecipients(recipients, requestRecipients, 'zec'),
      ).toEqual({ recipients });
    }
    expect(
      labelVaultTexRecipients(recipients, [{ address: ZIP320_TEX }], 'btc'),
    ).toEqual({ recipients });
  });
});
