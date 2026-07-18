import { useEffect, useState, useSyncExternalStore } from 'react';
import { storage } from '../store'; // mmkv — same storage mechanism the app already uses for preferences (language, privacyMode)
import {
  BACKUP_CHECKUP_INTERVAL_MS,
  BACKUP_CHECKUP_STORAGE_KEY,
  isBackupCheckupDue,
  sanitizeBackupCheckupState,
} from '../lib/backupCheckup';
import type { BackupCheckupState } from '../lib/backupCheckup';

/**
 * Backup-checkup persistence — the periodic "confirm your seed backup" cycle.
 *
 * Built on the same storage pattern the Key uses for privacy mode
 * (lib/privacy.ts + contexts/PrivacyContext.tsx): its OWN new MMKV key, purely
 * presentational, never touching signing, crypto or any existing key. Where
 * privacy holds a single boolean, this holds two timestamps
 * ({ lastVerifyAt, snoozedUntil }); the cycle maths itself is pure
 * (lib/backupCheckup).
 *
 * The writers are plain module functions (not hook methods) so the onboarding
 * screens (Create / Restore) and the verify modal can stamp a verification
 * imperatively from an async callback, while the Home card subscribes reactively
 * via useSyncExternalStore. MMKV reads are synchronous, so the snapshot is a
 * cheap cached parse refreshed only on write.
 *
 * Invariants (SSP_DESIGN_OVERHAUL_PLAN.md Part 1):
 *  - Zero crypto/signing changes — scheduling metadata only.
 *  - Append-only storage: writes only the new `backupCheckup` key; never
 *    reads/renames/rewrites existing keys (language, sspConfig, privacyMode,
 *    backends, redux persist root). Losing it never affects funds, keys or
 *    pairing — the card simply treats the checkup as due.
 */

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());
const subscribe = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

function read(): BackupCheckupState {
  try {
    const raw = storage.getString(BACKUP_CHECKUP_STORAGE_KEY);
    return raw ? sanitizeBackupCheckupState(JSON.parse(raw)) : {};
  } catch (error) {
    console.log('[BACKUP] checkup read failed', error);
    return {};
  }
}

// Referentially-stable snapshot for useSyncExternalStore — only replaced when a
// write actually changes it.
let cache: BackupCheckupState = read();

function write(next: BackupCheckupState): void {
  cache = next;
  try {
    storage.set(BACKUP_CHECKUP_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.log('[BACKUP] checkup write failed', error);
  }
  emit();
}

/** Record a successful backup verification — resets the 30-day checkup cycle. */
export function markBackupVerifyNow(now: number): void {
  write({ ...cache, lastVerifyAt: now });
}

/** "Later" on the checkup card — snooze for one full cycle. */
export function snoozeBackupCheckup(now: number): void {
  write({ ...cache, snoozedUntil: now + BACKUP_CHECKUP_INTERVAL_MS });
}

/** Reactive periodic-checkup state — local helper for useIsBackupCheckupDue. */
function useBackupCheckupState(): BackupCheckupState {
  return useSyncExternalStore(subscribe, () => cache);
}

/**
 * Reactive convenience: is the checkup due right now? The wall clock is read in
 * an effect (never during render — Date.now() is impure) and recomputed whenever
 * the stored state changes (verify / snooze), so the card appears and hides
 * reactively.
 */
export function useIsBackupCheckupDue(): boolean {
  const state = useBackupCheckupState();
  const [due, setDue] = useState(false);
  useEffect(() => {
    setDue(isBackupCheckupDue(state, Date.now()));
  }, [state]);
  return due;
}
