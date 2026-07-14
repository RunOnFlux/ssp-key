import React from 'react';
import {
  ActivityIndicator,
  StyleProp,
  Text,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { useTheme } from '../../hooks';

export interface ActionButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Primary action button — amber fill, near-black label (never white on amber).
 * Height >= 44, radius 8 (via Common.button theme styles). Loading state
 * renders an ActivityIndicator overlay while keeping the label visible,
 * matching the app-wide pattern.
 */
const PrimaryButton = ({
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
      style={[Common.button.rounded, Common.button.primary, style]}
      disabled={disabled}
      onPress={onPress}
    >
      {loading && (
        <ActivityIndicator
          size={'large'}
          color={Colors.textOnPrimary}
          style={[{ position: 'absolute' }]}
        />
      )}
      <Text style={[Fonts.textRegular, Fonts.textOnPrimary]}>{label}</Text>
    </TouchableOpacity>
  );
};

export default PrimaryButton;
