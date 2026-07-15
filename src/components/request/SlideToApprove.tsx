import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import {
  clampSlide,
  maxSlideTravel,
  shouldCompleteSlide,
  SLIDE_THUMB_SIZE,
  SLIDE_TRACK_PADDING,
} from '../../lib/slideGesture';

export interface SlideToApproveProps {
  /** Track label, e.g. "Slide to approve". */
  label: string;
  /**
   * Fired EXACTLY ONCE per attempt, only after a full deliberate drag is
   * RELEASED past the completion threshold — never on touch-down
   * (invariant 10). Downstream Authentication (biometric/PIN) is unchanged.
   */
  onComplete: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Slide-to-approve — the approval control for every request type.
 *
 * Gesture semantics (see lib/slideGesture.ts for the tested math):
 * - drag starts only after ~6pt of horizontal intent (vertical scroll passes);
 * - releasing below 85% of the track springs the thumb back — nothing fires;
 * - releasing at/past 85% animates to the end and fires `onComplete` once;
 * - taps and touch-downs never fire anything.
 *
 * Accessibility fallback: screen readers cannot drag, so the control exposes
 * the standard "activate" accessibility action (VoiceOver/TalkBack
 * double-tap) which completes the approval directly. This event is only
 * dispatched by assistive technology — normal touches go to the gesture.
 *
 * The control resets (thumb returns, can be used again) when the `loading`
 * prop transitions true -> false, i.e. when the downstream Authentication
 * modal closes without approving.
 */
const SlideToApprove = ({
  label,
  onComplete,
  disabled,
  loading,
  accessibilityLabel,
  style,
}: SlideToApproveProps) => {
  // React Compiler opt-out: gesture worklets read/write Reanimated shared
  // values (translation.value) from closures created during render — that is
  // the designed Reanimated pattern, but the compiler's ref analysis cannot
  // prove it safe. Memoization here is irrelevant (tiny leaf component).
  'use no memo';
  const { t } = useTranslation(['home']);
  const { Colors, Fonts } = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const [completed, setCompleted] = useState(false);
  const completedRef = useRef(false);
  const wasLoading = useRef(false);
  const translation = useSharedValue(0);

  const maxTravel = maxSlideTravel(trackWidth);
  const enabled = !disabled && !loading && !completed && maxTravel > 0;

  const fireComplete = () => {
    if (completedRef.current || disabled || loading) {
      return;
    }
    completedRef.current = true;
    setCompleted(true);
    onComplete();
  };

  // Reset after the downstream flow releases us (loading true -> false):
  // the Authentication modal was cancelled or the action finished.
  useEffect(() => {
    if (wasLoading.current && !loading) {
      completedRef.current = false;
      setCompleted(false);
      translation.value = withTiming(0, { duration: 200 });
    }
    wasLoading.current = !!loading;
  }, [loading, translation]);

  const panGesture = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(6)
    .failOffsetY([-16, 16])
    .onUpdate((event) => {
      translation.value = clampSlide(event.translationX, maxTravel);
    })
    .onEnd((event) => {
      // Judge completion from the gesture's own final translation — evaluated
      // ONLY on release, never on touch-down (invariant 10).
      if (shouldCompleteSlide(event.translationX, maxTravel)) {
        translation.value = withTiming(maxTravel, { duration: 150 });
        runOnJS(fireComplete)();
      } else {
        translation.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    })
    .onFinalize((_event, success) => {
      // Cancelled/interrupted gesture (never reached onEnd success path):
      // spring back so the thumb is never stranded mid-track.
      if (!success) {
        translation.value = withSpring(0, { damping: 18, stiffness: 180 });
      }
    });

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({
    width: SLIDE_TRACK_PADDING + SLIDE_THUMB_SIZE + translation.value,
  }));

  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'activate' && enabled) {
      translation.value = withTiming(maxTravel, { duration: 150 });
      fireComplete();
    }
  };

  const trackHeight = SLIDE_THUMB_SIZE + 2 * SLIDE_TRACK_PADDING; // 56pt

  return (
    <View
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={t('home:a11y_slide_hint')}
      accessibilityState={{
        disabled: !!disabled || !!loading,
        busy: !!loading,
      }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={onAccessibilityAction}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[
        styles.track,
        {
          height: trackHeight,
          borderRadius: trackHeight / 2,
          backgroundColor: Colors.inputBackground,
          borderColor: Colors.border,
          opacity: disabled ? 0.4 : 1,
        },
        style,
      ]}
    >
      {/* Base label — visible on the unfilled part of the track */}
      <View style={styles.labelLayer} pointerEvents="none">
        <Text
          style={[
            Fonts.textSmall,
            Fonts.textBold,
            { color: Colors.textGray400 },
          ]}
        >
          {label}
        </Text>
        <Icon
          name="chevrons-right"
          size={16}
          color={Colors.textGray400}
          style={styles.labelChevron}
        />
      </View>
      {/* Amber fill grows behind the thumb; the black label is revealed by it */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fill,
          fillStyle,
          {
            backgroundColor: Colors.primary,
            borderRadius: trackHeight / 2,
          },
        ]}
      >
        <View style={[styles.fillLabelLayer, { width: trackWidth }]}>
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              { color: Colors.textOnPrimary },
            ]}
          >
            {label}
          </Text>
          <Icon
            name="chevrons-right"
            size={16}
            color={Colors.textOnPrimary}
            style={styles.labelChevron}
          />
        </View>
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.thumb,
            thumbStyle,
            { backgroundColor: Colors.primary },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={Colors.textOnPrimary} />
          ) : (
            <Icon
              name={completed ? 'check' : 'chevrons-right'}
              size={22}
              color={Colors.textOnPrimary}
            />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  labelLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelChevron: {
    marginLeft: 6,
  },
  fillLabelLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    left: SLIDE_TRACK_PADDING,
    width: SLIDE_THUMB_SIZE,
    height: SLIDE_THUMB_SIZE,
    borderRadius: SLIDE_THUMB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default SlideToApprove;
