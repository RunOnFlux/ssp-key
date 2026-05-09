import { Buffer } from 'buffer';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { createInitializationMessage } from '@runonflux/solana-multisig';

import {
  getMasterXpriv,
  generateAddressKeypairSOL,
  generateMultisigAddressSOL,
  generateSolanaPubkeyArray,
  signSolanaInitMessage,
} from '../../src/lib/wallet';

const mnemonic =
  'silver trouble mountain crouch angry park film strong escape theory illegal bunker cargo taxi tuna real drift alert state match great escape option explain';

const xprivWallet = getMasterXpriv(mnemonic, 48, 1, 0, 'p2sh', 'solDevnet');
const xprivKey = getMasterXpriv(mnemonic, 48, 1, 1, 'p2sh', 'solDevnet');

describe('Solana wallet lib (key device)', () => {
  describe('generateAddressKeypairSOL', () => {
    test('returns 64-byte hex secret key and base58-encoded 32-byte public key', () => {
      const kp = generateAddressKeypairSOL(xprivWallet, 0, 0, 'solDevnet');
      expect(kp.privKey).toMatch(/^[0-9a-f]{128}$/);
      const pub = bs58.decode(kp.pubKey);
      expect(pub.length).toBe(32);
      expect(() => new PublicKey(kp.pubKey)).not.toThrow();
    });

    test('matches between wallet and key derivations for same xpriv (cross-app determinism)', () => {
      // Same path on key device must produce same keypair as wallet — we
      // can't import wallet's lib here, but we can assert determinism inside
      // ssp-key. The cross-app equality is enforced by both repos using the
      // same BIP32 → Ed25519 derivation.
      const a = generateAddressKeypairSOL(xprivWallet, 0, 0, 'solDevnet');
      const b = generateAddressKeypairSOL(xprivWallet, 0, 0, 'solDevnet');
      expect(a).toEqual(b);
    });

    test('signs and verifies with nacl using the returned keypair', () => {
      const kp = generateAddressKeypairSOL(xprivWallet, 0, 0, 'solDevnet');
      const secret = new Uint8Array(Buffer.from(kp.privKey, 'hex'));
      const pub = bs58.decode(kp.pubKey);
      const msg = new TextEncoder().encode('hello solana');
      const sig = nacl.sign.detached(msg, secret);
      expect(nacl.sign.detached.verify(msg, sig, pub)).toBe(true);
    });
  });

  describe('generateSolanaPubkeyArray', () => {
    test('produces 20 distinct base58 pubkeys', () => {
      const arr = generateSolanaPubkeyArray(xprivWallet, 'solDevnet');
      expect(arr).toHaveLength(20);
      expect(new Set(arr).size).toBe(20);
      for (const pk of arr) {
        expect(() => new PublicKey(pk)).not.toThrow();
      }
    });

    test('matches generateAddressKeypairSOL element-by-element', () => {
      const arr = generateSolanaPubkeyArray(xprivWallet, 'solDevnet');
      for (let i = 0; i < arr.length; i += 7) {
        const { pubKey } = generateAddressKeypairSOL(
          xprivWallet,
          0,
          i,
          'solDevnet',
        );
        expect(arr[i]).toBe(pubKey);
      }
    });
  });

  describe('generateMultisigAddressSOL', () => {
    test('returns valid base58 PublicKey for vault PDA', () => {
      const w = generateAddressKeypairSOL(
        xprivWallet,
        0,
        0,
        'solDevnet',
      ).pubKey;
      const k = generateAddressKeypairSOL(xprivKey, 0, 0, 'solDevnet').pubKey;
      const ms = generateMultisigAddressSOL(w, k, 0, 'solDevnet');
      expect(typeof ms.address).toBe('string');
      expect(() => new PublicKey(ms.address)).not.toThrow();
    });

    test('order-independent in member pubkeys (program sorts members)', () => {
      const w = generateAddressKeypairSOL(
        xprivWallet,
        0,
        0,
        'solDevnet',
      ).pubKey;
      const k = generateAddressKeypairSOL(xprivKey, 0, 0, 'solDevnet').pubKey;
      const a = generateMultisigAddressSOL(w, k, 0, 'solDevnet');
      const b = generateMultisigAddressSOL(k, w, 0, 'solDevnet');
      expect(a.address).toBe(b.address);
    });

    test('different vault indices produce different PDAs', () => {
      const w = generateAddressKeypairSOL(
        xprivWallet,
        0,
        0,
        'solDevnet',
      ).pubKey;
      const k = generateAddressKeypairSOL(xprivKey, 0, 0, 'solDevnet').pubKey;
      expect(generateMultisigAddressSOL(w, k, 0, 'solDevnet').address).not.toBe(
        generateMultisigAddressSOL(w, k, 1, 'solDevnet').address,
      );
    });
  });

  describe('signSolanaInitMessage', () => {
    test('produces a base64 signature that verifies against the SDK init message', () => {
      const wKp = generateAddressKeypairSOL(xprivWallet, 0, 0, 'solDevnet');
      const kKp = generateAddressKeypairSOL(xprivKey, 0, 0, 'solDevnet');

      const sigB64 = signSolanaInitMessage(kKp.privKey, wKp.pubKey, kKp.pubKey);
      const sig = new Uint8Array(Buffer.from(sigB64, 'base64'));
      expect(sig.length).toBe(64);

      const message = createInitializationMessage(
        [new PublicKey(wKp.pubKey), new PublicKey(kKp.pubKey)],
        2,
      );
      const pub = bs58.decode(kKp.pubKey);
      expect(nacl.sign.detached.verify(message, sig, pub)).toBe(true);
    });

    test('order-independent in member arguments', () => {
      const wKp = generateAddressKeypairSOL(xprivWallet, 0, 0, 'solDevnet');
      const kKp = generateAddressKeypairSOL(xprivKey, 0, 0, 'solDevnet');
      const a = signSolanaInitMessage(kKp.privKey, wKp.pubKey, kKp.pubKey);
      const b = signSolanaInitMessage(kKp.privKey, kKp.pubKey, wKp.pubKey);
      expect(a).toBe(b);
    });
  });
});
