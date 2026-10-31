/**
 * Seed phrase checks that do not depend on the BIP-39 English word list.
 *
 * SSP Key only creates standard English BIP-39 phrases, but a user can
 * restore their own phrase from another wallet: another BIP-39 word list, or
 * a phrase whose checksum does not pass. Keys still derive from it
 * (PBKDF2 over the NFKD-normalised phrase) as long as it has a BIP-39 word
 * count, which is all @scure/bip39's mnemonicToSeedSync requires.
 */

// Word counts a BIP-39 seed can be derived from.
export const DERIVABLE_WORD_COUNTS = [12, 15, 18, 21, 24];

// A word is letters only: ASCII letters, or any non-ASCII character that is
// not whitespace (other BIP-39 word lists). No digits, punctuation, spaces or
// control characters. A loop rather than \p{L}, so it does not depend on the
// JS engine's Unicode property support.
function isSeedWord(word: string): boolean {
  if (!word) return false;
  for (const ch of word) {
    const isAscii = (ch.codePointAt(0) ?? 0) < 0x80;
    if (isAscii ? !/[A-Za-z]/.test(ch) : /\s/.test(ch)) return false;
  }
  return true;
}

/**
 * Whether keys can be derived from `phrase`: a BIP-39 word count of words
 * separated by single spaces, each made of letters (ASCII letters or any
 * non-ASCII, non-space character).
 *
 * Also the "did the seed decrypt" check: CryptoJS does not authenticate, so
 * a wrong key yields '' or a short run of UTF-8 garbage, which practically
 * never has this shape. A standard phrase always passes.
 */
export function isDerivableSeedPhrase(phrase: unknown): phrase is string {
  if (typeof phrase !== 'string' || !phrase) {
    return false;
  }
  const words = phrase.normalize('NFKD').split(' ');
  return (
    DERIVABLE_WORD_COUNTS.includes(words.length) && words.every(isSeedWord)
  );
}
