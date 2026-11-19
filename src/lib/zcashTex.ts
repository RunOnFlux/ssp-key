import utxolib from '@runonflux/utxo-lib';
import { Buffer } from 'buffer';

/**
 * Zcash TEX addresses (ZIP 320, "Defining an Address Type to which funds can
 * only be sent from Transparent Addresses").
 *
 * A TEX address is the Bech32m (BIP-350) re-encoding of the 20-byte key hash
 * of a transparent P2PKH address. On chain it is exactly a P2PKH output, so a
 * decoded transaction only ever names the `t1…` form. SSP Wallet builds a
 * payment to `tex1…` as that P2PKH output and tells this device which TEX
 * address the user entered; the approval screens show it in place of the
 * `t1…` form only when it decodes to the very key hash the output pays (see
 * applyZcashTexReceiver / labelVaultTexRecipients in ./transactions).
 *
 * Same decoder as SSP Wallet's src/lib/zcashTex.ts: utxo-lib's zcash networks
 * know no Bech32 HRP and its bech32 dependency has no Bech32m.
 */

/** ZIP 320 human-readable parts, keyed by utxo-lib network id. */
export const ZCASH_TEX_HRPS: Readonly<Record<string, string>> = {
  zcash: 'tex',
  zcashTest: 'textest',
};

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32M_CONST = 0x2bc830a3;
const BECH32_GENERATOR = [
  0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
];
const BECH32_MAX_LENGTH = 90;
const TEX_KEY_HASH_LENGTH = 20;

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    BECH32_GENERATOR.forEach((generator, i) => {
      if ((top >>> i) & 1) {
        chk ^= generator;
      }
    });
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) {
    const code = hrp.charCodeAt(i);
    high.push(code >>> 5);
    low.push(code & 31);
  }
  return [...high, 0, ...low];
}

/**
 * Strict BIP-350 Bech32m decode. Returns the lower-cased HRP and the 5-bit data
 * words (checksum stripped), or null for anything that is not a valid Bech32m
 * string — including a valid *Bech32* (BIP-173) checksum, which ZIP 320 does
 * not allow for TEX.
 */
export function decodeBech32m(
  input: string,
): { hrp: string; words: number[] } | null {
  if (input.length < 8 || input.length > BECH32_MAX_LENGTH) {
    return null;
  }
  let hasLower = false;
  let hasUpper = false;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 33 || code > 126) {
      return null;
    }
    if (code >= 97 && code <= 122) hasLower = true;
    if (code >= 65 && code <= 90) hasUpper = true;
  }
  if (hasLower && hasUpper) {
    return null;
  }
  const str = input.toLowerCase();
  const separator = str.lastIndexOf('1');
  if (separator < 1 || separator + 7 > str.length) {
    return null;
  }
  const hrp = str.slice(0, separator);
  const data: number[] = [];
  for (const char of str.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(char);
    if (value === -1) {
      return null;
    }
    data.push(value);
  }
  if (bech32Polymod([...bech32HrpExpand(hrp), ...data]) !== BECH32M_CONST) {
    return null;
  }
  return { hrp, words: data.slice(0, -6) };
}

/** 5-bit words → bytes, rejecting leftover bits or non-zero padding. */
function wordsToBytes(words: number[]): Uint8Array | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const word of words) {
    acc = (acc << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >>> bits) & 0xff);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits >= 5 || acc !== 0) {
    return null;
  }
  return Uint8Array.from(out);
}

/**
 * Decode a TEX address for the given utxo-lib network id to its 20-byte P2PKH
 * key hash. Returns null when the network has no TEX encoding, the HRP is for
 * a different network (e.g. `textest` on mainnet), or the string is not a
 * well-formed TEX address.
 */
export function decodeTexKeyHash(
  address: string,
  libid: string,
): Uint8Array | null {
  const expectedHrp = ZCASH_TEX_HRPS[libid];
  if (!expectedHrp) {
    return null;
  }
  const decoded = decodeBech32m(address.trim());
  if (!decoded || decoded.hrp !== expectedHrp) {
    return null;
  }
  const keyHash = wordsToBytes(decoded.words);
  if (!keyHash || keyHash.length !== TEX_KEY_HASH_LENGTH) {
    return null;
  }
  return keyHash;
}

/**
 * Resolve a TEX address to the transparent P2PKH address with the same key
 * hash (`tex1…` → `t1…`, `textest1…` → `tm…`). Returns null when `address` is
 * not a valid TEX address for the network, so callers can fall back to the
 * address as typed: `texToTransparentAddress(a, libid) ?? a`.
 */
export function texToTransparentAddress(
  address: string,
  libid: string,
): string | null {
  const keyHash = decodeTexKeyHash(address, libid);
  if (!keyHash) {
    return null;
  }
  const network = utxolib.networks[libid];
  if (!network) {
    return null;
  }
  try {
    const script = utxolib.script.pubKeyHash.output.encode(
      Buffer.from(keyHash),
    );
    return utxolib.address.fromOutputScript(script, network);
  } catch {
    return null;
  }
}

/** Bytes → 5-bit words, zero-padding the last word. */
function bytesToWords(bytes: number[]): number[] {
  let acc = 0;
  let bits = 0;
  const words: number[] = [];
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >>> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) {
    words.push((acc << (5 - bits)) & 31);
  }
  return words;
}

/** BIP-350 Bech32m encoding of `words` under `hrp` (lower case). */
function encodeBech32m(hrp: string, words: number[]): string {
  const polymod =
    bech32Polymod([...bech32HrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^
    BECH32M_CONST;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    checksum.push((polymod >>> (5 * (5 - i))) & 31);
  }
  return `${hrp}1${[...words, ...checksum]
    .map((word) => BECH32_CHARSET[word])
    .join('')}`;
}

/**
 * The TEX address of a transparent P2PKH address (`t1…` → `tex1…`), encoded
 * here from the key hash in its output script. The approval screens show this,
 * never a string from the request: for a decoded output it is fixed by the
 * transaction alone. Null for anything that is not a P2PKH address of a
 * network with a TEX encoding (P2SH `t3…`, other chains, garbage).
 */
export function transparentToTexAddress(
  address: string,
  libid: string,
): string | null {
  const hrp = ZCASH_TEX_HRPS[libid];
  const network = utxolib.networks[libid];
  if (!hrp || !network) {
    return null;
  }
  let script: number[];
  try {
    script = Array.from(utxolib.address.toOutputScript(address, network));
  } catch {
    return null;
  }
  // OP_DUP OP_HASH160 <20-byte key hash> OP_EQUALVERIFY OP_CHECKSIG
  if (
    script.length !== 25 ||
    script[0] !== 0x76 ||
    script[1] !== 0xa9 ||
    script[2] !== TEX_KEY_HASH_LENGTH ||
    script[23] !== 0x88 ||
    script[24] !== 0xac
  ) {
    return null;
  }
  return encodeBech32m(hrp, bytesToWords(script.slice(3, 23)));
}
