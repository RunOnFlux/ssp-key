import { StyleSheet } from 'react-native';
import { CommonParams } from '../../../@types/theme';

export default function <C>({ Colors, Gutters, Layout }: CommonParams<C>) {
  const base = {
    ...Layout.center,
    // minHeight (not height) so long translations can wrap without clipping
    minHeight: 44,
  };
  const rounded = {
    ...base,
    borderRadius: 8,
  };
  const primary = {
    ...base,
    color: Colors.textOnPrimary,
    backgroundColor: Colors.primary,
    ...Gutters.regularHPadding,
  };
  const secondaryButton = {
    ...base,
    color: Colors.primary,
    backgroundColor: Colors.secondaryButtonBackground,
    borderColor: Colors.primary,
    // match primary: keep wrapped labels off the border
    ...Gutters.regularHPadding,
  };
  const danger = {
    ...base,
    color: Colors.white,
    backgroundColor: Colors.error,
    ...Gutters.regularHPadding,
  };
  const circle = {
    ...Layout.center,
    height: 70,
    width: 70,
    borderRadius: 35,
    backgroundColor: Colors.circleButtonBackground,
    color: Colors.circleButtonColor,
    fill: Colors.circleButtonColor,
  };

  return StyleSheet.create({
    base,
    rounded,
    circle,
    primary,
    secondaryButton,
    danger,
    outline: {
      ...base,
      backgroundColor: Colors.transparent,
      borderWidth: 1,
      borderColor: Colors.primary,
    },
    outlineRounded: {
      ...rounded,
      borderWidth: 1,
    },
  });
}
