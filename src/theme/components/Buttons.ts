import { StyleSheet } from 'react-native';
import { CommonParams } from '../../../@types/theme';

export default function <C>({ Colors, Gutters, Layout }: CommonParams<C>) {
  const base = {
    ...Layout.center,
    ...Gutters.regularHPadding,
    height: 40,
  };
  const rounded = {
    ...base,
    borderRadius: 10,
  };
  const bluePrimary = {
    ...base,
    color: Colors.white,
    backgroundColor: Colors.bluePrimary,
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
    bluePrimary,
    outline: {
      ...base,
      backgroundColor: Colors.transparent,
      borderWidth: 2,
      borderColor: Colors.primary,
    },
    outlineRounded: {
      ...rounded,
      backgroundColor: Colors.transparent,
      borderWidth: 2,
      borderColor: Colors.primary,
    },
  });
}
