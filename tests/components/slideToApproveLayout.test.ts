import fs from 'fs';
import path from 'path';

/**
 * Regression guard for the collapsed slide-to-approve control.
 *
 * SlideToApprove positions every one of its children absolutely, so the track
 * has zero intrinsic width. It originally declared `width: '100%'`, and in Yoga
 * a percentage width resolves to 0 whenever the parent's width is indefinite.
 * Every request component wraps the slider in a View inside Home's
 * `Layout.colCenter` (alignItems: 'center'), which makes that wrapper
 * shrink-to-fit — so the track rendered as nothing but its two 1pt borders and
 * the SSP Key had no working approve control on ANY request screen.
 *
 * Jest has no Yoga layout pass, so the measured width cannot be asserted here.
 * These tests instead pin the two structural invariants that produce a
 * correctly sized track:
 *
 *   1. the track stretches rather than relying on a percentage width, and
 *   2. every wrapper around a <SlideToApprove> gives it a definite width by
 *      stretching itself against its (definite-width) parent.
 *
 * If either is broken again, this fails instead of shipping an invisible
 * approve button.
 */

const SRC = path.join(__dirname, '..', '..', 'src');
const SLIDER = path.join(SRC, 'components', 'request', 'SlideToApprove.tsx');

// Every component that mounts a slide-to-approve control. Keep in sync — the
// count assertion below fails if a new request screen appears untested.
const REQUEST_COMPONENTS = [
  'SyncRequest',
  'ChainSyncRequest',
  'PublicNoncesRequest',
  'RecoveryRequest',
  'WkSigningRequest',
  'TransactionRequest',
  'KeyNonceSyncRequest',
  'EvmSigningRequest',
  'VaultSignRequest',
  'FluxNodeStartRequest',
  'VaultXpubRequest',
];

const read = (p: string) => fs.readFileSync(p, 'utf8');

/**
 * The `track: { ... }` style block out of SlideToApprove's StyleSheet, with
 * line comments stripped — the assertions below are about the declarations,
 * and the block's comment explains the very pattern they forbid.
 */
function trackStyleBlock(source: string): string {
  const start = source.indexOf('track: {');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('},', start);
  expect(end).toBeGreaterThan(start);
  return source
    .slice(start, end)
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The style expression of the innermost <View> wrapping <SlideToApprove>.
 * Returns the text between that `<View` and the `>` that opens its children.
 */
function sliderWrapperStyle(source: string): string {
  const sliderAt = source.indexOf('<SlideToApprove');
  expect(sliderAt).toBeGreaterThan(-1);
  const before = source.slice(0, sliderAt);
  const viewAt = before.lastIndexOf('<View');
  expect(viewAt).toBeGreaterThan(-1);
  return before.slice(viewAt);
}

describe('SlideToApprove track sizing', () => {
  const source = read(SLIDER);

  it('stretches to its parent instead of using a percentage width', () => {
    expect(trackStyleBlock(source)).toContain("alignSelf: 'stretch'");
  });

  it('never reintroduces a percentage width on the track', () => {
    // A percentage resolves to 0 against an indefinite parent width, which is
    // exactly how the control silently disappeared.
    expect(trackStyleBlock(source)).not.toMatch(/width:\s*'\d+%'/);
  });

  it('keeps its children absolutely positioned (why a percentage cannot work)', () => {
    // This is the precondition that makes the intrinsic width zero. If it ever
    // stops being true the reasoning above needs revisiting.
    for (const layer of ['labelLayer', 'fillLabelLayer', 'fill', 'thumb']) {
      const at = source.indexOf(`${layer}: {`);
      expect(at).toBeGreaterThan(-1);
      expect(source.slice(at, source.indexOf('},', at))).toContain(
        "position: 'absolute'",
      );
    }
  });
});

describe('every request screen gives the slider a definite width', () => {
  it.each(REQUEST_COMPONENTS)('%s stretches its slider wrapper', (name) => {
    const file = path.join(SRC, 'components', name, `${name}.tsx`);
    const style = sliderWrapperStyle(read(file));
    // Stretching (not width: '100%') so the caller's horizontal margins are
    // still honoured — five of these wrappers carry regularL/RMargin.
    expect(style).toContain('Layout.selfStretch');
  });

  it('covers every component that mounts a SlideToApprove', () => {
    const dir = path.join(SRC, 'components');
    const mounted = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'request')
      .filter((e) => {
        const f = path.join(dir, e.name, `${e.name}.tsx`);
        return fs.existsSync(f) && read(f).includes('<SlideToApprove');
      })
      .map((e) => e.name)
      .sort();
    expect(mounted).toEqual([...REQUEST_COMPONENTS].sort());
  });
});

describe('slideGesture worklets never use default-parameter values', () => {
  // The worklets Babel plugin captures outer identifiers referenced in a
  // worklet's BODY, but NOT ones inside default-parameter initializers. A
  // module constant used as a parameter default therefore evaluates on the
  // UI runtime against a scope where it does not exist — a ReferenceError
  // that a release build turns into an app abort the moment the pan
  // gesture's onEnd runs (the 2026-08-03 TestFlight slide-to-approve
  // SIGABRT). Defaults must be resolved inside the body via `??`.
  it('has no `=` defaults in any worklet signature', () => {
    const source = read(path.join(SRC, 'lib', 'slideGesture.ts'));
    const signatures = [
      ...source.matchAll(
        /export function \w+\(([\s\S]*?)\)[\s\S]*?\{\s*\n\s*'worklet'/g,
      ),
    ];
    expect(signatures.length).toBeGreaterThanOrEqual(4);
    for (const match of signatures) {
      expect(match[1]).not.toContain('=');
    }
  });
});
