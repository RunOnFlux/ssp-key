/**
 * Periodic backup-checkup cycle logic (pure — no storage, no React, no native).
 *
 * Ported from ssp-wallet's lib/backupCheckup. The Home "Backup checkup" card
 * shows when the Key has no recorded verification at all (upgraded installs and
 * installs that never verified show it immediately) or when a full cycle
 * (30 days) has elapsed since the last successful one. Keys freshly created in
 * v2 record the create-flow word challenge as their first verification, and
 * restore records typing the seed, so brand-new users are not asked again right
 * away. Passing the verify modal resets the cycle; a dismiss ("Later") snoozes
 * it for one full cycle.
 *
 * Invariants (SSP_DESIGN_OVERHAUL_PLAN.md Part 1):
 *  - Zero crypto/signing/derivation changes — this is scheduling only.
 *  - The state it drives lives in a NEW, dedicated MMKV key (append-only);
 *    a missing/corrupt value falls back to a safe default (checkup simply
 *    treated as due, never a crash).
 */

/** NEW MMKV key for the persisted backup-checkup cycle state. Append-only. */
export const BACKUP_CHECKUP_STORAGE_KEY = 'backupCheckup';

export const BACKUP_CHECKUP_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface BackupCheckupState {
  /** Epoch ms of the last successful backup verification. */
  lastVerifyAt?: number;
  /** Epoch ms until which the checkup card is snoozed ("Later"). */
  snoozedUntil?: number;
}

const isValidTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Parse an unknown stored value into a safe state (corrupt fields dropped). */
export function sanitizeBackupCheckupState(input: unknown): BackupCheckupState {
  const out: BackupCheckupState = {};
  if (!input || typeof input !== 'object') return out;
  const v = input as Record<string, unknown>;
  if (isValidTimestamp(v.lastVerifyAt)) out.lastVerifyAt = v.lastVerifyAt;
  if (isValidTimestamp(v.snoozedUntil)) out.snoozedUntil = v.snoozedUntil;
  return out;
}

/**
 * Is the checkup due? An active snooze always suppresses it. With no recorded
 * verification (missing/corrupt value) it is due immediately; with one, it is
 * due once a full cycle has elapsed. A future lastVerifyAt (clock skew) counts
 * as fresh — never nag off a broken clock.
 */
export function isBackupCheckupDue(
  state: BackupCheckupState,
  now: number,
): boolean {
  if (isValidTimestamp(state.snoozedUntil) && state.snoozedUntil > now) {
    return false;
  }
  if (!isValidTimestamp(state.lastVerifyAt)) return true;
  if (state.lastVerifyAt > now) return false;
  return now - state.lastVerifyAt >= BACKUP_CHECKUP_INTERVAL_MS;
}
