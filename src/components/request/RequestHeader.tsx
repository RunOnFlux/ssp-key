import React from 'react';
import { MONOSPACE_FONT } from '../../lib/typography';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTheme } from '../../hooks';
import { blockchains } from '@storage/blockchains';
import type { cryptos } from '../../types';
import { truncateAddress } from '../../lib/addressDisplay';
import Identicon from './Identicon';

interface RequestHeaderProps {
  /** Screen/request title, e.g. "Transaction Request". */
  title: string;
  /**
   * Identity of the requesting wallet (address / wkIdentity). Drives the
   * deterministic identicon and the truncated identity line.
   */
  identity?: string;
  /** Optional context line shown instead of the truncated identity. */
  subtitle?: string;
  /** Chain pill — rendered from the on-device chain registry. */
  chain?: keyof cryptos;
  style?: StyleProp<ViewStyle>;
}

/**
 * Requesting-wallet identity header: identicon + title/context + chain pill.
 */
const RequestHeader = ({
  title,
  identity,
  subtitle,
  chain,
  style,
}: RequestHeaderProps) => {
  const { Colors, Fonts } = useTheme();
  const chainConfig = chain ? blockchains[chain] : undefined;
  return (
    <View style={[styles.row, style]}>
      {identity ? <Identicon value={identity} size={40} /> : null}
      <View style={styles.titleBlock}>
        <Text style={[Fonts.textSmall, Fonts.textBold]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[Fonts.textTinyTiny, { color: Colors.textGray400 }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : identity ? (
          <Text
            style={[
              Fonts.textTinyTiny,
              styles.mono,
              { color: Colors.textGray400 },
            ]}
            numberOfLines={1}
          >
            {truncateAddress(identity)}
          </Text>
        ) : null}
      </View>
      {chainConfig ? (
        <View style={[styles.pill, { borderColor: Colors.borderSecondary }]}>
          <Text style={[Fonts.textTinyTiny, Fonts.textBold]} numberOfLines={1}>
            {chainConfig.symbol}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '90%',
    marginBottom: 12,
  },
  titleBlock: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  mono: {
    fontFamily: MONOSPACE_FONT,
  },
});

export default RequestHeader;
