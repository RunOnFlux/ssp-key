import React, { useState } from 'react';
import { MONOSPACE_FONT } from '../../lib/typography';
import {
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useTheme } from '../../hooks';
import { splitAddressForDisplay } from '../../lib/addressDisplay';
import { Card } from '../ui';
import Identicon from './Identicon';

interface RecipientCardProps {
  /** Card label, e.g. "To" / "Spender" / "From". */
  label: string;
  address: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Recipient with identicon + anti-poisoning middle truncation: first/last 6
 * characters emphasized, middle de-emphasized. Tapping expands the full
 * address as selectable text.
 */
const RecipientCard = ({ label, address, style }: RecipientCardProps) => {
  const { Colors, Fonts } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const parts = splitAddressForDisplay(address);
  return (
    <Card style={[styles.card, style]}>
      <Text
        style={[
          Fonts.textTinyTiny,
          { color: Colors.textGray400, marginBottom: 4 },
        ]}
      >
        {label}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${address}`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((previous) => !previous)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <View style={styles.row}>
          <Identicon value={address} size={28} />
          <Text style={styles.addressText} numberOfLines={1}>
            <Text style={[Fonts.textTiny, Fonts.textBold, styles.mono]}>
              {parts.start}
            </Text>
            {parts.middle ? (
              <Text
                style={[
                  Fonts.textTiny,
                  styles.mono,
                  { color: Colors.textGray200 },
                ]}
              >
                {'…'}
              </Text>
            ) : null}
            {parts.end ? (
              <Text style={[Fonts.textTiny, Fonts.textBold, styles.mono]}>
                {parts.end}
              </Text>
            ) : null}
          </Text>
          {expanded ? (
            <ChevronUp size={16} color={Colors.textGray400} />
          ) : (
            <ChevronDown size={16} color={Colors.textGray400} />
          )}
        </View>
      </TouchableOpacity>
      {expanded ? (
        <Text
          style={[
            Fonts.textTinyTiny,
            styles.mono,
            styles.fullAddress,
            { color: Colors.textGray400 },
          ]}
          selectable={true}
        >
          {address}
        </Text>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '90%',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addressText: {
    flex: 1,
    marginLeft: 8,
    marginRight: 6,
  },
  mono: {
    fontFamily: MONOSPACE_FONT,
  },
  fullAddress: {
    marginTop: 8,
    lineHeight: 18,
  },
});

export default RecipientCard;
