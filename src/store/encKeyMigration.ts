/**
 * KEY-3 — rotate the legacy device-UID encryption key.
 *
 * Installs created before Feb 2025 were migrated from EncryptedStorage with
 * `enc_key = getUniqueId()` (Startup). Every ciphertext the app keeps is
 * AES(plaintext, enc_key + app password), and on iOS both the redux-persist
 * blobs (Documents/mmkv) and the device UID (NSUserDefaults) are in iCloud /
 * Finder backups — leaving only the app password between a backup and the
 * seed. New installs use 64 random bytes held only in the keychain
 * (WHEN_UNLOCKED_THIS_DEVICE_ONLY, never backed up).
 *
 * This module gives legacy installs the same: a fresh random enc_key, with
 * every blob re-encrypted under it. It is crash-safe and idempotent:
 *
 *   1. verify everything decrypts with the old key (abort otherwise, no change)
 *   2. stage {old, new} in a keychain item BEFORE anything changes
 *   3. re-encrypt all redux blobs in ONE state transition, flush to MMKV and
 *      verify the persisted copy
 *   4. rewrite sspkey_pw under the new key, then enc_key, verifying each
 *   5. re-encrypt the sign history, then delete the staging item
 *
 * If the app dies anywhere in between, the next start finds the staging item
 * and always finishes FORWARD: it decrypts every blob on its own (new key
 * first, then the old one — a blob written under either key is recovered),
 * re-encrypts all of them under the new key, makes that durable and verifies
 * it, and only then swaps the keychain items and drops the staging item. The
 * old key is never discarded before every blob verified under the new one.
 *
 * Startup must not mount Main while a staging item exists (see
 * `runEncKeyRotationGate`): Main would decrypt with whatever enc_key the
 * keychain holds and write new blobs under it. The rotation only runs while
 * the app is in the foreground (keychain items are WHEN_UNLOCKED_*).
 *
 * After the rotation verifies, the MMKV file is compacted so the old-key
 * `persist:root` copy does not linger until MMKV's own compaction.
 *
 * `sspkey_pw_bio` (the biometric gate item) still holds AES(password, old
 * key). It is never decrypted — biometric unlock only checks that the item is
 * readable — and it is keychain-only (THIS_DEVICE_ONLY, not in backups), so it
 * is not rewritten here: writing it prompts for biometrics on Android.
 *
 * Not covered here (needs native code): excluding Documents/mmkv from backups
 * and deleting react-native-device-info's NSUserDefaults copy of the UID.
 * After rotation neither holds anything that decrypts the seed.
 */
import { AppState } from 'react-native';
import * as Keychain from 'react-native-keychain';
import * as CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';
import { getUniqueId } from 'react-native-device-info';
import { isDerivableSeedPhrase } from '../lib/seedPhrase';
import {
  store,
  flushPersistedState,
  readPersistedSlice,
  registeredChainKeys,
  replaceEncryptedBlobs,
  compactPersistedStorage,
  type EncryptedStateBlobs,
} from './index';
import { SIGN_HISTORY_SERVICE } from '../lib/signHistory';
import type { chainStateKey, cryptos } from '../types';

export const ENC_KEY_SERVICE = 'enc_key';
export const PASSWORD_SERVICE = 'sspkey_pw';
export const ENC_KEY_MIGRATION_SERVICE = 'enc_key_migration';

export type EncKeyMigrationResult =
  | 'not_legacy'
  | 'skipped'
  | 'migrated'
  | 'resumed_forward'
  /** The app is not in the foreground; nothing was read or changed. */
  | 'deferred'
  | 'failed';

/** What Startup may do after the rotation step. */
export type EncKeyRotationGate =
  /** Nothing pending: mount Main. */
  | 'proceed'
  /** Not in the foreground: run again when the app becomes active. */
  | 'wait'
  /**
   * A rotation is still staged (interrupted and not finishable right now).
   * Main must NOT mount; show "finishing security upgrade" and retry.
   */
  | 'blocked';

const PASSWORD_HASH_SERVICE = 'sspkey_pw_hash';
const SALT_SERVICE = 'salt';

function isAppActive(): boolean {
  return AppState.currentState === 'active';
}

const KEYCHAIN_OPTIONS = {
  storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
  accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface StagedRotation {
  v: 1;
  old: string;
  new: string;
}

const SSP_BLOB_FIELDS = [
  'seedPhrase',
  'publicNonces',
  'enterprisePublicNonces',
  'xprivRecovery',
  'xpubRecovery',
] as const;
const CHAIN_BLOB_FIELDS = ['xpubWallet', 'xpubKey', 'xprivKey'] as const;
type BlobField =
  | (typeof SSP_BLOB_FIELDS)[number]
  | (typeof CHAIN_BLOB_FIELDS)[number];

/** AES-decrypt; '' when the key is wrong or the blob is corrupt. */
function decrypt(blob: string, passphrase: string): string {
  try {
    return CryptoJS.AES.decrypt(blob, passphrase).toString(CryptoJS.enc.Utf8);
  } catch {
    return '';
  }
}

function encrypt(plaintext: string, passphrase: string): string {
  return CryptoJS.AES.encrypt(plaintext, passphrase).toString();
}

/** A fresh enc_key exactly as new installs create it (Create/Restore). */
function newEncKey(): string {
  const bytes = new Uint8Array(64);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}

async function readItem(service: string): Promise<string | null> {
  const item = await Keychain.getGenericPassword({ service });
  return item && typeof item.password === 'string' ? item.password : null;
}

async function writeItem(service: string, value: string): Promise<void> {
  await Keychain.setGenericPassword(service, value, {
    service,
    ...KEYCHAIN_OPTIONS,
  });
  if ((await readItem(service)) !== value) {
    throw new Error(`keychain write did not verify (${service})`);
  }
}

interface PlainState {
  ssp: Record<(typeof SSP_BLOB_FIELDS)[number], string>;
  chains: Partial<Record<keyof cryptos, chainStateKey>>;
}

/**
 * Decrypt every redux blob with `passphrase`. Null when any non-empty blob
 * does not decrypt to a plausible value for its field — the data is then NOT
 * (entirely) under this key. (CryptoJS does not authenticate: a wrong key
 * usually fails the UTF-8 decoding but now and then yields a few bytes of
 * garbage, which `plausible` rejects.)
 */
function decryptState(passphrase: string): PlainState | null {
  const state = store.getState();
  const ssp = {} as PlainState['ssp'];
  for (const field of SSP_BLOB_FIELDS) {
    const blob = state.ssp[field];
    if (!blob) {
      ssp[field] = '';
      continue;
    }
    const plain = decrypt(blob, passphrase);
    if (!plain || !plausible(field, plain)) return null;
    ssp[field] = plain;
  }
  const chains: PlainState['chains'] = {};
  for (const chain of registeredChainKeys) {
    const slice = state[chain];
    if (!slice) continue;
    const plain = {} as chainStateKey;
    for (const field of CHAIN_BLOB_FIELDS) {
      const blob = slice[field];
      if (!blob) {
        plain[field] = '';
        continue;
      }
      const value = decrypt(blob, passphrase);
      if (!value || !plausible(field, value)) return null;
      plain[field] = value;
    }
    chains[chain] = plain;
  }
  return { ssp, chains };
}

/**
 * Whether `value` looks like what `field` holds. CryptoJS does not
 * authenticate: a wrong key yields '' or, now and then, a short string of
 * valid UTF-8 garbage. The checks are sized so garbage practically never
 * passes: the seed must be a derivable phrase, the nonce lists JSON, the
 * extended keys (base58, or JSON for Solana) printable ASCII of 8+ chars.
 */
function plausible(field: BlobField, value: string): boolean {
  if (field === 'seedPhrase') {
    // Not a BIP-39 check: a restored non-standard phrase must migrate too.
    return isDerivableSeedPhrase(value);
  }
  if (field === 'publicNonces' || field === 'enterprisePublicNonces') {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null;
    } catch {
      return false;
    }
  }
  return value.length >= 8 && /^[\x20-\x7e]+$/.test(value);
}

/**
 * Decrypt one blob that may be under either key: the new key first, then the
 * old one. A key only counts when its plaintext is plausible for the field;
 * if both are (vanishingly rare), the new key wins. Null when neither.
 */
function decryptEither(
  field: BlobField,
  blob: string,
  newPassphrase: string,
  oldPassphrase: string,
): { plain: string; underOld: boolean } | null {
  const underNew = decrypt(blob, newPassphrase);
  if (underNew && plausible(field, underNew)) {
    return { plain: underNew, underOld: false };
  }
  const underOld = decrypt(blob, oldPassphrase);
  if (underOld && plausible(field, underOld)) {
    return { plain: underOld, underOld: true };
  }
  return null;
}

/**
 * Per-blob decrypt of the whole state where each blob may be under the new or
 * the old key (an interrupted rotation, possibly followed by writes under the
 * old key). Null when any non-empty blob decrypts under neither.
 */
function decryptStateMixed(
  newPassphrase: string,
  oldPassphrase: string,
): { plain: PlainState; anyOld: boolean } | null {
  const state = store.getState();
  let anyOld = false;
  const ssp = {} as PlainState['ssp'];
  for (const field of SSP_BLOB_FIELDS) {
    const blob = state.ssp[field];
    if (!blob) {
      ssp[field] = '';
      continue;
    }
    const result = decryptEither(field, blob, newPassphrase, oldPassphrase);
    if (!result) return null;
    anyOld = anyOld || result.underOld;
    ssp[field] = result.plain;
  }
  const chains: PlainState['chains'] = {};
  for (const chain of registeredChainKeys) {
    const slice = state[chain];
    if (!slice) continue;
    const plain = {} as chainStateKey;
    for (const field of CHAIN_BLOB_FIELDS) {
      const blob = slice[field];
      if (!blob) {
        plain[field] = '';
        continue;
      }
      const result = decryptEither(field, blob, newPassphrase, oldPassphrase);
      if (!result) return null;
      anyOld = anyOld || result.underOld;
      plain[field] = result.plain;
    }
    chains[chain] = plain;
  }
  return { plain: { ssp, chains }, anyOld };
}

/**
 * Whether the persisted (MMKV) copy holds exactly `blobs` — every ciphertext
 * field of ssp and of every chain, not just the seed.
 */
function persistedMatches(blobs: EncryptedStateBlobs): boolean {
  const persistedSsp =
    readPersistedSlice<Partial<Record<string, string>>>('ssp');
  for (const field of SSP_BLOB_FIELDS) {
    if ((persistedSsp?.[field] ?? '') !== (blobs.ssp[field] ?? '')) {
      return false;
    }
  }
  for (const chain of registeredChainKeys) {
    const expected = blobs.chains[chain];
    if (!expected) continue;
    const persisted =
      readPersistedSlice<Partial<Record<string, string>>>(chain);
    for (const field of CHAIN_BLOB_FIELDS) {
      if ((persisted?.[field] ?? '') !== (expected[field] ?? '')) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Whether `password` is the app password, checked against the stored PBKDF2
 * hash (as Authentication does). True when no hash is stored to check against.
 */
async function passwordMatchesHash(password: string): Promise<boolean> {
  const [hash, salt] = await Promise.all([
    readItem(PASSWORD_HASH_SERVICE),
    readItem(SALT_SERVICE),
  ]);
  if (!hash || !salt) return true;
  const derived = CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: 1000,
  }).toString();
  return derived === hash;
}

/** The redux ciphertexts exactly as they are now. */
function currentBlobs(): EncryptedStateBlobs {
  const state = store.getState();
  const ssp = {} as EncryptedStateBlobs['ssp'];
  for (const field of SSP_BLOB_FIELDS) {
    ssp[field] = state.ssp[field];
  }
  const chains: EncryptedStateBlobs['chains'] = {};
  for (const chain of registeredChainKeys) {
    const slice = state[chain];
    if (slice) {
      chains[chain] = {
        xpubWallet: slice.xpubWallet,
        xpubKey: slice.xpubKey,
        xprivKey: slice.xprivKey,
      };
    }
  }
  return { ssp, chains };
}

function encryptState(
  plain: PlainState,
  passphrase: string,
): EncryptedStateBlobs {
  const ssp = {} as EncryptedStateBlobs['ssp'];
  for (const field of SSP_BLOB_FIELDS) {
    const value = plain.ssp[field];
    ssp[field] = value ? encrypt(value, passphrase) : '';
  }
  const chains: EncryptedStateBlobs['chains'] = {};
  for (const [chain, fields] of Object.entries(plain.chains) as [
    keyof cryptos,
    chainStateKey,
  ][]) {
    chains[chain] = {
      xpubWallet: fields.xpubWallet
        ? encrypt(fields.xpubWallet, passphrase)
        : '',
      xpubKey: fields.xpubKey ? encrypt(fields.xpubKey, passphrase) : '',
      xprivKey: fields.xprivKey ? encrypt(fields.xprivKey, passphrase) : '',
    };
  }
  return { ssp, chains };
}

function samePlainState(a: PlainState | null, b: PlainState): boolean {
  return Boolean(a) && JSON.stringify(a) === JSON.stringify(b);
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** Re-encrypt the keychain-held sign history (fail-soft: history only). */
async function rotateSignHistory(
  oldPassphrase: string,
  newPassphrase: string,
): Promise<void> {
  try {
    const blob = await readItem(SIGN_HISTORY_SERVICE);
    if (!blob) return;
    const underNew = decrypt(blob, newPassphrase);
    if (underNew && isJson(underNew)) return; // already under the new key
    const plain = decrypt(blob, oldPassphrase);
    if (!plain || !isJson(plain)) return; // unreadable either way
    await writeItem(SIGN_HISTORY_SERVICE, encrypt(plain, newPassphrase));
  } catch (error) {
    console.log('[enc_key rotation] sign history not rotated', error);
  }
}

function parseStaged(raw: string | null): StagedRotation | null {
  if (!raw) return null;
  try {
    const staged = JSON.parse(raw) as Partial<StagedRotation>;
    if (
      staged.v === 1 &&
      typeof staged.old === 'string' &&
      typeof staged.new === 'string' &&
      staged.old &&
      staged.new
    ) {
      return staged as StagedRotation;
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Finish a rotation that was interrupted — always forward, per blob:
 *   1. find the app password (the password item may be under either key);
 *   2. decrypt every blob under the new key, else the old one;
 *   3. re-encrypt all of them under the new key, flush, and verify both the
 *      in-memory state and the persisted copy;
 *   4. only then rewrite sspkey_pw and enc_key, re-encrypt the sign history,
 *      compact MMKV and drop the staging item (and with it the old key).
 * Throws or returns 'failed' with the staging item left in place whenever
 * any step does not verify.
 */
async function resumeRotation(
  staged: StagedRotation,
): Promise<'forward' | 'failed'> {
  const pwItem = await readItem(PASSWORD_SERVICE);
  if (!pwItem) return 'failed';
  const candidates = [
    ...new Set(
      [decrypt(pwItem, staged.new), decrypt(pwItem, staged.old)].filter(
        Boolean,
      ),
    ),
  ];
  for (const password of candidates) {
    if (!(await passwordMatchesHash(password))) continue;
    const newPassphrase = staged.new + password;
    const mixed = decryptStateMixed(newPassphrase, staged.old + password);
    if (!mixed) continue;

    // every blob under the new key, durable and verified
    if (mixed.anyOld) {
      store.dispatch(
        replaceEncryptedBlobs(encryptState(mixed.plain, newPassphrase)),
      );
    }
    await flushPersistedState();
    if (
      !samePlainState(decryptState(newPassphrase), mixed.plain) ||
      !persistedMatches(currentBlobs())
    ) {
      throw new Error('resumed state did not verify');
    }

    // keychain: password under the new key first, then the key itself
    if (decrypt(pwItem, staged.new) !== password) {
      await writeItem(PASSWORD_SERVICE, encrypt(password, staged.new));
    }
    await writeItem(ENC_KEY_SERVICE, staged.new);
    await rotateSignHistory(staged.old + password, newPassphrase);
    compactPersistedStorage();
    await Keychain.resetGenericPassword({
      service: ENC_KEY_MIGRATION_SERVICE,
    });
    return 'forward';
  }
  return 'failed';
}

/** The rotation proper, for an install whose enc_key is still the UID. */
async function rotate(
  oldKey: string,
): Promise<'migrated' | 'skipped' | 'deferred' | 'failed'> {
  const pwItem = await readItem(PASSWORD_SERVICE);
  if (!pwItem) return 'skipped'; // nothing is encrypted without a password
  const password = decrypt(pwItem, oldKey);
  if (!password) return 'failed';

  // 1. everything must decrypt with the old key — otherwise change nothing
  const plain = decryptState(oldKey + password);
  if (!plain) return 'failed';

  // Never start a rotation in the background (locked keychain, OS kill).
  if (!isAppActive()) return 'deferred';

  // 2. stage both keys before anything changes
  const nextKey = newEncKey();
  const staged: StagedRotation = { v: 1, old: oldKey, new: nextKey };
  await writeItem(ENC_KEY_MIGRATION_SERVICE, JSON.stringify(staged));

  // The ciphertexts as they are now, to restore if step 3 fails.
  const original = currentBlobs();
  let stateVerified = false;
  try {
    // 3. one atomic state transition, made durable and verified
    const reEncrypted = encryptState(plain, nextKey + password);
    store.dispatch(replaceEncryptedBlobs(reEncrypted));
    await flushPersistedState();
    if (
      !samePlainState(decryptState(nextKey + password), plain) ||
      !persistedMatches(reEncrypted)
    ) {
      throw new Error('re-encrypted state did not verify');
    }
    stateVerified = true;

    // 4. keychain: password under the new key first, then the key itself
    await writeItem(PASSWORD_SERVICE, encrypt(password, nextKey));
    await writeItem(ENC_KEY_SERVICE, nextKey);

    // 5. history, compaction, then drop the staging item (and the old key)
    await rotateSignHistory(oldKey + password, nextKey + password);
    compactPersistedStorage();
    await Keychain.resetGenericPassword({ service: ENC_KEY_MIGRATION_SERVICE });
    return 'migrated';
  } catch (error) {
    console.log('[enc_key rotation] interrupted, reconciling', error);
    try {
      if (stateVerified) {
        // The new-key state is durable and verified: finish forward.
        await resumeRotation(staged);
      } else {
        // The keychain was not touched yet: put the old ciphertexts back.
        // Only when the persisted copy is provably old again is the staging
        // item dropped; otherwise the next start decides from what is on disk.
        store.dispatch(replaceEncryptedBlobs(original));
        await flushPersistedState();
        if (persistedMatches(original)) {
          await Keychain.resetGenericPassword({
            service: ENC_KEY_MIGRATION_SERVICE,
          });
        }
      }
    } catch (reconcileError) {
      console.log('[enc_key rotation] left for next start', reconcileError);
    }
    return 'failed';
  }
}

/**
 * An unreadable staging item is only safe to drop when it is provably orphaned:
 * the password item and EVERY blob decrypt under the keychain's current
 * enc_key, so nothing needs the key the staging item may have held.
 */
async function isStateConsistentWithKeychain(): Promise<boolean> {
  const encKey = await readItem(ENC_KEY_SERVICE);
  const pwItem = await readItem(PASSWORD_SERVICE);
  if (!encKey || !pwItem) return false;
  const password = decrypt(pwItem, encKey);
  if (!password || !(await passwordMatchesHash(password))) return false;
  return decryptState(encKey + password) !== null;
}

/**
 * Run at startup, after redux rehydrated and before any screen can decrypt or
 * write ciphertexts. Never throws; never discards the old key before the new
 * state verified. Does nothing while the app is not in the foreground.
 */
export async function migrateLegacyEncKey(): Promise<EncKeyMigrationResult> {
  try {
    if (!isAppActive()) return 'deferred';
    const stagedRaw = await readItem(ENC_KEY_MIGRATION_SERVICE);
    if (stagedRaw) {
      const staged = parseStaged(stagedRaw);
      if (staged) {
        const outcome = await resumeRotation(staged);
        return outcome === 'forward' ? 'resumed_forward' : 'failed';
      }
      if (!(await isStateConsistentWithKeychain())) {
        console.log('[enc_key rotation] unreadable staging item left in place');
        return 'failed';
      }
      console.log('[enc_key rotation] dropping an orphaned staging item');
      await Keychain.resetGenericPassword({
        service: ENC_KEY_MIGRATION_SERVICE,
      });
    }

    const encKey = await readItem(ENC_KEY_SERVICE);
    if (!encKey) return 'skipped';
    const uniqueId = await getUniqueId();
    if (!uniqueId || encKey !== uniqueId) return 'not_legacy';

    return await rotate(encKey);
  } catch (error) {
    // The staging item (if written) stays; the next start resumes from it.
    console.log('[enc_key rotation] failed', error);
    return 'failed';
  }
}

/** Whether a rotation is staged (fail closed: an unreadable keychain = yes). */
export async function isEncKeyRotationPending(): Promise<boolean> {
  try {
    return (await readItem(ENC_KEY_MIGRATION_SERVICE)) !== null;
  } catch {
    return true;
  }
}

/**
 * Startup's decision. Main may only mount on 'proceed': while a rotation is
 * staged, the persisted blobs and the keychain enc_key may disagree, and Main
 * would decrypt with (and write new blobs under) the wrong key.
 */
export async function runEncKeyRotationGate(): Promise<EncKeyRotationGate> {
  if (!isAppActive()) return 'wait';
  const result = await migrateLegacyEncKey();
  if (result !== 'not_legacy' && result !== 'skipped') {
    console.log('[enc_key rotation]', result);
  }
  if (result === 'deferred') {
    return (await isEncKeyRotationPending()) ? 'blocked' : 'wait';
  }
  if (await isEncKeyRotationPending()) return 'blocked';
  return 'proceed';
}
