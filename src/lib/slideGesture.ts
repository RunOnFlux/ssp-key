/**
 * Pure math for the SlideToApprove control.
 *
 * Kept out of the component so the completion semantics (the security-relevant
 * part — a slide must be a full, deliberate drag and can never complete from a
 * touch-down) are unit-testable without rendering gestures.
 *
 * All functions are worklets so Reanimated gesture callbacks can call them on
 * the UI thread.
 */

/** Fraction of the full travel that must be covered on release to complete. */
export const SLIDE_COMPLETE_FRACTION = 0.85;

/** Thumb diameter in pt. Track height = thumb + 2 * padding (>= 52pt). */
export const SLIDE_THUMB_SIZE = 48;

/** Inner padding between track edge and thumb. */
export const SLIDE_TRACK_PADDING = 4;

/**
 * Maximum horizontal travel of the thumb inside a track of the given width.
 * Never negative (zero-width / unmeasured tracks cannot complete).
 */
export function maxSlideTravel(
  trackWidth: number,
  thumbSize: number = SLIDE_THUMB_SIZE,
  padding: number = SLIDE_TRACK_PADDING,
): number {
  'worklet';
  const travel = trackWidth - thumbSize - 2 * padding;
  return travel > 0 ? travel : 0;
}

/** Clamp a drag translation to the valid [0, maxTravel] range. */
export function clampSlide(translationX: number, maxTravel: number): number {
  'worklet';
  if (!Number.isFinite(translationX) || translationX < 0) {
    return 0;
  }
  return translationX > maxTravel ? maxTravel : translationX;
}

/** Progress in [0, 1] for the fill/label animation. */
export function slideProgress(translationX: number, maxTravel: number): number {
  'worklet';
  if (maxTravel <= 0) {
    return 0;
  }
  return clampSlide(translationX, maxTravel) / maxTravel;
}

/**
 * Whether a RELEASE at the given translation completes the slide.
 * Only ever evaluated on gesture end — never on touch-down (invariant 10).
 * An unmeasured/zero-width track can never complete.
 */
export function shouldCompleteSlide(
  translationX: number,
  maxTravel: number,
  fraction: number = SLIDE_COMPLETE_FRACTION,
): boolean {
  'worklet';
  if (maxTravel <= 0) {
    return false;
  }
  return clampSlide(translationX, maxTravel) >= maxTravel * fraction;
}
