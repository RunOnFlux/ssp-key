import { wordlist } from '@scure/bip39/wordlists/english.js';

/**
 * Seed-phrase backup word challenge — pure helpers.
 *
 * After the seed phrase is revealed during Create, the user must identify a
 * few randomly-positioned words from their just-generated phrase among decoys
 * from the BIP39 wordlist. This proves they actually wrote the phrase down,
 * unlike a self-attested "I backed it up" checkbox.
 *
 * READ-ONLY over the phrase: these functions only read the in-memory word
 * array to place the correct word and exclude phrase words from the decoy
 * pool. No storage, no encryption, no derivation — nothing cryptographic
 * happens here.
 */

export interface WordChallenge {
  /** 0-based position of the challenged word within the seed phrase. */
  position: number;
  /** Shuffled options containing the correct word exactly once. */
  options: string[];
}

export const DEFAULT_CHALLENGE_COUNT = 3;
export const DEFAULT_OPTION_COUNT = 6;

/** Random source returning a float in [0, 1). Injectable for tests. */
export type Rng = () => number;

const randomInt = (maxExclusive: number, random: Rng): number =>
  Math.floor(random() * maxExclusive);

/** In-place Fisher-Yates shuffle driven by the injected rng. */
const shuffle = <T>(items: T[], random: Rng): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, random);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

/**
 * Build a single challenge for the word at `position`: the correct word mixed
 * at a random position among unique decoys drawn from the BIP39 wordlist.
 * Decoys never belong to the phrase and never duplicate each other.
 */
export const generateWordChallenge = (
  phraseWords: string[],
  position: number,
  optionCount: number = DEFAULT_OPTION_COUNT,
  random: Rng = Math.random,
  list: readonly string[] = wordlist,
): WordChallenge => {
  if (position < 0 || position >= phraseWords.length) {
    throw new Error('Challenge position out of range');
  }
  const phraseSet = new Set(phraseWords);
  const options = new Set<string>([phraseWords[position]]);
  while (options.size < optionCount) {
    const candidate = list[randomInt(list.length, random)];
    if (!phraseSet.has(candidate) && !options.has(candidate)) {
      options.add(candidate);
    }
  }
  return {
    position,
    options: shuffle(Array.from(options), random),
  };
};

/**
 * Build `count` challenges over distinct random positions of the phrase,
 * ordered ascending by position (a natural flow for the user).
 */
export const generateWordChallenges = (
  phraseWords: string[],
  count: number = DEFAULT_CHALLENGE_COUNT,
  optionCount: number = DEFAULT_OPTION_COUNT,
  random: Rng = Math.random,
  list: readonly string[] = wordlist,
): WordChallenge[] => {
  const effectiveCount = Math.min(count, phraseWords.length);
  const positions = new Set<number>();
  while (positions.size < effectiveCount) {
    positions.add(randomInt(phraseWords.length, random));
  }
  return Array.from(positions)
    .sort((a, b) => a - b)
    .map((position) =>
      generateWordChallenge(phraseWords, position, optionCount, random, list),
    );
};

/** True when `selected` is the phrase word the challenge asks for. */
export const isCorrectWord = (
  phraseWords: string[],
  challenge: WordChallenge,
  selected: string,
): boolean => phraseWords[challenge.position] === selected;
