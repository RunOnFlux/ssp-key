import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { useTheme } from '../../hooks';

/**
 * Shared surface card — themed background + hairline border, radius 12
 * (design tokens: 12 for cards), default padding from Gutters. Pass `style`
 * to extend/override (width, margins, semantic border colors, ...).
 */
const Card = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => {
  const { Colors, Gutters } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: Colors.inputBackground,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: Colors.border,
        },
        Gutters.tinySmallPadding,
        style,
      ]}
    >
      {children}
    </View>
  );
};

export default Card;
