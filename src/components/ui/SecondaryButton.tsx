import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../hooks';
import type { ActionButtonProps } from './PrimaryButton';

/**
 * Secondary action button — outlined, amber border + amber label on the
 * surface background. Height >= 44, radius 8 (via Common.button theme styles).
 */
const SecondaryButton = ({
  label,
  onPress,
  disabled,
  loading,
  accessibilityLabel,
  style,
}: ActionButtonProps) => {
  const { Colors, Common, Fonts } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        Common.button.outlineRounded,
        Common.button.secondaryButton,
        style,
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      {loading && (
        <ActivityIndicator
          size={'large'}
          color={Colors.primary}
          style={[{ position: 'absolute' }]}
        />
      )}
      <Text style={[Fonts.textRegular, Fonts.textPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
};

export default SecondaryButton;
