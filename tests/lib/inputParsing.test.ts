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

    it('chain:wallet with missing data yields empty dataToProcess (falsy, matches historical behavior)', () => {
      const res = splitSSPInput('ltc:0-3', CHAIN);
      expect(res.chain).toBe('ltc');
      expect(res.wallet).toBe('0-3');
      expect(res.dataToProcess).toBeFalsy();
    });

    // The wallet's Key fallback QR / manual-input payload is
    // `${chain}:${wallet}:${txHex}` and for EVM txHex is a JSON-stringified
    // userOp, which is full of colons. The whole tail must survive.
    it('preserves an EVM userOp JSON payload byte for byte', () => {
      const userOp = JSON.stringify({
        userOpRequest: {
          sender: '0x1111111111111111111111111111111111111111',
          callData: '0xb61d27f6000000000000000000000000',
          callGasLimit: '0x5ea6',
          verificationGasLimit: '0x11b5a',
          preVerificationGas: '0xdf89',
          maxFeePerGas: '0xee6b28000',
          maxPriorityFeePerGas: '0x77359400',
          signature: '0x00',
        },
        opHash: '0xabc123',
      });
      const res = splitSSPInput(`eth:0-0:${userOp}`, CHAIN);
      expect(res.chain).toBe('eth');
      expect(res.wallet).toBe('0-0');
      expect(res.dataToProcess).toBe(userOp);
      // and it is still parseable, which is what the approval screen does
      expect(JSON.parse(res.dataToProcess)).toHaveProperty('userOpRequest');
    });

    it('preserves an EVM userOp JSON payload without a wallet segment', () => {
      const userOp = JSON.stringify({
        userOpRequest: { sender: '0x1111', callData: '0x2222' },
      });
      const res = splitSSPInput(`pol:${userOp}`, CHAIN);
      expect(res.chain).toBe('pol');
      expect(res.wallet).toBe('0-0');
      expect(res.dataToProcess).toBe(userOp);
    });

    it('preserves every colon in a multi-colon payload', () => {
      const payload = 'a:b:c:d:e';
      expect(splitSSPInput(`eth:1-7:${payload}`, CHAIN)).toEqual({
        chain: 'eth',
        wallet: '1-7',
        dataToProcess: payload,
      });
      expect(splitSSPInput(`eth:${payload}`, CHAIN)).toEqual({
        chain: 'eth',
        wallet: '0-0',
        dataToProcess: payload,
      });
    });

    it('keeps colon-free UTXO hex parsing unchanged', () => {
      const hex = '0200000000010152' + 'ab'.repeat(80);
      expect(splitSSPInput(`btc:1-2:${hex}`, CHAIN)).toEqual({
        chain: 'btc',
        wallet: '1-2',
        dataToProcess: hex,
      });
      expect(splitSSPInput(`btc:${hex}`, CHAIN)).toEqual({
        chain: 'btc',
        wallet: '0-0',
        dataToProcess: hex,
      });
      expect(splitSSPInput(hex, CHAIN)).toEqual({
        chain: 'btc',
        wallet: '0-0',
        dataToProcess: hex,
      });
    });

    it('keeps Solana base64 payload parsing unchanged', () => {
      const base64 = 'AQABA0Vy+3/aWuLpS1eN0Ny4Pw==';
      expect(splitSSPInput(`sol:0-0:${base64}`, CHAIN)).toEqual({
        chain: 'sol',
        wallet: '0-0',
        dataToProcess: base64,
      });
      expect(splitSSPInput(`sol:${base64}`, CHAIN)).toEqual({
        chain: 'sol',
        wallet: '0-0',
        dataToProcess: base64,
      });
    });

    it('keeps sync payloads (xpub, Solana pubkey array) unchanged', () => {
      expect(splitSSPInput(`ltc:${VALID_XPUB}`, CHAIN)).toEqual({
        chain: 'ltc',
        wallet: '0-0',
        dataToProcess: VALID_XPUB,
      });
      const solArray = JSON.stringify(makeSolArray());
      const res = splitSSPInput(`sol:${solArray}`, CHAIN);
      expect(res.dataToProcess).toBe(solArray);
      expect(looksLikeXpub(res.dataToProcess)).toBe(true);
    });

    // A hyphen in the payload's first segment must not be mistaken for a
    // wallet specifier — wallets are always `typeIndex-addressIndex`.
    it('does not treat a hyphenated payload segment as a wallet', () => {
      const payload = '{"a-b":"c:d"}';
      expect(splitSSPInput(`eth:${payload}`, CHAIN)).toEqual({
        chain: 'eth',
        wallet: '0-0',
        dataToProcess: payload,
      });
    });
  });
});
