/**
 * `secp256k1` (v5 API) for @runonflux/aa-schnorr-multisig-sdk, on @noble/curves.
 *
 * In React Native the `secp256k1` package cannot load its native binding and
 * falls back to its pure-JS `elliptic` backend. Hermes has no JIT, so every
 * EVM Schnorr operation on SSP Key — the signature for a send, and above all
 * vault verification, which builds the combined key of every M-of-N key
 * combination — spent ~26 ms per point multiplication and froze the screen for
 * seconds. noble does the same multiplication ~10x faster (key creation ~40x)
 * without a JIT.
 *
 * Metro resolves the SDK's `require('secp256k1')` here (metro.config.js);
 * nothing else in the app uses this file. It implements exactly the functions
 * the SDK calls, with the v5 wrapper's argument checks, error messages, return
 * values and in-place behaviour (privateKeyTweakAdd / privateKeyTweakMul
 * overwrite the private key they are given — the SDK relies on it), and the
 * elliptic backend's arithmetic, including its edge cases. Byte-for-byte
 * parity with secp256k1@5/elliptic is pinned by
 * __tests__/lib/secp256k1Noble.test.ts. Anything else throws, so an SDK
 * upgrade that starts using another function fails loudly instead of silently.
 *
 * Plain CommonJS on purpose: the SDK reads it both as
 * `require('secp256k1').fn` and as `__importDefault(require('secp256k1')).default.fn`.
 */
const { secp256k1 } = require('@noble/curves/secp256k1.js');

const Point = secp256k1.ProjectivePoint;
const N = secp256k1.CURVE.n;
const P = secp256k1.CURVE.p;

const errors = {
  TWEAK_ADD:
    'The tweak was out of range or the resulted private key is invalid',
  TWEAK_MUL: 'The tweak was out of range or equal to zero',
  SECKEY_INVALID: 'Private Key is invalid',
  PUBKEY_PARSE: 'Public Key could not be parsed',
  PUBKEY_COMBINE: 'The sum of the public keys is not valid',
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function isUint8Array(name, value, length) {
  assert(value instanceof Uint8Array, `Expected ${name} to be an Uint8Array`);
  if (length !== undefined) {
    if (Array.isArray(length)) {
      const numbers = length.join(', ');
      const msg = `Expected ${name} to be an Uint8Array with length [${numbers}]`;
      assert(length.includes(value.length), msg);
    } else {
      const msg = `Expected ${name} to be an Uint8Array with length ${length}`;
      assert(value.length === length, msg);
    }
  }
}

function toTypeString(value) {
  return Object.prototype.toString.call(value).slice(8, -1);
}

function isCompressed(value) {
  assert(
    toTypeString(value) === 'Boolean',
    'Expected compressed to be a Boolean',
  );
}

function getAssertedOutput(output = (len) => new Uint8Array(len), length) {
  if (typeof output === 'function') output = output(length);
  isUint8Array('output', output, length);
  return output;
}

function toBigInt(bytes) {
  let value = 0n;
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << 8n) | BigInt(bytes[i]);
  }
  return value;
}

function toBytes32(value) {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** elliptic backend's loadPublicKey: 02/03, 04 and hybrid 06/07; null if invalid. */
function loadPublicKey(pubkey) {
  const first = pubkey[0];
  let bytes;
  switch (first) {
    case 0x02:
    case 0x03:
      if (pubkey.length !== 33) return null;
      bytes = pubkey;
      break;
    case 0x04:
    case 0x06:
    case 0x07: {
      if (pubkey.length !== 65) return null;
      if (first !== 0x04) {
        const yOdd = (pubkey[64] & 1) === 1;
        if (yOdd !== (first === 0x07)) return null;
      }
      bytes = new Uint8Array(pubkey);
      bytes[0] = 0x04;
      break;
    }
    default:
      return null;
  }
  // x (and y) must be below the field prime; noble also checks the point is
  // on the curve, as elliptic does.
  if (toBigInt(bytes.subarray(1, 33)) >= P) return null;
  if (bytes.length === 65 && toBigInt(bytes.subarray(33, 65)) >= P) {
    return null;
  }
  try {
    return Point.fromHex(bytes);
  } catch {
    return null;
  }
}

function savePublicKey(output, point) {
  const encoded = point.toRawBytes(output.length === 33);
  for (let i = 0; i < output.length; i += 1) output[i] = encoded[i];
}

function unsupported(name) {
  return () => {
    throw new Error(
      `secp256k1.${name} is not implemented by SSP Key's noble backend`,
    );
  };
}

const api = {
  privateKeyVerify(seckey) {
    isUint8Array('private key', seckey, 32);
    const k = toBigInt(seckey);
    return k < N && k !== 0n;
  },

  privateKeyTweakAdd(seckey, tweak) {
    isUint8Array('private key', seckey, 32);
    isUint8Array('tweak', tweak, 32);
    let value = toBigInt(tweak);
    if (value >= N) throw new Error(errors.TWEAK_ADD);
    value += toBigInt(seckey);
    if (value >= N) value -= N;
    if (value === 0n) throw new Error(errors.TWEAK_ADD);
    seckey.set(toBytes32(value));
    return seckey;
  },

  privateKeyTweakMul(seckey, tweak) {
    isUint8Array('private key', seckey, 32);
    isUint8Array('tweak', tweak, 32);
    let value = toBigInt(tweak);
    if (value >= N || value === 0n) throw new Error(errors.TWEAK_MUL);
    value *= toBigInt(seckey);
    if (value >= N) value %= N;
    seckey.set(toBytes32(value));
    return seckey;
  },

  publicKeyVerify(pubkey) {
    isUint8Array('public key', pubkey, [33, 65]);
    return loadPublicKey(pubkey) !== null;
  },

  publicKeyCreate(seckey, compressed = true, output) {
    isUint8Array('private key', seckey, 32);
    isCompressed(compressed);
    output = getAssertedOutput(output, compressed ? 33 : 65);
    const k = toBigInt(seckey);
    if (k >= N || k === 0n) throw new Error(errors.SECKEY_INVALID);
    savePublicKey(output, Point.BASE.multiply(k));
    return output;
  },

  publicKeyConvert(pubkey, compressed = true, output) {
    isUint8Array('public key', pubkey, [33, 65]);
    isCompressed(compressed);
    output = getAssertedOutput(output, compressed ? 33 : 65);
    const point = loadPublicKey(pubkey);
    if (point === null) throw new Error(errors.PUBKEY_PARSE);
    savePublicKey(output, point);
    return output;
  },

  publicKeyCombine(pubkeys, compressed = true, output) {
    assert(Array.isArray(pubkeys), 'Expected public keys to be an Array');
    assert(
      pubkeys.length > 0,
      'Expected public keys array will have more than zero items',
    );
    for (const pubkey of pubkeys) {
      isUint8Array('public key', pubkey, [33, 65]);
    }
    isCompressed(compressed);
    output = getAssertedOutput(output, compressed ? 33 : 65);
    const points = pubkeys.map(loadPublicKey);
    if (points.some((point) => point === null)) {
      throw new Error(errors.PUBKEY_PARSE);
    }
    let sum = points[0];
    for (let i = 1; i < points.length; i += 1) sum = sum.add(points[i]);
    if (sum.equals(Point.ZERO)) throw new Error(errors.PUBKEY_COMBINE);
    savePublicKey(output, sum);
    return output;
  },

  publicKeyTweakMul(pubkey, tweak, compressed = true, output) {
    isUint8Array('public key', pubkey, [33, 65]);
    isUint8Array('tweak', tweak, 32);
    isCompressed(compressed);
    output = getAssertedOutput(output, compressed ? 33 : 65);
    const point = loadPublicKey(pubkey);
    if (point === null) throw new Error(errors.PUBKEY_PARSE);
    const t = toBigInt(tweak);
    if (t >= N || t === 0n) throw new Error(errors.TWEAK_MUL);
    savePublicKey(output, point.multiply(t));
    return output;
  },

  contextRandomize: unsupported('contextRandomize'),
  privateKeyNegate: unsupported('privateKeyNegate'),
  publicKeyNegate: unsupported('publicKeyNegate'),
  publicKeyTweakAdd: unsupported('publicKeyTweakAdd'),
  signatureNormalize: unsupported('signatureNormalize'),
  signatureExport: unsupported('signatureExport'),
  signatureImport: unsupported('signatureImport'),
  ecdsaSign: unsupported('ecdsaSign'),
  ecdsaVerify: unsupported('ecdsaVerify'),
  ecdsaRecover: unsupported('ecdsaRecover'),
  ecdh: unsupported('ecdh'),
};

module.exports = api;
