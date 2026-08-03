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
  const { Colors, Fonts, darkMode } = useTheme();
  const color =
    severity === 'critical'
      ? Colors.error
      : severity === 'high'
        ? Colors.warning
        : Colors.textGray400;
  // The border keeps the bright semantic amber/red, but as 14pt TEXT on the
  // light banner fill those are 2.2:1 (warning) and 3.8:1 (error) — below AA,
  // on the label that flags the block as security-critical. Light mode
  // therefore titles in the deep ramp step (5.0:1 / 6.5:1 on #FFFFFF); dark
  // mode keeps the bright value, which is already ~7:1 on the dark fill.
  const titleColor = darkMode
    ? color
    : severity === 'critical'
      ? Colors.errorDeep
      : severity === 'high'
        ? Colors.warningDeep
        : color;
  const HeaderIcon =
    icon ??
    (severity === 'critical'
      ? OctagonAlert
      : severity === 'high'
        ? TriangleAlert
        : Info);
  const header = (
    <>
      {/* icon takes the title color — it sits on the label's baseline, so the
          two must match, and the bright amber is 2.2:1 on the light fill */}
      <HeaderIcon size={14} color={titleColor} />
      <Text
        style={[
          Fonts.textTiny,
          Fonts.textBold,
          { color: titleColor, marginLeft: 6, flexShrink: 1 },
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
    // Screen owns the side gutter — see ActionCard.
    alignSelf: 'stretch',
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
