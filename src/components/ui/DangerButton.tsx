import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { useTheme } from '../../hooks';
import type { ActionButtonProps } from './PrimaryButton';

/**
 * Destructive action button — semantic error fill with white label.
 * Height >= 44, radius 8 (via Common.button theme styles).
 */
const DangerButton = ({
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
      style={[Common.button.rounded, Common.button.danger, style]}
      disabled={disabled}
      onPress={onPress}
    >
      {loading && (
        <ActivityIndicator
          size={'large'}
          color={Colors.white}
          style={[{ position: 'absolute' }]}
        />
      )}
      <Text style={[Fonts.textRegular, { color: Colors.white }]}>{label}</Text>
    </TouchableOpacity>
  );
};

export default DangerButton;
