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
import {
  buildRecoveryResponse,
  resetAnsweredNonces,
} from '../../src/lib/recoveryHandler';
import { deriveRecoveryAccount } from '../../src/lib/recoveryAccount';

/**
 * Tests for the ssp-key-side recovery handler.
 *
 * Verifies:
 *   1. Input validation rejects malformed pkEph / nonce.
 *   2. The nonce + timestamp are echoed back unchanged.
 *   3. The transit ciphertext is decryptable by the wallet ephemeral key
 *      using the same ECDH-derived AES key (wire format matches the
 *      wallet's `unwrapSkRFromTransit`).
 *   4. The unwrapped sk_r is sk_r(i) drawn from the recovery account under
 *      BIP-48.
 *   5. Requests are single-use and time-bounded, and the recovery index
 *      selects a distinct key (rotation).
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

/** m/48'/0'/99'/2' — the recovery account whose sk_r is released. */
function getRecoveryXpriv(): string {
  return deriveRecoveryAccount(MNEMONIC, 'btc').xpriv;
}

/** Unique per call: the handler refuses a nonce it has already answered. */
let nonceCounter = 0;
function freshNonce(): string {
  nonceCounter += 1;
  return nonceCounter.toString(16).padStart(4, '0') + 'bb'.repeat(14);
}

describe('recoveryHandler.buildRecoveryResponse', () => {
  beforeEach(() => {
    resetAnsweredNonces();
  });

  test('echoes nonce and timestamp from the request', () => {
    const xpriv = getBtcIdentityXpriv();
    const eph = genEphemeralKeypair();
    const nonce = 'aa'.repeat(16);
    const timestamp = Date.now();

    const response = buildRecoveryResponse({
      xprivRecovery: getRecoveryXpriv(),
      xprivKeyIdentity: xpriv,
      request: {
        pkEph: eph.pub.toString('hex'),
        nonce,
        timestamp,
        recoveryIndex: 0,
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
      xprivRecovery: getRecoveryXpriv(),
      xprivKeyIdentity: xpriv,
      request: {
        pkEph: eph.pub.toString('hex'),
        nonce: 'cd'.repeat(16),
        timestamp: Date.now(),
        recoveryIndex: 0,
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

    // sk_r must be sk_r(0) under the recovery account m/48'/0'/99'/2'/0/0.
    const recoveryAccount = HDKey.fromExtendedKey(
      getRecoveryXpriv(),
      blockchains.btc.bip32,
    );
    const expectedSkR = Buffer.from(
      recoveryAccount.deriveChild(0).deriveChild(0).privateKey!,
    );
    expect(skR.equals(expectedSkR)).toBe(true);
  });

  test('lives in its own hardened account under BIP-48', () => {
    const xpriv = getBtcIdentityXpriv();
    const { blockchains } = require('@storage/blockchains');
    const signingAccount = HDKey.fromExtendedKey(xpriv, blockchains.btc.bip32);

    // 99' is hardened, so this account sits outside anything the wallet's
    // xpub covers.
    expect(() =>
      HDKey.fromExtendedKey(
        signingAccount.publicExtendedKey,
        blockchains.btc.bip32,
      ).deriveChild(99 + 0x80000000),
    ).toThrow();

    // Each account yields its own keys at the change levels BIP-48 defines.
    const recoveryAccount = HDKey.fromExtendedKey(
      getRecoveryXpriv(),
      blockchains.btc.bip32,
    );
    const skR = Buffer.from(
      recoveryAccount.deriveChild(0).deriveChild(0).privateKey!,
    );
    for (const change of [0, 1]) {
      const sibling = Buffer.from(
        signingAccount.deriveChild(change).deriveChild(0).privateKey!,
      );
      expect(skR.equals(sibling)).toBe(false);
    }
  });

  test('rejects a malformed pkEph (wrong length)', () => {
    const xpriv = getBtcIdentityXpriv();
    expect(() =>
      buildRecoveryResponse({
        xprivRecovery: getRecoveryXpriv(),
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: '02aabb',
          nonce: 'cd'.repeat(16),
          timestamp: Date.now(),
          recoveryIndex: 0,
        },
        identityChain: 'btc' as const,
      }),
    ).toThrow(/invalid pkEph/);
  });

  test('rejects a malformed pkEph (non-hex)', () => {
    const xpriv = getBtcIdentityXpriv();
    expect(() =>
      buildRecoveryResponse({
        xprivRecovery: getRecoveryXpriv(),
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: 'zz'.repeat(33),
          nonce: 'cd'.repeat(16),
          timestamp: Date.now(),
          recoveryIndex: 0,
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
        xprivRecovery: getRecoveryXpriv(),
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: eph.pub.toString('hex'),
          nonce: 'not-hex!',
          timestamp: Date.now(),
          recoveryIndex: 0,
        },
        identityChain: 'btc' as const,
      }),
    ).toThrow(/invalid nonce/);
  });

  test('produces different transit ciphertexts on repeated calls (fresh IV)', () => {
    const xpriv = getBtcIdentityXpriv();
    const eph = genEphemeralKeypair();
    const timestamp = Date.now();
    // Distinct nonces: a nonce is answerable only once, so this exercises IV
    // freshness rather than the single-use guard.
    const mk = (nonce: string) =>
      buildRecoveryResponse({
        xprivRecovery: getRecoveryXpriv(),
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: eph.pub.toString('hex'),
          nonce,
          timestamp,
          recoveryIndex: 0,
        },
        identityChain: 'btc' as const,
      });

    const a = mk(freshNonce());
    const b = mk(freshNonce());

    expect(a.transit).not.toBe(b.transit);
    expect(a.timestamp).toBe(b.timestamp);
  });

  test('answers each request exactly once', () => {
    const xpriv = getBtcIdentityXpriv();
    const eph = genEphemeralKeypair();
    const request = {
      pkEph: eph.pub.toString('hex'),
      nonce: freshNonce(),
      timestamp: Date.now(),
      recoveryIndex: 0,
    };
    const call = () =>
      buildRecoveryResponse({
        xprivRecovery: getRecoveryXpriv(),
        xprivKeyIdentity: xpriv,
        request,
        identityChain: 'btc' as const,
      });

    expect(call()).toBeTruthy(); // first answer releases sk_r
    expect(call).toThrow(/already answered/); // and only the first
  });

  test('refuses a stale or future-dated request', () => {
    const xpriv = getBtcIdentityXpriv();
    const eph = genEphemeralKeypair();
    const at = (timestamp: number) => () =>
      buildRecoveryResponse({
        xprivRecovery: getRecoveryXpriv(),
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: eph.pub.toString('hex'),
          nonce: freshNonce(),
          timestamp,
          recoveryIndex: 0,
        },
        identityChain: 'btc' as const,
      });

    expect(at(Date.now() - 10 * 60 * 1000)).toThrow(/accepted window/);
    expect(at(Date.now() + 10 * 60 * 1000)).toThrow(/accepted window/);
    expect(at(Date.now())).not.toThrow();
  });

  test('honours the requested recovery index, enabling rotation', () => {
    const xpriv = getBtcIdentityXpriv();
    const { blockchains } = require('@storage/blockchains');
    const recoveryAccount = HDKey.fromExtendedKey(
      getRecoveryXpriv(),
      blockchains.btc.bip32,
    );
    const mk = (recoveryIndex: number) =>
      buildRecoveryResponse({
        xprivRecovery: getRecoveryXpriv(),
        xprivKeyIdentity: xpriv,
        request: {
          pkEph: genEphemeralKeypair().pub.toString('hex'),
          nonce: freshNonce(),
          timestamp: Date.now(),
          recoveryIndex,
        },
        identityChain: 'btc' as const,
      });

    expect(mk(0).recoveryIndex).toBe(0);
    expect(mk(7).recoveryIndex).toBe(7);
    // The index is answered as asked or not at all — never silently coerced,
    // since the requester's envelope only opens with the index it sealed to.
    expect(() => mk(-1)).toThrow(/recoveryIndex/);
    expect(() => mk(0x80000000)).toThrow(/recoveryIndex/);
    expect(() => mk(1.5)).toThrow(/recoveryIndex/);

    // Distinct indices are distinct keys, which is what makes rotation
    // meaningful: a released sk_r(0) does not expose sk_r(1).
    const k0 = Buffer.from(
      recoveryAccount.deriveChild(0).deriveChild(0).privateKey!,
    );
    const k7 = Buffer.from(
      recoveryAccount.deriveChild(0).deriveChild(7).privateKey!,
    );
    expect(k0.equals(k7)).toBe(false);
  });

  test('response is marked version 2', () => {
    expect(
      buildRecoveryResponse({
        xprivRecovery: getRecoveryXpriv(),
        xprivKeyIdentity: getBtcIdentityXpriv(),
        request: {
          pkEph: genEphemeralKeypair().pub.toString('hex'),
          nonce: freshNonce(),
          timestamp: Date.now(),
          recoveryIndex: 0,
        },
        identityChain: 'btc' as const,
      }).version,
    ).toBe(2);
  });
});
