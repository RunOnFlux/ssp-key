import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  StyleProp,
  ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../hooks';

type Props = {
  /** Rendered height in dp; width follows the canonical 184:240 ratio. */
  size?: number;
  /** Subtle opacity pulse — used where the mark stands in for a spinner. */
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Canonical SSP pillar mark (Option C) — three sheared pillars.
 * Left and center are fixed brand ambers; the right pillar is theme-neutral
 * (white on dark, #595A5A on light). Geometry is exact and must not change.
 */
const PillarMark = ({ size = 40, pulse = false, style }: Props) => {
  const { darkMode } = useTheme();
  // lazy useState keeps a stable Animated.Value without touching a ref in render
  const [opacity] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(false);

  // Respect the OS reduce-motion setting: render a static mark instead of the
  // pulse loop, and track live changes to the setting.
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => {
        // accessibility query unavailable — keep animations enabled
      });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!pulse || reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion, opacity]);

  const width = (size * 184) / 240;

  return (
    <Animated.View style={[{ opacity }, style]}>
      <Svg width={width} height={size} viewBox="0 0 184 240">
        <Path d="M0 42v134l46 46V88z" fill="#f59e0b" />
        <Path d="M69 0v194l46 46V46z" fill="#fcd34d" />
        <Path
          d="M138 42v134l46 46V88z"
          fill={darkMode ? '#ffffff' : '#595A5A'}
        />
      </Svg>
    </Animated.View>
  );
};

export default PillarMark;
