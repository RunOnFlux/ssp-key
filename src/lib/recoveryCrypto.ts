/**
 * Recovery Envelope Cryptography (ssp-key side).
 *
 * Mirror of ssp-wallet's `recoveryCrypto.ts` — same wire format, same
 * primitives. Uses `react-native-quick-crypto` (which implements Node's
 * `crypto` API) for ECDH + AES-GCM + SHA-256 + randomBytes.
 *
 * Wire format (both formats defined here for cross-repo reference —
 * this file only needs to produce the transit wrap, but reviewers
 * should see the full picture without switching to the wallet repo):
 *
 *   ECIES envelope blob (wallet localStorage, produced by wallet):
 *     [1 byte version=0x01]
 *     [33 bytes pk_eph (compressed secp256k1 pubkey)]
 *     [12 bytes iv]
 *     [N bytes AES-256-GCM ciphertext]
 *     [16 bytes AES-256-GCM tag]
 *
 *   Transit-wrapped sk_r (ssp-key → wallet — this file produces this):
 *     [1 byte version=0x01]
 *     [12 bytes iv]
 *     [32 bytes AES-256-GCM ciphertext of sk_r]
 *     [16 bytes AES-256-GCM tag]
 *
 * NOTE ON UPGRADES: the version bytes exist so future hardening
 * (HKDF-SHA256 instead of the current sha256(label || shared), or
 * AES-GCM AAD binding the request context on transit) can ship with
 * a clean on-the-wire bump. Neither upgrade closes an exploitable
 * gap under today's threat model; both are "formal-audit polish"
 * that can be deferred.
 */

import QuickCrypto from 'react-native-quick-crypto';
import { Buffer } from 'buffer';

export const TRANSIT_VERSION = 0x01;

const KDF_INFO_TRANSIT = 'SSP-RECOVERY-TRANSIT-v1';

const IV_LEN = 12;
const SK_LEN = 32;

function deriveSymmetricKey(sharedSecret: Buffer, info: string): Buffer {
  return Buffer.from(
    QuickCrypto.createHash('sha256')
      .update(Buffer.concat([Buffer.from(info, 'utf8'), sharedSecret]))
      .digest() as Buffer | Uint8Array,
  );
}

function ecdh(privKey: Buffer, otherPubKey: Buffer): Buffer {
  const dh = QuickCrypto.createECDH('secp256k1');
  // QuickCrypto's Buffer type is not structurally identical to the `buffer`
  // npm polyfill's Buffer — pass hex to sidestep the type mismatch.
  dh.setPrivateKey(privKey.toString('hex'), 'hex');
  const secret = dh.computeSecret(otherPubKey.toString('hex'), 'hex');
  return typeof secret === 'string'
    ? Buffer.from(secret, 'hex')
    : Buffer.from(secret as Uint8Array);
}

/**
 * Transit-wrap sk_r for delivery to the wallet.
 *
 * Uses the ssp-key identity privkey (at m/48'/.../10/0) plus the wallet's
 * ephemeral pubkey from the incoming request to derive a shared key, then
 * AES-GCM seals sk_r. Only the wallet session that issued the request
 * (holder of the matching ephemeral private key) can decrypt.
 */
export function wrapSkRForTransit(
  sspKeyIdentityPriv: Buffer,
  walletEphPub: Buffer,
  skR: Buffer,
): string {
  if (skR.length !== SK_LEN) {
    throw new Error(`sk_r must be ${SK_LEN} bytes, got ${skR.length}`);
  }
  const shared = ecdh(sspKeyIdentityPriv, walletEphPub);
  const aesKey = deriveSymmetricKey(shared, KDF_INFO_TRANSIT);
  const iv = Buffer.from(
    QuickCrypto.randomBytes(IV_LEN) as Buffer | Uint8Array,
  );

  const cipher = QuickCrypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([
    Buffer.from(cipher.update(skR) as Buffer | Uint8Array),
    Buffer.from(cipher.final() as Buffer | Uint8Array),
  ]);
  const tag = Buffer.from(cipher.getAuthTag() as Buffer | Uint8Array);

  shared.fill(0);
  aesKey.fill(0);

  return Buffer.concat([
    Buffer.from([TRANSIT_VERSION]),
    iv,
    ciphertext,
    tag,
  ]).toString('hex');
}
