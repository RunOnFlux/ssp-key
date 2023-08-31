import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

const SyncNeeded = (props: { actionStatus: (status: string) => void }) => {
  // so we need our xpubkey, then generate address and show user the address. If not the same, tell user to restore or create wallet from scratch.
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  const scanCode = () => {
    console.log('Approve');
    props.actionStatus('scan');
  };
  const manualInput = () => {
    console.log('Approve');
    props.actionStatus('manual');
  };
  const reject = () => {
    console.log('Reject');
    props.actionStatus('cancel');
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => reject()}
    >
      <ScrollView
        style={[Layout.fill, Common.modalBackdrop]}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
          Common.modalView,
        ]}
      >
        <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
          {t('common:appName.full')}
        </Text>
        <View
          style={[
            Layout.fill,
            Layout.relative,
            Layout.fullWidth,
            Layout.justifyContentCenter,
            Layout.alignItemsCenter,
          ]}
        >
          <Icon name="link" size={60} color={Colors.textGray400} />
          <Text
            style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}
          >
            {t('home:sync_needed')}
          </Text>
          <Text
            style={[Fonts.textSmall, Fonts.textCenter, Gutters.smallTMargin]}
          >
            SSP Key is a second authentication factor for your SSP Wallet.
          </Text>
          <Text
            style={[Fonts.textSmall, Fonts.textCenter, Gutters.smallTMargin]}
          >
            Please scan QR code to synchronise your SSP Key first.
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
            onPressIn={() => scanCode()}
          >
            <Text style={[Fonts.textRegular, Fonts.textWhite]}>
              {t('home:scan_code')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              Common.button.outlineRounded,
              Common.button.secondaryButton,
              Layout.fullWidth,
              Gutters.regularBMargin,
            ]}
            onPressIn={() => manualInput()}
          >
            <Text style={[Fonts.textRegular, Fonts.textBluePrimary]}>
              {t('home:manual_input')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPressIn={() => reject()}>
            <Text
              style={[Fonts.textSmall, Fonts.textBluePrimary, Fonts.textCenter]}
            >
              {t('common:cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default SyncNeeded;
