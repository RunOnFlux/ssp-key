/**
 * secp256k1 ECDSA for UTXO inputs via @noble/curves.
 *
 * utxo-lib's own ECDSA runs on the pure-JS `elliptic` fallback in React
 * Native (there is no native secp256k1 binding), which costs tens of
 * milliseconds per signature on Hermes. Approving a transaction verifies the
 * wallet's signature on every input and then signs every input, so the
 * approval screen sat on "Reading this transaction…" for seconds — minutes
 * for transactions with thousands of inputs. noble does the same maths on
 * native BigInt, an order of magnitude faster.
 *
 * Behaviour is unchanged:
 *  - verify accepts the same signatures as before (high-S included — the
 *    wallet's signatures were never restricted to low-S here);
 *  - sign is deterministic RFC 6979 with low-S, exactly like utxo-lib's
 *    signer, so it produces byte-identical signatures (covered by tests).
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import utxolib from '@runonflux/utxo-lib';
import { Buffer } from 'buffer';

// utxo-lib ships no types for ECSignature / ECPair internals.
const lib: any = utxolib;

interface UtxoLibSignature {
  r: { toBuffer: (size: number) => Buffer };
  s: { toBuffer: (size: number) => Buffer };
}

/**
 * Verify an ECDSA signature (utxo-lib ECSignature, as returned by
 * `ECSignature.parseScriptSignature(...).signature`) over a 32-byte sighash.
 * Never throws: anything malformed is simply not a valid signature.
 */
export function verifyUtxoSignature(
  hash: Uint8Array,
  signature: UtxoLibSignature,
  publicKey: Uint8Array,
): boolean {
  try {
    const compact = Buffer.concat([
      signature.r.toBuffer(32),
      signature.s.toBuffer(32),
    ]);
    return secp256k1.verify(compact, hash, publicKey, {
      lowS: false,
      prehash: false,
      format: 'compact',
    });
  } catch {
    return false;
  }
}

interface UtxoLibKeyPair {
  d?: { toBuffer: (size: number) => Buffer };
  network?: unknown;
  getPublicKeyBuffer: () => Buffer;
}

/**
 * Wrap a utxo-lib ECPair so `TransactionBuilder.sign` signs with noble.
 * The wrapper exposes only what the builder uses (network, public key, sign).
 */
export function fastUtxoSigner(ecPair: object): {
  network?: unknown;
  getPublicKeyBuffer: () => Buffer;
  sign: (hash: Buffer) => unknown;
} {
  // The local utxo-lib declaration types ECPair loosely; check what is used.
  const keyPair = ecPair as Partial<UtxoLibKeyPair>;
  if (!keyPair.d || typeof keyPair.getPublicKeyBuffer !== 'function') {
    throw new Error('Missing private key');
  }
  const privateKey = keyPair.d.toBuffer(32);
  const publicKey = keyPair.getPublicKeyBuffer();
  return {
    network: keyPair.network,
    getPublicKeyBuffer: () => publicKey,
    sign: (hash: Buffer) => {
      const sig = secp256k1.sign(hash, privateKey, {
        lowS: true,
        prehash: false,
      });
      return lib.ECSignature.fromDER(Buffer.from(sig.toDERRawBytes()));
    },
  };
}
