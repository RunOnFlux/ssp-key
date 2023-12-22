import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { backends } from '@storage/backends';

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
    const backendConfig = backends()[props.chain];
    Linking.openURL(`https://${backendConfig.node}/tx/${props.txid}`);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <ScrollView
        style={[Layout.fill, Common.modalBackdrop]}
        contentInset={{ bottom: 80 }}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
        <View style={[Common.modalView]}>
          <View
            style={[
              Layout.fill,
              Layout.relative,
              Layout.fullWidth,
              Layout.justifyContentCenter,
              Layout.alignItemsCenter,
            ]}
          >
            <Icon name="check-circle" size={60} color={Colors.textGray400} />
            <Text
              style={[
                Fonts.textBold,
                Fonts.textRegular,
                Gutters.smallMargin,
                Fonts.textCenter,
              ]}
            >
              {t('home:transaction_sent')}
            </Text>
            <Text style={[Fonts.textSmall, Fonts.textCenter]}>
              {props.txid}
            </Text>
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <TouchableOpacity
              style={[
                Common.button.rounded,
                Common.button.bluePrimary,
                Gutters.regularBMargin,
                Gutters.smallTMargin,
              ]}
              onPressIn={() => openExplorer()}
            >
              <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                {t('home:show_in_explorer')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPressIn={() => close()}>
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textBluePrimary,
                  Fonts.textCenter,
                ]}
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
