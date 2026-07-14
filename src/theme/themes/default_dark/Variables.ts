import { ThemeNavigationColors } from '../../../../@types/theme';

/**
 * Dark-mode overrides — SSP warm-stone dark neutrals (DESIGN_TOKENS.md).
 * The amber brand anchor is identical in both modes.
 */
export const Colors = {
  primary: '#FBBF24',
  primaryDeep: '#F59E0B',
  textOnPrimary: '#000000',
  textGray800: '#FAFAF9',
  textGray400: '#A8A29E',
  textGray200: '#D6D3D1',
  textInput: '#E7E5E4',
  inputBackground: '#272524',
  border: '#272524',
  borderSecondary: '#3D3A38',
  circleButtonBackground: 'rgba(251,191,36,0.12)',
  circleButtonColor: '#FBBF24',
  backdropColor: 'rgba(20,20,20,0.5)',
  modalBackground: '#1A1918',
  shadowColor: '#969696',
  secondaryButtonBackground: '#0C0A09',
  // inputArea in Modal
  bgInputAreaModalColor: '#272524',
  inputAreaModalColor: '#FAFAF9',
};

export const NavigationColors: Partial<ThemeNavigationColors> = {
  primary: Colors.primary,
  background: '#0C0A09',
  card: '#0C0A09',
};

export default {
  Colors,
  NavigationColors,
};
