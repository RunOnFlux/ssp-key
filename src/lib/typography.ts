import { Platform } from 'react-native';

/**
 * Platform-correct monospace font stack.
 *
 * React Native's 'monospace' family only exists on Android — on iOS it
 * silently falls back to San Francisco (proportional), which breaks the
 * fixed-width alignment addresses, hashes and raw payloads rely on.
 * Menlo ships with every iOS version.
 *
 * Use this constant instead of hardcoding `fontFamily: 'monospace'`.
 */
export const MONOSPACE_FONT: string = Platform.select({
  ios: 'Menlo',
  default: 'monospace',
});
