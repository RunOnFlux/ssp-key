/**
 * The Key's enterprise Schnorr nonce pool (encrypted, in redux-persist).
 *
 * Two writers touch the pool: vault signing burns one nonce, replenish adds
 * new ones after a network round-trip. Both used to build their write from a
 * snapshot taken earlier (the render-time Redux value), so a replenish that
 * started before a signature wrote the burned nonce back (K2), and nothing
 * forced the burn to disk before the partial signature left the device (K4).
 *
 * Every write here therefore:
 * - runs under one in-process lock, so pool read-modify-writes never
 *   interleave;
 * - re-reads the CURRENT pool from the store inside the lock (never a
 *   caller's snapshot);
 * - filters against the persistent used-nonce ledger, so a used nonce can
 *   never come back;
 * - ends with `persistor.flush()`, so the new pool is on disk before the
 *   caller continues.
 */
import * as CryptoJS from 'crypto-js';
import { store, persistor } from '../store';
import { setSspKeyEnterprisePublicNonces } from '../store/ssp';
import type { publicPrivateNonce } from '../types';
import {
  isNonceTombstoned,
  recordUsedNonce,
  withoutTombstoned,
} from './enterpriseNonceLedger';

export interface PublicNonceRef {
  kPublic: string;
  kTwoPublic: string;
}

export class EnterpriseNonceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'pool_unreadable'
      | 'not_found'
      | 'already_used'
      | 'persist_failed',
  ) {
    super(message);
    this.name = 'EnterpriseNonceError';
  }
}

let lockTail: Promise<unknown> = Promise.resolve();

/** Runs `fn` exclusively with respect to every other pool read-modify-write. */
export function withEnterpriseNonceLock<T>(
  fn: () => Promise<T> | T,
): Promise<T> {
  const run = lockTail.then(() => fn());
  lockTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Decrypts a pool ciphertext. Empty → []. Undecryptable → throws. */
export function decryptNoncePool(
  cipher: string,
  password: string,
): publicPrivateNonce[] {
  if (!cipher) {
    return [];
  }
  const parsed = JSON.parse(
    CryptoJS.AES.decrypt(cipher, password).toString(CryptoJS.enc.Utf8),
  ) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Enterprise nonce pool is not a list');
  }
  return parsed as publicPrivateNonce[];
}

export function encryptNoncePool(
  nonces: publicPrivateNonce[],
  password: string,
): string {
  return CryptoJS.AES.encrypt(JSON.stringify(nonces), password).toString();
}

const currentCipher = (): string =>
  store.getState().ssp.enterprisePublicNonces || '';

/**
 * The pool as it is in the store right now, without used nonces. Throws
 * EnterpriseNonceError('pool_unreadable') when it cannot be decrypted.
 */
export function readEnterpriseNonces(password: string): publicPrivateNonce[] {
  let pool: publicPrivateNonce[];
  try {
    pool = decryptNoncePool(currentCipher(), password);
  } catch {
    throw new EnterpriseNonceError(
      'Failed to decrypt enterprise nonces',
      'pool_unreadable',
    );
  }
  return withoutTombstoned(pool);
}

const sameNonce = (n: PublicNonceRef, ref: PublicNonceRef) =>
  n.kPublic === ref.kPublic && n.kTwoPublic === ref.kTwoPublic;

/** Read-only lookup of a reserved nonce in the current pool. */
export function findEnterpriseNonce(
  ref: PublicNonceRef,
  password: string,
): publicPrivateNonce | undefined {
  return readEnterpriseNonces(password).find((n) => sameNonce(n, ref));
}

async function writePool(
  nonces: publicPrivateNonce[],
  password: string,
): Promise<void> {
  store.dispatch(
    setSspKeyEnterprisePublicNonces(encryptNoncePool(nonces, password)),
  );
  try {
    await persistor.flush();
  } catch {
    throw new EnterpriseNonceError(
      'Failed to persist the enterprise nonce pool',
      'persist_failed',
    );
  }
}

/**
 * Removes a reserved nonce from the pool for good and returns it, so the
 * caller can sign with it exactly once. Order matters: the used-nonce ledger
 * is written (synchronously, verified) and the shrunken pool is flushed to
 * disk BEFORE this resolves — a caller that signs only after it resolves can
 * never have a partial signature out for a nonce that is still on disk as
 * unused. Throws (and the caller must not sign) on any failure.
 */
export function burnEnterpriseNonce(
  ref: PublicNonceRef,
  password: string,
): Promise<publicPrivateNonce> {
  return withEnterpriseNonceLock(async () => {
    if (isNonceTombstoned(ref.kPublic)) {
      throw new EnterpriseNonceError(
        'This nonce was already used by this device',
        'already_used',
      );
    }
    let pool: publicPrivateNonce[];
    try {
      pool = decryptNoncePool(currentCipher(), password);
    } catch {
      throw new EnterpriseNonceError(
        'Failed to decrypt enterprise nonces',
        'pool_unreadable',
      );
    }
    const index = pool.findIndex((n) => sameNonce(n, ref));
    if (index === -1) {
      throw new EnterpriseNonceError(
        'Reserved nonce not found locally',
        'not_found',
      );
    }
    const nonce = pool[index];
    try {
      recordUsedNonce(nonce.kPublic);
    } catch {
      throw new EnterpriseNonceError(
        'Failed to record the used enterprise nonce',
        'persist_failed',
      );
    }
    const remaining = withoutTombstoned(pool.filter((_n, i) => i !== index));
    await writePool(remaining, password);
    return nonce;
  });
}

/**
 * Appends freshly generated nonces to the pool. Re-reads the pool inside the
 * lock (a signature may have burned a nonce while the caller was on the
 * network), drops used and duplicate nonces, and flushes. Returns the number
 * of nonces in the pool afterwards.
 */
export function addEnterpriseNonces(
  newNonces: publicPrivateNonce[],
  password: string,
): Promise<number> {
  return withEnterpriseNonceLock(async () => {
    let current: publicPrivateNonce[];
    try {
      current = decryptNoncePool(currentCipher(), password);
    } catch {
      // Same recovery as before this lock existed: an unreadable pool cannot
      // be signed with anyway, so it is replaced by the fresh nonces.
      current = [];
    }
    const seen = new Set<string>();
    const merged = withoutTombstoned([...current, ...newNonces]).filter((n) => {
      if (seen.has(n.kPublic)) {
        return false;
      }
      seen.add(n.kPublic);
      return true;
    });
    await writePool(merged, password);
    return merged.length;
  });
}
