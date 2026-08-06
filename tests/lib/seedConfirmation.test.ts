import {
  DEFAULT_CHALLENGE_COUNT,
  DEFAULT_OPTION_COUNT,
  generateWordChallenge,
  generateWordChallenges,
  isCorrectWord,
} from '../../src/lib/seedConfirmation';
import { wordlist } from '@scure/bip39/wordlists/english.js';

// deterministic rng (mulberry32) so challenge construction is reproducible
const seededRng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// valid 24-word BIP39-style phrase words (values only matter as strings)
const PHRASE_24 = (
  'abandon ability able about above absent absorb abstract absurd abuse ' +
  'access accident account accuse achieve acid acoustic acquire across act ' +
  'action actor actress actual'
).split(' ');

const PHRASE_12 = PHRASE_24.slice(0, 12);

describe('seedConfirmation', () => {
  describe('generateWordChallenge', () => {
    it('includes the correct word exactly once among unique options', () => {
      const rng = seededRng(1);
      const challenge = generateWordChallenge(PHRASE_24, 5, 6, rng);
      expect(challenge.position).toBe(5);
      expect(challenge.options).toHaveLength(6);
      expect(
        challenge.options.filter((word) => word === PHRASE_24[5]),
      ).toHaveLength(1);
      expect(new Set(challenge.options).size).toBe(6);
    });

    it('never uses other phrase words as decoys', () => {
      for (let seed = 0; seed < 25; seed++) {
        const challenge = generateWordChallenge(
          PHRASE_24,
          0,
          8,
          seededRng(seed),
        );
        const decoys = challenge.options.filter(
          (word) => word !== PHRASE_24[0],
        );
        decoys.forEach((decoy) => {
          expect(PHRASE_24).not.toContain(decoy);
          expect(wordlist).toContain(decoy);
        });
      }
    });

    it('shuffles the correct word position across runs', () => {
      const positions = new Set<number>();
      for (let seed = 0; seed < 40; seed++) {
        const challenge = generateWordChallenge(
          PHRASE_24,
          3,
          6,
          seededRng(seed),
        );
        positions.add(challenge.options.indexOf(PHRASE_24[3]));
      }
      // with 40 deterministic runs the correct answer must not sit at a
      // single fixed index
      expect(positions.size).toBeGreaterThan(1);
    });

    it('throws for out-of-range positions', () => {
      expect(() => generateWordChallenge(PHRASE_12, -1)).toThrow();
      expect(() => generateWordChallenge(PHRASE_12, 12)).toThrow();
    });
  });

  describe('generateWordChallenges', () => {
    it('produces the default number of challenges with default options', () => {
      const challenges = generateWordChallenges(
        PHRASE_24,
        undefined,
        undefined,
        seededRng(7),
      );
      expect(challenges).toHaveLength(DEFAULT_CHALLENGE_COUNT);
      challenges.forEach((challenge) => {
        expect(challenge.options).toHaveLength(DEFAULT_OPTION_COUNT);
      });
    });

    it('uses distinct in-range positions sorted ascending', () => {
      for (let seed = 0; seed < 25; seed++) {
        const challenges = generateWordChallenges(
          PHRASE_24,
          3,
          6,
          seededRng(seed),
        );
        const positions = challenges.map((challenge) => challenge.position);
        expect(new Set(positions).size).toBe(3);
        positions.forEach((position) => {
          expect(position).toBeGreaterThanOrEqual(0);
          expect(position).toBeLessThan(24);
        });
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      }
    });

    it('clamps the challenge count to the phrase length', () => {
      const challenges = generateWordChallenges(
        PHRASE_12.slice(0, 2),
        5,
        4,
        seededRng(3),
      );
      expect(challenges).toHaveLength(2);
    });

    it('works for 12-word phrases', () => {
      const challenges = generateWordChallenges(PHRASE_12, 3, 6, seededRng(9));
      expect(challenges).toHaveLength(3);
      challenges.forEach((challenge) => {
        expect(challenge.position).toBeLessThan(12);
        expect(challenge.options).toContain(PHRASE_12[challenge.position]);
      });
    });
  });

  describe('isCorrectWord', () => {
    it('accepts only the word at the challenged position', () => {
      const challenge = generateWordChallenge(PHRASE_24, 10, 6, seededRng(11));
      expect(isCorrectWord(PHRASE_24, challenge, PHRASE_24[10])).toBe(true);
      challenge.options
        .filter((word) => word !== PHRASE_24[10])
        .forEach((decoy) => {
          expect(isCorrectWord(PHRASE_24, challenge, decoy)).toBe(false);
        });
    });
  });
});
