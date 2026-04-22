import { HDKey } from '@scure/bip32';
// Use `node:crypto` explicitly — `'crypto'` is aliased to react-native-
// quick-crypto by the RN jest preset.
const { createECDH, createDecipheriv, createHash } = require('node:crypto');
import { Buffer } from 'buffer';

// Override the global jest.setup.js mock for `react-native-quick-crypto`
// with real Node crypto for this test file (the global mock only stubs
// randomBytes+createHash, not ECDH/cipher primitives).
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

import { getMasterXpriv } from '../../src/lib/wallet';
import { buildRecoveryResponse } from '../../src/lib/recoveryHandler';

/**
 * Tests for the ssp-key-side recovery handler.
 *
 * Verifies:
 *   1. Input validation rejects malformed pkEph / nonce.
 *   2. The nonce + timestamp are echoed back unchanged.
 *   3. The transit ciphertext is decryptable by the wallet ephemeral key
 *      using the same ECDH-derived AES key (wire format matches the
 *      wallet's `unwrapSkRFromTransit`).
 *   4. The unwrapped sk_r equals the BIP32 /11/0 derivation from the
 *      same seed.
 */

const MNEMONIC =
  'silver trouble mountain crouch angry park film strong escape theory illegal bunker cargo taxi tuna real drift alert state match great escape option explain';

function genEphemeralKeypair() {
  const dh = createECDH('secp256k1');
  dh.generateKeys();
  return {
    priv: dh.getPrivateKey(),
    pub: dh.getPublicKey(null, 'compressed'),
  };
}

function ecdh(privKey: Buffer, otherPubKey: Buffer): Buffer {
  const dh = createECDH('secp256k1');
  dh.setPrivateKey(privKey);
  return dh.computeSecret(otherPubKey);
}

function deriveTransitKey(sharedSecret: Buffer): Buffer {
  return createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from('SSP-RECOVERY-TRANSIT-v1', 'utf8'),
        sharedSecret,
      ]),
    )
    .digest();
}

function getBtcIdentityXpriv(): string {
  return getMasterXpriv(MNEMONIC, 48, 0, 0, 'p2wsh', 'btc');
}

describe('recoveryHandler.buildRecoveryResponse', () => {
  test('echoes nonce and timestamp from the request', () => {
    const xpriv = getBtcIdentityXpriv();
    const eph = genEphemeralKeypair();
    const nonce = 'aa'.repeat(16);
    const timestamp = 1_700_000_000;

    const response = buildRecoveryResponse({
      xprivKeyIdentity: xpriv,
      request: {
        pkEph: eph.pub.toString('hex'),
        nonce,
        timestamp,
      },
      identityChain: 'btc' as const,
    });

    expect(response.nonce).toBe(nonce);
    expect(response.timestamp).toBe(timestamp);
    expect(typeof response.transit).toBe('string');
    expect(response.transit.length).toBeGreaterThan(0);
  });

  test('produces a transit ciphertext decryptable by the wallet ephemeral key', () => {
    const xpriv = getBtcIdentityXpriv();
    const eph = genEphemeralKeypair();

    const response = buildRecoveryResponse({
      xprivKeyIdentity: xpriv,
      request: {
        pkEph: eph.pub.toString('hex'),
        nonce: 'cd'.repeat(16),
        timestamp: 1_700_000_000,
      },
      identityChain: 'btc' as const,
    });

    const bytes = Buffer.from(response.transit, 'hex');
    expect(bytes[0]).toBe(0x01); // version

    const iv = bytes.subarray(1, 13);
    const ciphertext = bytes.subarray(13, 13 + 32);
    const tag = bytes.subarray(13 + 32);

    // Wallet-side view: derive ssp-key's identity pubkey (the envelope
    // stores this as `keyIdentityPubKey`) from the same xpriv.
    const { blockchains } = require('@storage/blockchains');
    const master = HDKey.fromExtendedKey(xpriv, blockchains.btc.bip32);
    const identityChild = master.deriveChild(10).deriveChild(0);
    const sspKeyIdentityPub = Buffer.from(identityChild.publicKey!);

    // Wallet-side ECDH: walletEphPriv + sspKeyIdentityPub.
    const shared = ecdh(eph.priv, sspKeyIdentityPub);
    const aesKey = deriveTransitKey(shared);

    const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
    decipher.setAuthTag(tag);
    const skR = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    expect(skR.length).toBe(32);

    // And the unwrapped sk_r must match the /11/0 derivation from the seed.
    const recoveryChild = master.deriveChild(11).deriveChild(0);
    const expectedSkR = Buffer.from(recoveryChild.privateKey!);
    expect(skR.equals(expectedSkR)).toBe(true);
  });

  test('rejects a malformed pkEph (wrong length)', () => {
    const xpriv = getBtcIdentityXpriv();
    expect(() =>
      buildRecoveryResponse({
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: '02aabb',
          nonce: 'cd'.repeat(16),
          timestamp: 1_700_000_000,
        },
        identityChain: 'btc' as const,
      }),
    ).toThrow(/invalid pkEph/);
  });

  test('rejects a malformed pkEph (non-hex)', () => {
    const xpriv = getBtcIdentityXpriv();
    expect(() =>
      buildRecoveryResponse({
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: 'zz'.repeat(33),
          nonce: 'cd'.repeat(16),
          timestamp: 1_700_000_000,
        },
        identityChain: 'btc' as const,
      }),
    ).toThrow(/invalid pkEph/);
  });

  test('rejects a malformed nonce (non-hex)', () => {
    const xpriv = getBtcIdentityXpriv();
    const eph = genEphemeralKeypair();
    expect(() =>
      buildRecoveryResponse({
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: eph.pub.toString('hex'),
          nonce: 'not-hex!',
          timestamp: 1_700_000_000,
        },
        identityChain: 'btc' as const,
      }),
    ).toThrow(/invalid nonce/);
  });

  test('produces different transit ciphertexts on repeated calls (fresh IV)', () => {
    const xpriv = getBtcIdentityXpriv();
    const eph = genEphemeralKeypair();
    const request = {
      pkEph: eph.pub.toString('hex'),
      nonce: 'cd'.repeat(16),
      timestamp: 1_700_000_000,
    };

    const a = buildRecoveryResponse({
      xprivKeyIdentity: xpriv,
      request,
      identityChain: 'btc' as const,
    });
    const b = buildRecoveryResponse({
      xprivKeyIdentity: xpriv,
      request,
      identityChain: 'btc' as const,
    });

    expect(a.transit).not.toBe(b.transit);
    expect(a.nonce).toBe(b.nonce);
    expect(a.timestamp).toBe(b.timestamp);
  });
});
