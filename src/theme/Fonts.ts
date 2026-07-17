/**
 * This file contains all application's style relative to fonts
 */
import { StyleSheet } from 'react-native';
import { ThemeVariables } from '../../@types/theme';

/**
 * Primary UI font family.
 *
 * All four static weights (400/500/600/700) are bundled:
 * - iOS registers them via UIAppFonts, so fontWeight resolves to real faces.
 * - Android registers an XML font family (res/font/inter.xml) through
 *   ReactFontManager.addCustomFont in MainApplication, so fontWeight
 *   resolves to real faces instead of faux bold.
 */
const FONT_FAMILY = 'Inter';

export default function ({ FontSize, Colors }: ThemeVariables) {
  return StyleSheet.create({
    textTinyTiny: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.tinytiny,
      color: Colors.textGray400,
    },
    textTiny: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.tiny,
      color: Colors.textGray400,
    },
    textSmall: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.small,
      color: Colors.textGray400,
    },
    textRegular: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.regular,
      color: Colors.textGray400,
    },
    textMedium: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.medium,
      color: Colors.textGray400,
    },
    textLarge: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.large,
      color: Colors.textGray400,
    },
    textBold: {
      fontFamily: FONT_FAMILY,
      fontWeight: 'bold',
    },
    textItalic: {
      fontStyle: 'italic',
    },
    textUppercase: {
      textTransform: 'uppercase',
    },
    titleTiny: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.tiny * 1.25,
      fontWeight: 'bold',
      color: Colors.textGray800,
    },
    titleSmall: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.small * 1.5,
      fontWeight: 'bold',
      color: Colors.textGray800,
    },
    titleRegular: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.regular * 2,
      fontWeight: 'bold',
      color: Colors.textGray800,
    },
    titleLarge: {
      fontFamily: FONT_FAMILY,
      fontSize: FontSize.large * 2,
      fontWeight: 'bold',
      color: Colors.textGray800,
    },
    textCenter: {
      textAlign: 'center',
    },
    textJustify: {
      textAlign: 'justify',
    },
    textLeft: {
      textAlign: 'left',
    },
    textRight: {
      textAlign: 'right',
    },
    textError: {
      color: Colors.error,
    },
    textSuccess: {
      color: Colors.success,
    },
    textPrimary: {
      color: Colors.primary,
    },
    textLight: {
      color: Colors.textGray200,
    },
    textOnPrimary: {
      color: Colors.textOnPrimary,
    },
  });
}
