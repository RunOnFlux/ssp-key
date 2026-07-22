import React, { useState } from 'react';
import {
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { Card } from '../ui';

interface AdvancedSectionProps {
  children: React.ReactNode;
  /** Override the expander label (defaults to "Advanced"). */
  title?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Collapsed-by-default expander for technical fields (raw calldata hex,
 * nonces, full scripts). Always available, never primary content — plain
 * language stays on the primary surface, jargon lives here.
 */
const AdvancedSection = ({ children, title, style }: AdvancedSectionProps) => {
  const { t } = useTranslation(['home']);
  const { Colors, Fonts } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const label = title ?? t('home:advanced');
  return (
    <Card style={[styles.card, style]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((previous) => !previous)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.headerRow}
      >
        {expanded ? (
          <ChevronDown size={16} color={Colors.textGray400} />
        ) : (
          <ChevronRight size={16} color={Colors.textGray400} />
        )}
        <Text
          style={[
            Fonts.textTiny,
            Fonts.textBold,
            { color: Colors.textGray400, marginLeft: 6 },
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
      {expanded ? <View style={styles.content}>{children}</View> : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '90%',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  content: {
    marginTop: 8,
  },
});

export default AdvancedSection;
