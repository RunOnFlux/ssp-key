// @ts-nocheck test suite — utxo-lib ships no types
import utxolib from '@runonflux/utxo-lib';
import { Buffer } from 'buffer';
import { createHash, randomBytes } from 'crypto';
import {
  fastUtxoSigner,
  verifyUtxoSignature,
} from '../../src/lib/fastSecp256k1';

/**
 * The noble-backed verify/sign must behave exactly like utxo-lib's own
 * ECDSA: same accept/reject decisions, byte-identical signatures.
 */

const N = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
);

const toBig = (buf) => BigInt(`0x${buf.toString('hex')}`);
const fromBig = (n) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

function sigFromRS(r, s) {
  // Round-trip through DER so the object is a real utxo-lib ECSignature.
  const der = (x) => {
    let b = x;
    while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
    return Buffer.concat([Buffer.from([0x02, b.length]), b]);
  };
  const body = Buffer.concat([der(r), der(s)]);
  return utxolib.ECSignature.fromDER(
    Buffer.concat([Buffer.from([0x30, body.length]), body]),
  );
}

describe('fastSecp256k1', () => {
  it('accepts and rejects exactly what utxo-lib does', () => {
    for (let i = 0; i < 20; i += 1) {
      const pair = utxolib.ECPair.makeRandom();
      const hash = createHash('sha256').update(randomBytes(32)).digest();
      const sig = pair.sign(hash);
      const pub = pair.getPublicKeyBuffer();
      expect(verifyUtxoSignature(hash, sig, pub)).toBe(true);
      expect(pair.verify(hash, sig)).toBe(true);

      const otherHash = createHash('sha256').update(hash).digest();
      expect(verifyUtxoSignature(otherHash, sig, pub)).toBe(false);
      expect(pair.verify(otherHash, sig)).toBe(false);

      const otherPub = utxolib.ECPair.makeRandom().getPublicKeyBuffer();
      expect(verifyUtxoSignature(hash, sig, otherPub)).toBe(false);
    }
  });

  it('accepts a high-S signature, like utxo-lib', () => {
    const pair = utxolib.ECPair.makeRandom();
    const hash = createHash('sha256').update('high-s').digest();
    const sig = pair.sign(hash);
    const r = sig.r.toBuffer(32);
    const highS = fromBig(N - toBig(sig.s.toBuffer(32)));
    const flipped = sigFromRS(r, highS);
    expect(pair.verify(hash, flipped)).toBe(true);
    expect(verifyUtxoSignature(hash, flipped, pair.getPublicKeyBuffer())).toBe(
      true,
    );
  });

  it('never throws on malformed input', () => {
    const pair = utxolib.ECPair.makeRandom();
    const hash = createHash('sha256').update('x').digest();
    const sig = pair.sign(hash);
    expect(verifyUtxoSignature(hash, sig, Buffer.alloc(33, 7))).toBe(false);
    expect(verifyUtxoSignature(hash, sig, Buffer.alloc(5))).toBe(false);
  });

  it('signs byte-identically to utxo-lib (RFC 6979, low-S)', () => {
    for (let i = 0; i < 20; i += 1) {
      const pair = utxolib.ECPair.makeRandom();
      const hash = createHash('sha256').update(randomBytes(32)).digest();
      const expected = pair.sign(hash).toDER().toString('hex');
      const actual = fastUtxoSigner(pair).sign(hash).toDER().toString('hex');
      expect(actual).toBe(expected);
    }
  });

  it('refuses a key pair without a private key', () => {
    const pub = utxolib.ECPair.fromPublicKeyBuffer(
      utxolib.ECPair.makeRandom().getPublicKeyBuffer(),
    );
    expect(() => fastUtxoSigner(pub)).toThrow(/Missing private key/);
  });
});
