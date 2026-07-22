import {
  sessionVerificationWords,
  verificationQrValue,
  parseVerificationQr,
  verificationMatches,
  VERIFY_QR_PREFIX,
  VERIFY_ACCENTS,
  type VerifyEntry,
} from '../../src/lib/pairingVerification';
import { batchVerificationWords } from '../../src/lib/verificationCode';

// Two format-valid xpubs differing only in their tail. These constants and the
// SESSION_WORDS vector are byte-identical to ssp-wallet's spec — that is how
// these two pure tests prove the two devices compute the SAME unified code for
// the same session set (the source of both files is identical too).
const WALLET_XPUB =
  'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';
const KEY_XPUB =
  'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDABC';

// A pairing session that synced two chains: identity (btc) + one extra (eth).
const SESSION: VerifyEntry[] = [
  { chain: 'btc', walletXpub: WALLET_XPUB, keyXpub: KEY_XPUB },
  { chain: 'eth', walletXpub: WALLET_XPUB, keyXpub: KEY_XPUB },
];

// MUST match ssp-wallet's SESSION_WORDS — identical vector ⇒ both devices agree.
const SESSION_WORDS = [
  'sea',
  'sight',
  'tackle',
  'marriage',
  'trumpet',
  'razor',
];

describe('pairingVerification', () => {
  describe('sessionVerificationWords — ONE code per session', () => {
    it('equals batchVerificationWords over the same entries (identity is just another entry)', () => {
      expect(sessionVerificationWords(SESSION)).toEqual(
        batchVerificationWords(SESSION),
      );
    });

    it('matches the fixed cross-device vector (== ssp-wallet for the same session set)', () => {
      expect(sessionVerificationWords(SESSION)).toEqual(SESSION_WORDS);
    });

    it('is order-invariant — the code does not depend on sync order', () => {
      expect(sessionVerificationWords([...SESSION].reverse())).toEqual(
        SESSION_WORDS,
      );
    });

    it('identity-only pairing → aggregate of one entry', () => {
      const single: VerifyEntry[] = [
        { chain: 'btc', walletXpub: WALLET_XPUB, keyXpub: KEY_XPUB },
      ];
      expect(sessionVerificationWords(single)).toEqual(
        batchVerificationWords(single),
      );
      expect(sessionVerificationWords(single)).toHaveLength(6);
    });

    it('a relay swap on ANY chain changes the code', () => {
      const swapped: VerifyEntry[] = [
        SESSION[0],
        { chain: 'eth', walletXpub: WALLET_XPUB, keyXpub: WALLET_XPUB },
      ];
      expect(sessionVerificationWords(swapped)).not.toEqual(SESSION_WORDS);
    });
  });

  describe('verificationQrValue / parseVerificationQr', () => {
    it('round-trips the code through the prefixed QR payload', () => {
      const qr = verificationQrValue(SESSION_WORDS);
      expect(qr).toBe(`${VERIFY_QR_PREFIX}${SESSION_WORDS.join(' ')}`);
      expect(parseVerificationQr(qr)).toBe(SESSION_WORDS.join(' '));
    });

    it('tolerates a missing prefix, extra whitespace and casing', () => {
      expect(
        parseVerificationQr('  SEA  sight   tackle marriage trumpet razor '),
      ).toBe('sea sight tackle marriage trumpet razor');
    });

    it('returns null for empty input', () => {
      expect(parseVerificationQr('   ')).toBeNull();
      expect(parseVerificationQr(VERIFY_QR_PREFIX)).toBeNull();
    });
  });

  describe('verificationMatches — scan-to-verify comparison', () => {
    it('true when the scanned code equals this device own words', () => {
      const qr = verificationQrValue(SESSION_WORDS);
      expect(verificationMatches(SESSION_WORDS, qr)).toBe(true);
    });

    it('true even without the prefix / with noisy whitespace', () => {
      expect(
        verificationMatches(
          SESSION_WORDS,
          '  sea sight tackle marriage trumpet razor  ',
        ),
      ).toBe(true);
    });

    it('false on any mismatch (fail closed)', () => {
      expect(
        verificationMatches(
          SESSION_WORDS,
          verificationQrValue(['a', 'b', 'c', 'd', 'e', 'f']),
        ),
      ).toBe(false);
      expect(verificationMatches(SESSION_WORDS, '')).toBe(false);
    });
  });

  describe('VERIFY_ACCENTS', () => {
    it('provides a stable per-position accent for all 6 words', () => {
      expect(VERIFY_ACCENTS).toHaveLength(6);
    });
  });
});
