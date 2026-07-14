import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../hooks';

/**
 * Screen wrapper — safe-area insets + the themed page background.
 */
const ScreenContainer = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => {
  const { Layout, NavigationColors } = useTheme();
  return (
    <SafeAreaView
      style={[
        Layout.fill,
        { backgroundColor: NavigationColors.background },
        style,
      ]}
    >
      {children}
    </SafeAreaView>
  );
};

export default ScreenContainer;
