// Use `node:crypto` explicitly — `'crypto'` is aliased to react-native-
// quick-crypto by the RN jest preset.
const { createECDH, randomBytes } = require('node:crypto');
import { Buffer } from 'buffer';

// The global jest.setup.js mock for `react-native-quick-crypto` only
// stubs `randomBytes` and `createHash` — our module also needs
// `createECDH` and `createCipheriv`. Override here by delegating to
// Node's real `crypto` module for this test file.
jest.mock('react-native-quick-crypto', () => {
  // The `react-native` jest preset aliases `crypto` to `react-native-
  // quick-crypto`, so `jest.requireActual('crypto')` recurses into the
  // very module we're trying to mock. Use `node:crypto` which the preset
  // does not remap to get Node's real crypto.
  const nodeCrypto = jest.requireActual('node:crypto');
  return {
    __esModule: true,
    default: {
      randomBytes: nodeCrypto.randomBytes,
      createHash: nodeCrypto.createHash,
      createECDH: nodeCrypto.createECDH,
      createCipheriv: nodeCrypto.createCipheriv,
      createDecipheriv: nodeCrypto.createDecipheriv,
    },
  };
});

import {
  wrapSkRForTransit,
  TRANSIT_VERSION,
} from '../../src/lib/recoveryCrypto';

/**
 * ssp-key's recoveryCrypto only implements the transit wrap side of the
 * protocol (the wallet does the ECIES envelope build + ECIES + transit
 * unwrap). Tests here verify:
 *   1. The transit byte layout is correct (version byte, iv, ciphertext+tag).
 *   2. Output is hex-decodable and the right length.
 *   3. Wrong-sized sk_r is rejected.
 *   4. Running wrap twice produces different ciphertext (fresh IV).
 *
 * Round-trip correctness (wrap ↔ unwrap) is already covered by the
 * ssp-wallet integration test which uses the same wire format.
 */

function genKeypair() {
  const dh = createECDH('secp256k1');
  dh.generateKeys();
  return {
    priv: dh.getPrivateKey(),
    pub: dh.getPublicKey(null, 'compressed'),
  };
}

describe('recoveryCrypto (ssp-key side)', () => {
  describe('wrapSkRForTransit', () => {
    test('produces a hex string with the expected byte layout', () => {
      const sspKey = genKeypair();
      const walletEph = genKeypair();
      const skR = randomBytes(32);

      const wrapped = wrapSkRForTransit(sspKey.priv, walletEph.pub, skR);
      const bytes = Buffer.from(wrapped, 'hex');

      // [1 byte version][12 byte iv][32 byte ciphertext][16 byte tag] = 61 bytes
      expect(bytes.length).toBe(1 + 12 + 32 + 16);
      expect(bytes[0]).toBe(TRANSIT_VERSION);
      expect(TRANSIT_VERSION).toBe(0x01);
    });

    test('produces different ciphertexts on repeated calls (fresh IV)', () => {
      const sspKey = genKeypair();
      const walletEph = genKeypair();
      const skR = randomBytes(32);

      const a = wrapSkRForTransit(sspKey.priv, walletEph.pub, skR);
      const b = wrapSkRForTransit(sspKey.priv, walletEph.pub, skR);

      expect(a).not.toBe(b);
    });

    test('rejects sk_r that is not 32 bytes', () => {
      const sspKey = genKeypair();
      const walletEph = genKeypair();

      expect(() =>
        wrapSkRForTransit(sspKey.priv, walletEph.pub, randomBytes(16)),
      ).toThrow(/sk_r must be 32 bytes/);
      expect(() =>
        wrapSkRForTransit(sspKey.priv, walletEph.pub, randomBytes(64)),
      ).toThrow(/sk_r must be 32 bytes/);
    });

    test('output is valid hex (decodable)', () => {
      const sspKey = genKeypair();
      const walletEph = genKeypair();
      const wrapped = wrapSkRForTransit(
        sspKey.priv,
        walletEph.pub,
        randomBytes(32),
      );
      expect(/^[0-9a-f]+$/.test(wrapped)).toBe(true);
      expect(wrapped.length % 2).toBe(0);
    });
  });
});
