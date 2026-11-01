/**
 * KEY-6 — persisted password attempt counter with exponential back-off.
 *
 * The app password prompt allowed unlimited guesses. Failures are now counted
 * in the keychain (this device only, never backed up) so neither a restart nor
 * a reinstall-less kill resets them. The first FREE_ATTEMPTS failures cost
 * nothing; each further failure locks the prompt for BASE_LOCKOUT_MS, doubling
 * per failure up to MAX_LOCKOUT_MS. A successful unlock (password or
 * biometrics) resets the counter. Nothing is ever wiped.
 */
import * as Keychain from '../../lib/keychain';

export const PW_ATTEMPTS_SERVICE = 'sspkey_pw_attempts';
export const FREE_ATTEMPTS = 5;
export const BASE_LOCKOUT_MS = 30 * 1000;
export const MAX_LOCKOUT_MS = 60 * 60 * 1000;

export interface PasswordAttemptState {
  failures: number;
  /** Epoch ms of the most recent failure (0 when none). */
  lastFailureAt: number;
}

const EMPTY: PasswordAttemptState = { failures: 0, lastFailureAt: 0 };

/** Lockout that follows the `failures`-th consecutive failure. */
export function lockoutDurationMs(failures: number): number {
  if (!Number.isFinite(failures) || failures < FREE_ATTEMPTS) return 0;
  const doublings = Math.min(failures - FREE_ATTEMPTS, 32);
  return Math.min(BASE_LOCKOUT_MS * 2 ** doublings, MAX_LOCKOUT_MS);
}

/** Milliseconds the prompt stays locked at `now` (0 = unlocked). */
export function remainingLockoutMs(
  state: PasswordAttemptState,
  now: number,
): number {
  const duration = lockoutDurationMs(state.failures);
  if (!duration) return 0;
  // A clock set backwards never shortens the wait below a full lockout.
  if (now < state.lastFailureAt) return duration;
  return Math.max(0, state.lastFailureAt + duration - now);
}

/** The stored counter; null when it is present but corrupt. */
function parseState(raw: string | undefined): PasswordAttemptState | null {
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as Partial<PasswordAttemptState>;
    const failures = Number(parsed.failures);
    const lastFailureAt = Number(parsed.lastFailureAt);
    if (
      !Number.isInteger(failures) ||
      failures < 0 ||
      !Number.isFinite(lastFailureAt) ||
      lastFailureAt < 0
    ) {
      return null;
    }
    return { failures, lastFailureAt };
  } catch {
    return null;
  }
}

async function saveState(state: PasswordAttemptState): Promise<void> {
  await Keychain.setGenericPassword(
    PW_ATTEMPTS_SERVICE,
    JSON.stringify(state),
    {
      service: PW_ATTEMPTS_SERVICE,
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

/**
 * Current counter. A clock that moved backwards past the last failure is
 * re-anchored to now (persisted), so the lockout cannot get stuck forever.
 * A corrupt counter must not unlock anything, nor lock forever: it becomes a
 * lockout anchored at the first load that saw it, persisted ONCE, so it
 * expires like any other lockout (instead of restarting on every load).
 */
export async function loadAttemptState(
  now: number = Date.now(),
): Promise<PasswordAttemptState> {
  let state: PasswordAttemptState;
  try {
    const stored = await Keychain.getGenericPassword({
      service: PW_ATTEMPTS_SERVICE,
    });
    const parsed = parseState(stored ? stored.password : undefined);
    if (!parsed) {
      const anchored = { failures: FREE_ATTEMPTS, lastFailureAt: now };
      // If even this write fails the next load anchors again: still locked
      // (fail closed), never a free pass.
      await saveState(anchored).catch(() => undefined);
      return anchored;
    }
    state = parsed;
  } catch {
    // Keychain unreadable: fail closed into a lockout instead of a free pass.
    return { failures: FREE_ATTEMPTS, lastFailureAt: now };
  }
  if (state.failures > 0 && state.lastFailureAt > now) {
    state = { ...state, lastFailureAt: now };
    await saveState(state).catch(() => undefined);
  }
  return state;
}

/** Record one failed password attempt; returns the new state. */
export async function recordFailedAttempt(
  now: number = Date.now(),
): Promise<PasswordAttemptState> {
  const current = await loadAttemptState(now);
  const next = { failures: current.failures + 1, lastFailureAt: now };
  await saveState(next);
  return next;
}

/** A successful unlock clears the counter. */
export async function resetAttempts(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: PW_ATTEMPTS_SERVICE });
  } catch (error) {
    console.log('[Auth] could not reset attempt counter', error);
  }
}
