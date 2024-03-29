/**
 * This file contains all application's style relative to fonts
 */
import { StyleSheet } from 'react-native';
import { ThemeVariables } from '../../@types/theme';

export default function ({ FontSize, Colors }: ThemeVariables) {
  return StyleSheet.create({
    textTinyTiny: {
      fontSize: FontSize.tinytiny,
      color: Colors.textGray400,
    },
    textTiny: {
      fontSize: FontSize.tiny,
      color: Colors.textGray400,
    },
    textSmall: {
      fontSize: FontSize.small,
      color: Colors.textGray400,
    },
    textRegular: {
      fontSize: FontSize.regular,
      color: Colors.textGray400,
    },
    textLarge: {
      fontSize: FontSize.large,
      color: Colors.textGray400,
    },
    textBold: {
      fontWeight: 'bold',
    },
    textItalic: {
      fontStyle: 'italic',
    },
    textUppercase: {
      textTransform: 'uppercase',
    },
    titleTiny: {
      fontSize: FontSize.tiny * 1.25,
      fontWeight: 'bold',
      color: Colors.textGray800,
    },
    titleSmall: {
      fontSize: FontSize.small * 1.5,
      fontWeight: 'bold',
      color: Colors.textGray800,
    },
    titleRegular: {
      fontSize: FontSize.regular * 2,
      fontWeight: 'bold',
      color: Colors.textGray800,
    },
    titleLarge: {
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
    textWhite: {
      color: Colors.white,
    },
    textBluePrimary: {
      color: Colors.bluePrimary,
    },
    textLobster: {
      fontFamily: 'lobster',
      fontWeight: 'normal',
    },
  });
}
