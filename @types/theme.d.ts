import Variables from '../src/theme/Variables';
import { Fonts, Gutters, Images, Layout } from '../src/theme';
import { Theme as ReactNavigationTheme } from '@react-navigation/native/src/types';

export type ThemeVariables = {
  Colors: typeof Variables.Colors;
  NavigationColors: typeof Variables.NavigationColors;
  FontSize: typeof Variables.FontSize;
  MetricsSizes: typeof Variables.MetricsSizes;
};

export type Theme<F, G, I, L, C> = ThemeVariables & {
  Fonts: F;
  Gutters: G;
  Images: I;
  Layout: L;
  Common: C;
  Variables?: Partial<ThemeVariables>;
};

type NavigationColors<T> = T extends { colors: infer U } ? U : never;
type ThemeNavigationColors = NavigationColors<ReactNavigationTheme>;

export type ThemeNavigationTheme = {
  dark: boolean;
  colors: ThemeNavigationColors;
};

export type CommonParams<C> = ThemeVariables &
  Pick<
    Theme<
      ReturnType<typeof Fonts>,
      ReturnType<typeof Gutters>,
      ReturnType<typeof Images>,
      ReturnType<typeof Layout>,
      C
    >,
    'Layout' | 'Gutters' | 'Fonts' | 'Images'
  >;

type Margins =
  | 'Margin'
  | 'BMargin'
  | 'TMargin'
  | 'RMargin'
  | 'LMargin'
  | 'VMargin'
  | 'HMargin';
type Paddings =
  | 'Padding'
  | 'BPadding'
  | 'TPadding'
  | 'RPadding'
  | 'LPadding'
  | 'VPadding'
  | 'HPadding';

type MarginKeys = `${keyof ThemeVariables['MetricsSizes']}${Margins}`;
type PaddingKeys = `${keyof ThemeVariables['MetricsSizes']}${Paddings}`;

type Gutters = {
  [key in MarginKeys | PaddingKeys]: {
    [k in string]: number;
  };
};
