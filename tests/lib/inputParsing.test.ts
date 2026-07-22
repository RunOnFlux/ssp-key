import {
  xpubRegex,
  isSolanaPubkeyArrayString,
  looksLikeXpub,
  splitSSPInput,
} from '../../src/lib/inputParsing';
import { cryptos } from '../../src/types';

const CHAIN = 'btc' as keyof cryptos;

const VALID_XPUB =
  'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';

const BASE58_CHARS = '123456789ABCDEFGHJKMNPQRSTUVWXYZ';
function makeSolArray(n = 20): string[] {
  // Deterministic base58-looking strings, 32-44 chars, unique
  return Array.from(
    { length: n },
    (_, i) => `${'A'.repeat(31)}${BASE58_CHARS[i]}${'b'.repeat(8)}`,
  );
}

describe('inputParsing', () => {
  describe('xpubRegex / looksLikeXpub', () => {
    it('accepts a standard xpub', () => {
      expect(xpubRegex.test(VALID_XPUB)).toBe(true);
      expect(looksLikeXpub(VALID_XPUB)).toBe(true);
    });

    it('accepts Ltub-style prefixes', () => {
      const ltub = 'Lt' + VALID_XPUB.slice(2);
      expect(looksLikeXpub(ltub)).toBe(true);
    });

    it('rejects non-xpub data', () => {
      expect(looksLikeXpub('')).toBe(false);
      expect(looksLikeXpub('0200aabbcc')).toBe(false);
      expect(looksLikeXpub('xpub-too-short')).toBe(false);
      // base58 alphabet excludes 0, O, I, l
      expect(looksLikeXpub('xp0b' + 'a'.repeat(90))).toBe(false);
    });
  });

  describe('isSolanaPubkeyArrayString', () => {
    it('accepts a JSON array of 20 unique base58 pubkeys', () => {
      expect(isSolanaPubkeyArrayString(JSON.stringify(makeSolArray()))).toBe(
        true,
      );
      expect(looksLikeXpub(JSON.stringify(makeSolArray()))).toBe(true);
    });

    it('accepts surrounding whitespace', () => {
      expect(
        isSolanaPubkeyArrayString(`  ${JSON.stringify(makeSolArray())}  `),
      ).toBe(true);
    });

    it('rejects wrong lengths', () => {
      expect(isSolanaPubkeyArrayString(JSON.stringify(makeSolArray(19)))).toBe(
        false,
      );
      expect(isSolanaPubkeyArrayString(JSON.stringify(makeSolArray(21)))).toBe(
        false,
      );
    });

    it('rejects duplicates', () => {
      const arr = makeSolArray();
      arr[5] = arr[4];
      expect(isSolanaPubkeyArrayString(JSON.stringify(arr))).toBe(false);
    });

    it('rejects non-base58 entries and non-string entries', () => {
      const arr: unknown[] = makeSolArray();
      arr[0] = '0OIl' + 'a'.repeat(30); // contains excluded base58 chars
      expect(isSolanaPubkeyArrayString(JSON.stringify(arr))).toBe(false);
      const arr2: unknown[] = makeSolArray();
      arr2[0] = 12345;
      expect(isSolanaPubkeyArrayString(JSON.stringify(arr2))).toBe(false);
    });

    it('rejects invalid JSON and non-arrays', () => {
      expect(isSolanaPubkeyArrayString('not json')).toBe(false);
      expect(isSolanaPubkeyArrayString('{"a":1}')).toBe(false);
    });
  });

  describe('splitSSPInput', () => {
    it('parses bare data with default chain and wallet', () => {
      expect(splitSSPInput('deadbeef', CHAIN)).toEqual({
        chain: 'btc',
        wallet: '0-0',
        dataToProcess: 'deadbeef',
      });
    });

    it('parses chain:data', () => {
      expect(splitSSPInput('ltc:deadbeef', CHAIN)).toEqual({
        chain: 'ltc',
        wallet: '0-0',
        dataToProcess: 'deadbeef',
      });
    });

    it('parses chain:wallet:data', () => {
      expect(splitSSPInput('ltc:0-3:deadbeef', CHAIN)).toEqual({
        chain: 'ltc',
        wallet: '0-3',
        dataToProcess: 'deadbeef',
      });
    });

    it('returns empty dataToProcess for empty input', () => {
      expect(splitSSPInput('', CHAIN)).toEqual({
        chain: 'btc',
        wallet: '0-0',
        dataToProcess: '',
      });
    });

    it('chain:wallet with missing data yields undefined dataToProcess (falsy, matches historical behavior)', () => {
      const res = splitSSPInput('ltc:0-3', CHAIN);
      expect(res.chain).toBe('ltc');
      expect(res.wallet).toBe('0-3');
      expect(res.dataToProcess).toBeFalsy();
    });
  });
});
