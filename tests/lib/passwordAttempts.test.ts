/**
 * KEY-6: the app password prompt had no attempt limit. The counter is now
 * persisted in the keychain and enforces an exponential back-off: 5 free
 * failures, then 30 s doubling per failure, capped at 1 h. Success resets it;
 * nothing is wiped.
 */
import * as Keychain from 'react-native-keychain';

import {
  BASE_LOCKOUT_MS,
  FREE_ATTEMPTS,
  loadAttemptState,
  lockoutDurationMs,
  MAX_LOCKOUT_MS,
  PW_ATTEMPTS_SERVICE,
  recordFailedAttempt,
  remainingLockoutMs,
  resetAttempts,
} from '../../src/components/Authentication/passwordAttempts';

// The access group each item was written to is tracked alongside (unset = the
// default group), so calls naming another group — as lib/keychain's clean-up
// of an earlier build's copy does — leave it alone.
const mockKeychainStore = new Map<string, string>();
const mockKeychainGroups = new Map<string, string>();
type MockKeychainOptions = { service: string; accessGroup?: string };
jest.mock('react-native-keychain', () => {
  const inScope = ({ service, accessGroup }: MockKeychainOptions) =>
    mockKeychainStore.has(service) &&
    (accessGroup === undefined ||
      (mockKeychainGroups.get(service) ?? 'default') === accessGroup);
  return {
    STORAGE_TYPE: { AES_GCM_NO_AUTH: 'AES_GCM_NO_AUTH' },
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    },
    getGenericPassword: jest.fn((opts: MockKeychainOptions) =>
      Promise.resolve(
        inScope(opts)
          ? { password: mockKeychainStore.get(opts.service) }
          : false,
      ),
    ),
    setGenericPassword: jest.fn(
      (_user: string, password: string, opts: MockKeychainOptions) => {
        mockKeychainStore.set(opts.service, password);
        mockKeychainGroups.set(opts.service, opts.accessGroup ?? 'default');
        return Promise.resolve(true);
      },
    ),
    resetGenericPassword: jest.fn((opts: MockKeychainOptions) => {
      if (inScope(opts)) {
        mockKeychainStore.delete(opts.service);
        mockKeychainGroups.delete(opts.service);
      }
      return Promise.resolve(true);
    }),
  };
});

beforeEach(() => {
  mockKeychainStore.clear();
  mockKeychainGroups.clear();
  jest.clearAllMocks();
});

describe('lockoutDurationMs', () => {
  it('allows the first failures for free', () => {
    for (let i = 0; i < FREE_ATTEMPTS; i += 1) {
      expect(lockoutDurationMs(i)).toBe(0);
    }
  });

  it('starts at 30 s after 5 failures and doubles per failure', () => {
    expect(lockoutDurationMs(5)).toBe(BASE_LOCKOUT_MS);
    expect(lockoutDurationMs(6)).toBe(2 * BASE_LOCKOUT_MS);
    expect(lockoutDurationMs(7)).toBe(4 * BASE_LOCKOUT_MS);
  });

  it('caps at one hour', () => {
    expect(lockoutDurationMs(12)).toBe(MAX_LOCKOUT_MS);
    expect(lockoutDurationMs(1000)).toBe(MAX_LOCKOUT_MS);
  });
});

describe('remainingLockoutMs', () => {
  it('counts down from the last failure', () => {
    const state = { failures: 5, lastFailureAt: 1_000_000 };
    expect(remainingLockoutMs(state, 1_000_000)).toBe(BASE_LOCKOUT_MS);
    expect(remainingLockoutMs(state, 1_010_000)).toBe(BASE_LOCKOUT_MS - 10_000);
    expect(remainingLockoutMs(state, 1_000_000 + BASE_LOCKOUT_MS)).toBe(0);
  });

  it('does not shorten the lockout when the clock moves backwards', () => {
    const state = { failures: 6, lastFailureAt: 2_000_000 };
    expect(remainingLockoutMs(state, 1_000_000)).toBe(2 * BASE_LOCKOUT_MS);
  });
});

describe('persisted counter', () => {
  it('locks after the fifth failure and survives a reload', async () => {
    const now = 5_000_000;
    for (let i = 0; i < FREE_ATTEMPTS - 1; i += 1) {
      const state = await recordFailedAttempt(now);
      expect(remainingLockoutMs(state, now)).toBe(0);
    }
    const fifth = await recordFailedAttempt(now);
    expect(fifth.failures).toBe(FREE_ATTEMPTS);
    expect(remainingLockoutMs(fifth, now)).toBe(BASE_LOCKOUT_MS);
    // a fresh prompt (or app restart) reads the same state from the keychain
    const reloaded = await loadAttemptState(now + 1000);
    expect(remainingLockoutMs(reloaded, now + 1000)).toBe(
      BASE_LOCKOUT_MS - 1000,
    );
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      PW_ATTEMPTS_SERVICE,
      expect.any(String),
      expect.objectContaining({
        service: PW_ATTEMPTS_SERVICE,
        accessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
      }),
    );
  });

  it('resets on success', async () => {
    for (let i = 0; i < 7; i += 1) {
      await recordFailedAttempt(1000);
    }
    await resetAttempts();
    const state = await loadAttemptState(1000);
    expect(state).toEqual({ failures: 0, lastFailureAt: 0 });
  });

  it('re-anchors a lockout whose failure time is in the future', async () => {
    mockKeychainStore.set(
      PW_ATTEMPTS_SERVICE,
      JSON.stringify({ failures: 5, lastFailureAt: 9_000_000 }),
    );
    const state = await loadAttemptState(1_000_000);
    expect(state.lastFailureAt).toBe(1_000_000);
    expect(remainingLockoutMs(state, 1_000_000 + BASE_LOCKOUT_MS)).toBe(0);
  });

  it('treats a corrupt counter as a lockout, not a free pass', async () => {
    mockKeychainStore.set(PW_ATTEMPTS_SERVICE, '{not json');
    const state = await loadAttemptState(Date.now());
    expect(remainingLockoutMs(state, Date.now())).toBeGreaterThan(0);
  });

  it('anchors a corrupt counter once, so the lockout expires instead of restarting on every load', async () => {
    mockKeychainStore.set(PW_ATTEMPTS_SERVICE, '{"failures":"x"}');
    const first = await loadAttemptState(1_000_000);
    expect(first).toEqual({
      failures: FREE_ATTEMPTS,
      lastFailureAt: 1_000_000,
    });
    // the anchor is persisted as a valid counter
    expect(
      JSON.parse(mockKeychainStore.get(PW_ATTEMPTS_SERVICE) as string),
    ).toEqual({ failures: FREE_ATTEMPTS, lastFailureAt: 1_000_000 });
    // later loads keep the original anchor ...
    const later = await loadAttemptState(1_000_000 + 10_000);
    expect(later.lastFailureAt).toBe(1_000_000);
    expect(remainingLockoutMs(later, 1_000_000 + 10_000)).toBe(
      BASE_LOCKOUT_MS - 10_000,
    );
    // ... so the lockout ends
    const after = await loadAttemptState(1_000_000 + BASE_LOCKOUT_MS);
    expect(remainingLockoutMs(after, 1_000_000 + BASE_LOCKOUT_MS)).toBe(0);
  });

  it('stays locked (no free pass) when the corrupt counter cannot be re-anchored', async () => {
    mockKeychainStore.set(PW_ATTEMPTS_SERVICE, 'garbage');
    (Keychain.setGenericPassword as jest.Mock).mockRejectedValueOnce(
      new Error('keychain write failed'),
    );
    const state = await loadAttemptState(2_000_000);
    expect(remainingLockoutMs(state, 2_000_000)).toBe(BASE_LOCKOUT_MS);
  });

  it('fails closed when the keychain cannot be read', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockRejectedValueOnce(
      new Error('keychain unavailable'),
    );
    const now = Date.now();
    const state = await loadAttemptState(now);
    expect(remainingLockoutMs(state, now)).toBe(BASE_LOCKOUT_MS);
  });
});
