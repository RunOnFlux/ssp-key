import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { explorerTxUrl } from '../../lib/explorerUrl';
import { MONOSPACE_FONT } from '../../lib/typography';
import BlurOverlay from '../../BlurOverlay';
import { PrimaryButton, SuccessHeader } from '../ui';

import { cryptos } from '../../types';

const TxSent = (props: {
  txid: string;
  chain: keyof cryptos;
  actionStatus: (status: boolean) => void;
}) => {
  // so we need our xpubkey, then generate address and show user the address. If not the same, tell user to restore or create wallet from scratch.
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  const close = () => {
    console.log('Close');
    props.actionStatus(false);
  };

  const openExplorer = () => {
    console.log('Open Explorer');
    Linking.openURL(explorerTxUrl(props.chain, props.txid));
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <BlurOverlay />
      <ScrollView
        style={[Layout.fill, Common.modalBackdrop]}
        contentInset={{ bottom: 80 }}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
        <View style={[Layout.fill, Common.modalView]}>
          <View
            style={[
              Layout.fill,
              Layout.relative,
              Layout.fullWidth,
              Layout.justifyContentCenter,
              Layout.alignItemsCenter,
            ]}
          >
            <SuccessHeader title={t('home:transaction_sent')} />
            <Text
              selectable={true}
              style={[
                Fonts.textTiny,
                Fonts.textCenter,
                Gutters.smallTMargin,
                { fontFamily: MONOSPACE_FONT, color: Colors.textGray400 },
              ]}
            >
              {props.txid}
            </Text>
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <PrimaryButton
              label={t('home:show_in_explorer')}
              style={[Gutters.regularBMargin, Gutters.smallTMargin]}
              onPress={() => openExplorer()}
            />
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => close()}
              hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
            >
              <Text
                style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}
              >
                {t('home:close')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default TxSent;
