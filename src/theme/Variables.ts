/**
 * This file contains the application's variables.
 *
 * Define color, sizes, etc. here instead of duplicating them throughout the components.
 * That allows to change them more easily later on.
 *
 * Color values implement the SSP ecosystem design tokens (DESIGN_TOKENS.md):
 * amber brand ramp anchored at #FBBF24, semantic set, warm-stone neutrals.
 */

import { ThemeNavigationColors } from '../../@types/theme';

/**
 * Colors
 */
export const Colors = {
  transparent: 'rgba(0,0,0,0)',
  inputBackground: '#FFFFFF',
  white: '#ffffff',
  modalBackground: '#FFFFFF',
  shadowColor: '#000',
  backdropColor: 'rgba(0,0,0,0.5)',
  secondaryButtonBackground: '#FFFFFF',
  //Typography — warm stone neutrals
  textGray800: '#1C1917',
  textGray400: '#57534E',
  textGray200: '#A8A29E',
  textInput: '#57534E',
  // Brand — amber anchor. primaryDeep is the pressed/hover-deep variant.
  primary: '#FBBF24',
  primaryDeep: '#F59E0B',
  // Text/icon color on primary (amber) fills — always near-black, never white
  textOnPrimary: '#000000',
  // Semantic
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  // Borders — warm stone
  border: '#E7E5E4',
  borderSecondary: '#D6D3D1',
  // Control boundary (WCAG 1.4.11 needs 3:1). Stone-500 is the one value that
  // clears it against BOTH field fills, so it is intentionally not overridden
  // per theme: 4.8:1 on the light #FFFFFF field, 3.2:1 on the dark #272524 one.
  borderStrong: '#78716C',
  // Deep steps of the semantic ramp, for semantic TEXT on a light fill: the
  // bright variants above are icon/border colors (warning is 2.2:1 and error
  // 3.8:1 on white — both fail body text). Light surfaces only; on the dark
  // surfaces the bright variants already clear 4.5:1.
  warningDeep: '#B45309',
  errorDeep: '#B91C1C',
  //ComponentColors
  circleButtonBackground: '#FEF3C7',
  circleButtonColor: '#92400E',
  // inputArea in Modal
  bgInputAreaModalColor: '#F5F5F4',
  inputAreaModalColor: '#44403C',
};

export const NavigationColors: Partial<ThemeNavigationColors> = {
  primary: Colors.primary,
  background: '#FAFAF9',
  card: '#FAFAF9',
};

/**
 * FontSize
 */
export const FontSize = {
  tinytiny: 12,
  tiny: 14,
  small: 16,
  regular: 20,
  medium: 24,
  large: 40,
};

/**
 * Metrics Sizes
 */
const tiny = 10;
const tinyTiny = tiny * 0.5; // 5
const tinySmall = tiny * 1.5; // 15
const small = tiny * 2; // 20
const regular = tiny * 3; // 30
const large = regular * 2; // 60
export const MetricsSizes = {
  tinyTiny,
  tiny,
  tinySmall,
  small,
  regular,
  large,
};

export default {
  Colors,
  NavigationColors,
  FontSize,
  MetricsSizes,
};
