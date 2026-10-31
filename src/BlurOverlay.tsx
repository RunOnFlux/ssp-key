import React, { useSyncExternalStore } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useTheme } from './hooks';

/**
 * Privacy cover for app-switcher snapshots (KEY-9).
 *
 * iOS snapshots the screen for the app switcher right after the app leaves
 * the foreground, and an RN `Modal` (seed phrase, xpriv, password prompt) is a
 * separately presented view controller ABOVE the root view — a cover rendered
 * only in the root never reaches it. So this overlay is rendered inside every
 * Modal as well as at the root, and all instances read ONE shared app-state
 * store: a single JS update covers the root and every open modal in the same
 * commit, starting at 'inactive' (which iOS reports before 'background', when
 * the switcher opens), and an instance mounted while the app is already
 * inactive/background covers on its very first render.
 *
 * The cover is opaque — a blur of large seed words can stay legible in a
 * snapshot. Android additionally sets FLAG_SECURE (MainActivity), inherited by
 * RN modals.
 *
 * Residual: the JS thread must commit before iOS takes the snapshot. A native
 * `applicationWillResignActive` overlay window is the fully synchronous fix
 * (AppDelegate, not part of this module).
 */

type AppStateLike = string | null | undefined;

const isCoveringState = (state: AppStateLike) =>
  state === 'background' || state === 'inactive';

const readCurrentState = (): boolean => {
  try {
    return isCoveringState(AppState.currentState);
  } catch {
    return false;
  }
};

const listeners = new Set<() => void>();
let covered = false;
let subscription: { remove: () => void } | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!subscription) {
    covered = readCurrentState();
    subscription = AppState.addEventListener('change', (next) => {
      const nextCovered = isCoveringState(next)
        ? true
        : next === 'active'
          ? false
          : covered;
      if (nextCovered !== covered) {
        covered = nextCovered;
        listeners.forEach((notify) => notify());
      }
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && subscription) {
      subscription.remove();
      subscription = null;
    }
  };
}

const getSnapshot = () => (subscription ? covered : readCurrentState());

/**
 * True while the app is inactive or in the background. Screens that display
 * secrets (seed words, xprivs) can use it to stop rendering them as well.
 */
export function useAppPrivacyCover(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const BlurOverlay = () => {
  const { darkMode, NavigationColors } = useTheme();
  const isCovered = useAppPrivacyCover();

  if (!isCovered) return null; // Don't render the cover when not needed

  return (
    <View
      testID="privacy-cover"
      pointerEvents="none"
      style={[
        styles.fullScreenCover,
        {
          backgroundColor:
            NavigationColors?.background ?? (darkMode ? '#0C0A09' : '#FAFAF9'),
        },
      ]}
    />
  );
};

const styles = StyleSheet.create({
  fullScreenCover: {
    ...StyleSheet.absoluteFill,
    zIndex: 1000, // Ensure it's above everything, including modals
    elevation: 1000,
  },
});

export default BlurOverlay;
