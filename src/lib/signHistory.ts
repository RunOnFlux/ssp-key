// Local, encrypted, biometric-gated log of every action this SSP Key co-signed.
//
// Design invariants (SSP_DESIGN_OVERHAUL_PLAN.md Part 1):
//  - Invariant 4: local-only. This log is NEVER sent to the relay, never synced,
//    contains zero telemetry. It is encrypted at rest with the SAME mechanism the
//    app already uses for sensitive data (enc_key + sspkey_pw derived key via
//    CryptoJS.AES) and is gated behind biometrics/PIN before it can be viewed.
//  - Invariant 5: NEVER stores signatures, seeds, xprivs, or session tokens. Only
//    public metadata is persisted: what kind of action, on which chain, for which
//    WK identity, and when. For broadcast transactions the public txid is kept as
//    a reference; nothing sensitive is ever written.
//  - Invariant 6: storage is append-only and uses a NEW keychain service key
//    (`sspkey_sign_history`). It never reads, renames, re-encodes, or overwrites
//    any existing key (enc_key, sspkey_pw, seedPhrase, sspConfig, ...).
//
// This module does NOT change any signing/crypto/derivation logic. It is a purely
// additive record written after a co-sign action has already been posted.

import * as Keychain from 'react-native-keychain';
import * as CryptoJS from 'crypto-js';

/** NEW keychain service — must never collide with existing services. */
export const SIGN_HISTORY_SERVICE = 'sspkey_sign_history';

/** Cap retained entries so the encrypted blob stays small (newest kept). */
export const MAX_SIGN_HISTORY_ENTRIES = 500;

export type SignHistoryType =
  | 'transaction'
  | 'evm_message'
  | 'wk_message'
  | 'vault_transaction'
  | 'vault_xpub'
  | 'public_nonces'
  | 'recovery'
  | 'key_nonce_sync';

export interface SignHistoryEntry {
  /** Local-only identifier for list keys. Not derived from anything sensitive. */
  id: string;
  type: SignHistoryType;
  /** Blockchain symbol/key the action applied to (public metadata). */
  chain: string;
  /** WK identity (multisig address) the action was co-signed for — "which wallet". */
  wkIdentity: string;
  /** Epoch milliseconds when the entry was recorded. */
  timestamp: number;
  /** Optional PUBLIC reference — currently only a broadcast txid. Never a signature. */
  ref?: string;
}

// Maps the relay `action` strings posted by Home's postAction() to a history
// type. Only unambiguous *successful co-sign* actions are listed here — rejected
// actions and ambiguous ones (e.g. enterprisefluxnodestarted, which is also
// posted on error/reject) are intentionally excluded so failures are not logged
// as signatures.
const ACTION_TYPE_MAP: Record<string, SignHistoryType> = {
  txid: 'transaction',
  evmsigned: 'evm_message',
  wksigned: 'wk_message',
  enterprisevaultsigned: 'vault_transaction',
  enterprisevaultxpubsigned: 'vault_xpub',
  publicnonces: 'public_nonces',
  recoveryresponse: 'recovery',
  enterprisekeynoncesynced: 'key_nonce_sync',
};

/**
 * Derive the app's existing encryption key (enc_key + decrypted sspkey_pw).
 * Mirrors the derivation used throughout Home.tsx — no new crypto is introduced.
 * Returns null when the keychain material is unavailable (e.g. locked/no wallet).
 */
export async function deriveHistoryPassword(): Promise<string | null> {
  try {
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });
    if (!encryptionKey || !passwordData) {
      return null;
    }
    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    ).toString(CryptoJS.enc.Utf8);
    if (!passwordDecrypted) {
      return null;
    }
    return encryptionKey.password + passwordDecrypted;
  } catch {
    return null;
  }
}

function isValidEntry(value: unknown): value is SignHistoryEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.type === 'string' &&
    typeof e.chain === 'string' &&
    typeof e.wkIdentity === 'string' &&
    typeof e.timestamp === 'number'
  );
}

/**
 * Load and decrypt the sign history. Fail-soft: any decrypt/parse error returns
 * an empty list rather than throwing (a corrupt/missing blob must never break UI).
 */
export async function loadSignHistory(
  pwForEncryption: string,
): Promise<SignHistoryEntry[]> {
  try {
    const stored = await Keychain.getGenericPassword({
      service: SIGN_HISTORY_SERVICE,
    });
    if (!stored || !stored.password) {
      return [];
    }
    const decrypted = CryptoJS.AES.decrypt(
      stored.password,
      pwForEncryption,
    ).toString(CryptoJS.enc.Utf8);
    if (!decrypted) {
      return [];
    }
    const parsed: unknown = JSON.parse(decrypted);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

/** Encrypt and persist the entry list under the dedicated history service. */
async function saveSignHistory(
  entries: SignHistoryEntry[],
  pwForEncryption: string,
): Promise<void> {
  const encrypted = CryptoJS.AES.encrypt(
    JSON.stringify(entries),
    pwForEncryption,
  ).toString();
  await Keychain.setGenericPassword(SIGN_HISTORY_SERVICE, encrypted, {
    service: SIGN_HISTORY_SERVICE,
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/**
 * Append an entry (newest-first), capped at MAX_SIGN_HISTORY_ENTRIES.
 * Load → prepend → cap → save, serialized through a module-level queue so
 * concurrent appends (rapid sequential approvals) can't interleave their
 * load/save halves and drop an entry.
 */
let appendChain: Promise<void> = Promise.resolve();

export function appendSignHistory(
  entry: SignHistoryEntry,
  pwForEncryption: string,
): Promise<void> {
  const run = appendChain.then(async () => {
    const existing = await loadSignHistory(pwForEncryption);
    const next = [entry, ...existing].slice(0, MAX_SIGN_HISTORY_ENTRIES);
    await saveSignHistory(next, pwForEncryption);
  });
  // keep the chain alive even if this append fails
  appendChain = run.catch(() => {});
  return run;
}

/** Erase the local history entirely (used by the History screen's clear action). */
export async function clearSignHistory(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: SIGN_HISTORY_SERVICE });
  } catch {
    // best-effort; nothing else depends on this key
  }
}

function makeId(timestamp: number): string {
  return `${timestamp}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The single additive hook wired into Home.postAction(). Given a relay action
 * string it records a local history entry for the known *successful* co-sign
 * actions and silently ignores everything else. Never throws — a history write
 * must never affect a signing flow (Invariant 1).
 *
 * `ref` is an OPTIONAL public reference (only a txid is ever passed). Sensitive
 * payloads/signatures are never passed in and never stored.
 */
export async function recordSignAction(
  action: string,
  chain: string,
  wkIdentity: string,
  ref?: string,
): Promise<void> {
  try {
    const type = ACTION_TYPE_MAP[action];
    if (!type) {
      return;
    }
    const pw = await deriveHistoryPassword();
    if (!pw) {
      return;
    }
    const timestamp = Date.now();
    const entry: SignHistoryEntry = {
      id: makeId(timestamp),
      type,
      chain: chain || '',
      wkIdentity: wkIdentity || '',
      timestamp,
      ...(ref ? { ref } : {}),
    };
    await appendSignHistory(entry, pw);
  } catch {
    // swallow — never let history recording disturb the signing path
  }
}
