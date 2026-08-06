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

// NOTE: none of these worklets may use a module constant as a DEFAULT
// PARAMETER value. The worklets Babel plugin captures outer identifiers
// referenced in a worklet's BODY, but not ones in default-parameter
// initializers — on the UI runtime the default then evaluates against a
// scope where the module constant does not exist, which is a ReferenceError
// ("property doesn't exist") and, in a release build, an app abort the
// moment the gesture handler runs it. Defaults are therefore resolved
// inside the body via `??`.

/**
 * Maximum horizontal travel of the thumb inside a track of the given width.
 * Never negative (zero-width / unmeasured tracks cannot complete).
 */
export function maxSlideTravel(
  trackWidth: number,
  thumbSize?: number,
  padding?: number,
): number {
  'worklet';
  const thumb = thumbSize ?? SLIDE_THUMB_SIZE;
  const pad = padding ?? SLIDE_TRACK_PADDING;
  const travel = trackWidth - thumb - 2 * pad;
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
  fraction?: number,
): boolean {
  'worklet';
  const completeFraction = fraction ?? SLIDE_COMPLETE_FRACTION;
  if (maxTravel <= 0) {
    return false;
  }
  return clampSlide(translationX, maxTravel) >= maxTravel * completeFraction;
}
