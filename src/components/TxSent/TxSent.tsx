import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { backends } from '@storage/backends';

const SyncRequest = (props: {
  txid: string; // if chain not provided, default to flux
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
    const backendConfig = backends().flux;
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
        style={[Layout.fill, styles.modalView]}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
        ]}
      >
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
          <Text style={[Fonts.textSmall, Fonts.textCenter]}>{props.txid}</Text>
        </View>
        <View>
          <TouchableOpacity
            style={[
              Common.button.outlineRounded,
              Common.button.secondaryButton,
              Layout.fullWidth,
              Gutters.regularBMargin,
            ]}
            onPressIn={() => openExplorer()}
          >
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBluePrimary,
                Gutters.regularHPadding,
              ]}
            >
              {t('home:show_in_explorer')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPressIn={() => close()}>
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBluePrimary,
                Gutters.regularBMargin,
                Fonts.textCenter,
              ]}
            >
              {t('home:close')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default SyncRequest;

const styles = StyleSheet.create({
  modalView: {
    backgroundColor: 'white',
    margin: 30,
    marginTop: 60,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
