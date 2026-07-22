import React from 'react';
import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Key, Send } from 'lucide-react-native';
import { useTheme } from '../../../hooks';
import { blockchains } from '@storage/blockchains';
import { cryptos } from '../../../types';
import PillarMark from '../../../components/PillarMark/PillarMark';

export interface ChainSyncProgressState {
  current: number;
  total: number;
  chain: keyof cryptos;
}

/**
 * The three busy indicators of the Home screen (submitting transaction,
 * batch chain-sync progress, preparing chain keys). JSX relocated verbatim
 * from Home.tsx — Home stays the single stateful orchestrator and passes
 * the flags down.
 */
const HomeProgress = (props: {
  submittingTransaction: boolean;
  preparingChainKeys: boolean;
  chainSyncProgress: ChainSyncProgressState | null;
}) => {
  const { submittingTransaction, preparingChainKeys, chainSyncProgress } =
    props;
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors } = useTheme();

  return (
    <>
      {submittingTransaction && (
        <View
          style={[
            Layout.fill,
            Layout.relative,
            Layout.fullWidth,
            Layout.justifyContentCenter,
            Layout.alignItemsCenter,
          ]}
        >
          <Send size={60} color={Colors.textGray400} />
          <Text
            style={[
              Fonts.textBold,
              Fonts.textCenter,
              Fonts.textRegular,
              Gutters.smallMargin,
            ]}
          >
            {t('home:submitting_transaction')}
          </Text>
          <PillarMark size={30} pulse={true} style={Gutters.regularVMargin} />
        </View>
      )}
      {!submittingTransaction && !preparingChainKeys && chainSyncProgress && (
        <View
          style={[
            Layout.fill,
            Layout.relative,
            Layout.fullWidth,
            Layout.justifyContentCenter,
            Layout.alignItemsCenter,
          ]}
        >
          <Key size={60} color={Colors.textGray400} />
          <Text
            style={[
              Fonts.textBold,
              Fonts.textCenter,
              Fonts.textRegular,
              Gutters.smallMargin,
            ]}
          >
            {t('home:preparing_chain_keys_progress', {
              symbol:
                blockchains[chainSyncProgress.chain]?.symbol ??
                String(chainSyncProgress.chain),
              current: chainSyncProgress.current,
              total: chainSyncProgress.total,
            })}
          </Text>
          <PillarMark size={30} pulse={true} style={Gutters.regularVMargin} />
        </View>
      )}
      {!submittingTransaction && preparingChainKeys && (
        <View
          style={[
            Layout.fill,
            Layout.relative,
            Layout.fullWidth,
            Layout.justifyContentCenter,
            Layout.alignItemsCenter,
          ]}
        >
          <Key size={60} color={Colors.textGray400} />
          <Text
            style={[
              Fonts.textBold,
              Fonts.textCenter,
              Fonts.textRegular,
              Gutters.smallMargin,
            ]}
          >
            {t('home:preparing_chain_keys')}
          </Text>
          <PillarMark size={30} pulse={true} style={Gutters.regularVMargin} />
        </View>
      )}
    </>
  );
};

export default HomeProgress;
