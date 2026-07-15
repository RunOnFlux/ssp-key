import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../hooks';

export type RiskBannerSeverity = 'critical' | 'high' | 'info';

interface RiskBannerProps {
  severity: RiskBannerSeverity;
  title: string;
  /** Optional detail lines rendered under the title. */
  messages?: string[];
  style?: StyleProp<ViewStyle>;
}

/**
 * Severity-anchored risk banner — the VaultRiskStrip presentation generalized
 * for reuse across request types. Critical = red octagon, high = amber
 * triangle, info = neutral info icon. ADVISORY presentation only: it never
 * gates or disables the approve control by itself.
 */
const RiskBanner = ({ severity, title, messages, style }: RiskBannerProps) => {
  const { Colors, Fonts } = useTheme();
  const color =
    severity === 'critical'
      ? Colors.error
      : severity === 'high'
        ? Colors.warning
        : Colors.textGray400;
  const iconName =
    severity === 'critical'
      ? 'alert-octagon'
      : severity === 'high'
        ? 'alert-triangle'
        : 'info';
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: Colors.inputBackground, borderColor: color },
        style,
      ]}
    >
      <View style={styles.headerRow}>
        <Icon name={iconName} size={14} color={color} />
        <Text
          style={[
            Fonts.textTiny,
            Fonts.textBold,
            { color, marginLeft: 6, flexShrink: 1 },
          ]}
        >
          {title}
        </Text>
      </View>
      {(messages ?? []).map((message, index) => (
        <Text
          key={index}
          style={[Fonts.textTiny, { color: Colors.textGray400, marginTop: 4 }]}
          selectable={true}
        >
          {message}
        </Text>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    width: '90%',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default RiskBanner;
