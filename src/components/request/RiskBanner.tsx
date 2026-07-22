import React from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';
import { useTheme } from '../../hooks';

export type RiskBannerSeverity = 'critical' | 'high' | 'info';

interface RiskBannerProps {
  severity: RiskBannerSeverity;
  title: string;
  /** Optional detail lines rendered under the title. */
  messages?: string[];
  style?: StyleProp<ViewStyle>;
  /** Override the severity icon (e.g. a chevron for collapsible sections). */
  icon?: LucideIcon;
  /** When set, the header row becomes touchable (collapsible sections). */
  onPress?: () => void;
  /** Extra content rendered below the messages (e.g. an expanded list). */
  children?: React.ReactNode;
}

/**
 * Severity-anchored risk banner — the VaultRiskStrip presentation generalized
 * for reuse across request types. Critical = red octagon, high = amber
 * triangle, info = neutral info icon. ADVISORY presentation only: it never
 * gates or disables the approve control by itself.
 */
const RiskBanner = ({
  severity,
  title,
  messages,
  style,
  icon,
  onPress,
  children,
}: RiskBannerProps) => {
  const { Colors, Fonts } = useTheme();
  const color =
    severity === 'critical'
      ? Colors.error
      : severity === 'high'
        ? Colors.warning
        : Colors.textGray400;
  const HeaderIcon =
    icon ??
    (severity === 'critical'
      ? OctagonAlert
      : severity === 'high'
        ? TriangleAlert
        : Info);
  const header = (
    <>
      <HeaderIcon size={14} color={color} />
      <Text
        style={[
          Fonts.textTiny,
          Fonts.textBold,
          { color, marginLeft: 6, flexShrink: 1 },
        ]}
      >
        {title}
      </Text>
    </>
  );
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: Colors.inputBackground, borderColor: color },
        style,
      ]}
    >
      {onPress ? (
        <TouchableOpacity style={styles.headerRow} onPress={onPress}>
          {header}
        </TouchableOpacity>
      ) : (
        <View style={styles.headerRow}>{header}</View>
      )}
      {(messages ?? []).map((message, index) => (
        <Text
          key={index}
          style={[Fonts.textTiny, { color: Colors.textGray400, marginTop: 4 }]}
          selectable={true}
        >
          {message}
        </Text>
      ))}
      {children}
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
