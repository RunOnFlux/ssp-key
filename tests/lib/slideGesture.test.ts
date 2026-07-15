import {
  clampSlide,
  maxSlideTravel,
  shouldCompleteSlide,
  slideProgress,
  SLIDE_COMPLETE_FRACTION,
  SLIDE_THUMB_SIZE,
  SLIDE_TRACK_PADDING,
} from '../../src/lib/slideGesture';

describe('slideGesture (SlideToApprove math)', () => {
  describe('maxSlideTravel', () => {
    it('computes travel as track minus thumb minus both paddings', () => {
      // 320 - 48 - 2*4 = 264
      expect(maxSlideTravel(320)).toBe(
        320 - SLIDE_THUMB_SIZE - 2 * SLIDE_TRACK_PADDING,
      );
    });

    it('never returns negative travel for tiny/unmeasured tracks', () => {
      expect(maxSlideTravel(0)).toBe(0);
      expect(maxSlideTravel(40)).toBe(0);
      expect(maxSlideTravel(SLIDE_THUMB_SIZE + 2 * SLIDE_TRACK_PADDING)).toBe(
        0,
      );
    });

    it('honors custom thumb/padding', () => {
      expect(maxSlideTravel(200, 50, 5)).toBe(140);
    });
  });

  describe('clampSlide', () => {
    it('clamps below zero', () => {
      expect(clampSlide(-50, 264)).toBe(0);
    });

    it('clamps above max travel', () => {
      expect(clampSlide(999, 264)).toBe(264);
    });

    it('passes through in-range values', () => {
      expect(clampSlide(100, 264)).toBe(100);
    });

    it('treats non-finite input as zero (fail-safe: never completes)', () => {
      expect(clampSlide(NaN, 264)).toBe(0);
      expect(clampSlide(Infinity, 264)).toBe(0);
      expect(clampSlide(-Infinity, 264)).toBe(0);
    });
  });

  describe('slideProgress', () => {
    it('maps translation to [0, 1]', () => {
      expect(slideProgress(0, 264)).toBe(0);
      expect(slideProgress(132, 264)).toBe(0.5);
      expect(slideProgress(264, 264)).toBe(1);
      expect(slideProgress(9999, 264)).toBe(1);
    });

    it('is zero for an unmeasured track', () => {
      expect(slideProgress(100, 0)).toBe(0);
    });
  });

  describe('shouldCompleteSlide — release semantics', () => {
    const maxTravel = 264;
    const threshold = maxTravel * SLIDE_COMPLETE_FRACTION; // 224.4

    it('does NOT complete at rest (a tap/touch-down can never complete)', () => {
      expect(shouldCompleteSlide(0, maxTravel)).toBe(false);
    });

    it('does not complete just below the 85% threshold', () => {
      expect(shouldCompleteSlide(threshold - 0.01, maxTravel)).toBe(false);
      expect(shouldCompleteSlide(maxTravel * 0.5, maxTravel)).toBe(false);
    });

    it('completes exactly at and past the threshold', () => {
      expect(shouldCompleteSlide(threshold, maxTravel)).toBe(true);
      expect(shouldCompleteSlide(maxTravel, maxTravel)).toBe(true);
    });

    it('overshoot past the track still completes (clamped)', () => {
      expect(shouldCompleteSlide(maxTravel + 500, maxTravel)).toBe(true);
    });

    it('can never complete on an unmeasured / zero-width track', () => {
      expect(shouldCompleteSlide(1000, 0)).toBe(false);
      expect(shouldCompleteSlide(0, 0)).toBe(false);
    });

    it('negative drags never complete', () => {
      expect(shouldCompleteSlide(-300, maxTravel)).toBe(false);
    });

    it('respects a custom completion fraction', () => {
      expect(shouldCompleteSlide(50, 100, 0.5)).toBe(true);
      expect(shouldCompleteSlide(49, 100, 0.5)).toBe(false);
    });
  });
});
