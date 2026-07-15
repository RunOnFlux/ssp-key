import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../hooks';
import { Card } from '../ui';

interface FeeRowProps {
  /** Row label, e.g. "Network fee". */
  label: string;
  /** Fee amount in crypto units (already formatted). */
  fee: string;
  /** Asset symbol for the fee, e.g. "ETH". */
  symbol: string;
  /** Optional fiat approximation, e.g. "≈ $0.42 USD". */
  fiat?: string;
  style?: StyleProp<ViewStyle>;
}

/** Fee in crypto + fiat as a compact labeled row. */
const FeeRow = ({ label, fee, symbol, fiat, style }: FeeRowProps) => {
  const { Colors, Fonts } = useTheme();
  return (
    <Card style={[styles.card, style]}>
      <View style={styles.row}>
        <Text style={[Fonts.textTiny, { color: Colors.textGray400 }]}>
          {label}
        </Text>
        <View style={styles.amounts}>
          <Text style={[Fonts.textTiny, Fonts.textBold]}>
            {fee} {symbol}
          </Text>
          {fiat ? (
            <Text style={[Fonts.textTinyTiny, { color: Colors.textGray400 }]}>
              {fiat}
            </Text>
          ) : null}
        </View>
      </View>
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
    justifyContent: 'space-between',
  },
  amounts: {
    alignItems: 'flex-end',
  },
});

export default FeeRow;
