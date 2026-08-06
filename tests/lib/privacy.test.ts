import {
  PRIVACY_MASK,
  PRIVACY_MODE_STORAGE_KEY,
  maskSensitive,
} from '../../src/lib/privacy';

describe('privacy (privacy mode masking)', () => {
  test('storage key is the dedicated, append-only privacyMode key', () => {
    // Must never collide with existing MMKV keys (language, sspConfig,
    // backends, redux persist root).
    expect(PRIVACY_MODE_STORAGE_KEY).toBe('privacyMode');
    expect(['language', 'sspConfig', 'backends', 'persist:root']).not.toContain(
      PRIVACY_MODE_STORAGE_KEY,
    );
  });

  test('returns the value untouched when privacy mode is off', () => {
    expect(maskSensitive('bc1q...abcd', false)).toBe('bc1q...abcd');
    expect(maskSensitive('', false)).toBe('');
  });

  test('returns the fixed mask when privacy mode is on', () => {
    expect(maskSensitive('bc1q...abcd', true)).toBe(PRIVACY_MASK);
    expect(maskSensitive('', true)).toBe(PRIVACY_MASK);
  });

  test('mask is fixed-length — leaks nothing about the hidden value', () => {
    const short = maskSensitive('ab', true);
    const long = maskSensitive('a'.repeat(200), true);
    expect(short).toBe(long);
    expect(short).toBe(PRIVACY_MASK);
    // and contains no characters from the input
    expect(long).not.toContain('a');
  });
});
