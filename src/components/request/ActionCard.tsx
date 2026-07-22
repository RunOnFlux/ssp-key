import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { CircleCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { Card } from '../ui';

interface ActionCardProps {
  /** Plain-language action, e.g. "Send 250 USDT". */
  action: string;
  /** Optional fiat approximation line, e.g. "≈ $250.04 USD". */
  fiat?: string;
  /**
   * Show the "Decoded on this device" affordance. Only set when every value
   * on the card comes from the on-device decode of the raw payload — never
   * for relay-supplied text (invariant 2).
   */
  decodedOnDevice?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** The decoded action in plain language — the primary content of an approval. */
const ActionCard = ({
  action,
  fiat,
  decodedOnDevice,
  style,
}: ActionCardProps) => {
  const { t } = useTranslation(['home']);
  const { Colors, Fonts } = useTheme();
  return (
    <Card style={[styles.card, style]}>
      <Text
        style={[
          Fonts.textRegular,
          Fonts.textBold,
          Fonts.textCenter,
          styles.tabular,
        ]}
      >
        {action}
      </Text>
      {fiat ? (
        <Text
          style={[
            Fonts.textTiny,
            Fonts.textCenter,
            styles.tabular,
            { color: Colors.textGray400, marginTop: 2 },
          ]}
        >
          {fiat}
        </Text>
      ) : null}
      {decodedOnDevice ? (
        <View style={styles.decodedRow}>
          <CircleCheck size={12} color={Colors.success} />
          <Text
            style={[
              Fonts.textTinyTiny,
              { color: Colors.success, marginLeft: 4 },
            ]}
          >
            {t('home:decoded_on_device')}
          </Text>
        </View>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '90%',
    marginBottom: 12,
  },
  decodedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});

export default ActionCard;
