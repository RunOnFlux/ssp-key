import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { useTheme } from './hooks';

const BlurOverlay = () => {
  const { darkMode } = useTheme();
  const [isBlurred, setIsBlurred] = useState(false);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        setIsBlurred(true); // Blur when the app goes to background
      } else if (nextAppState === 'active') {
        setIsBlurred(false); // Remove blur when active again
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, []);

  if (!isBlurred) return null; // Don't render blur when not needed

  return (
    <BlurView
      style={styles.fullScreenBlur}
      blurType={darkMode ? 'dark' : 'light'}
      blurAmount={12}
    />
  );
};

const styles = StyleSheet.create({
  fullScreenBlur: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000, // Ensure it's above everything, including modals
  },
});

export default BlurOverlay;
