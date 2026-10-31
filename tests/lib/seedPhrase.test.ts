import {
  DERIVABLE_WORD_COUNTS,
  isDerivableSeedPhrase,
} from '../../src/lib/seedPhrase';

const STANDARD =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('isDerivableSeedPhrase', () => {
  test('accepts standard phrases of every BIP-39 length', () => {
    for (const count of DERIVABLE_WORD_COUNTS) {
      expect(
        isDerivableSeedPhrase(Array(count).fill('abandon').join(' ')),
      ).toBe(true);
    }
    expect(isDerivableSeedPhrase(STANDARD)).toBe(true);
  });

  test('accepts non-standard phrases: bad checksum, other word lists', () => {
    expect(isDerivableSeedPhrase(STANDARD.replace('about', 'zoo'))).toBe(true);
    expect(isDerivableSeedPhrase(Array(12).fill('ábaco').join(' '))).toBe(true);
    // Japanese phrases use the ideographic space, NFKD turns it into ' '
    expect(
      isDerivableSeedPhrase(Array(12).fill('あいこくしん').join('　')),
    ).toBe(true);
  });

  test('refuses what a failed decrypt yields, and other lengths', () => {
    for (const value of [
      '',
      null,
      undefined,
      'abandon',
      `${STANDARD} abandon`,
      STANDARD.replace(' ', '  '),
      `${STANDARD} `,
      STANDARD.replace('abandon', 'aban1don'),
      STANDARD.replace('abandon', 'aban\u0000don'),
      '{"k":"0011"}',
    ]) {
      expect(isDerivableSeedPhrase(value)).toBe(false);
    }
  });
});
