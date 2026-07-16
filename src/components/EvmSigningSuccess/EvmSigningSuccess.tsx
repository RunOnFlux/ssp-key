import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { CircleCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import BlurOverlay from '../../BlurOverlay';

const EvmSigningSuccess = (props: {
  actionStatus: (status: boolean) => void;
  signature: string;
}) => {
  // so we need our xpubkey, then generate address and show user the address. If not the same, tell user to restore or create wallet from scratch.
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();

  const close = () => {
    console.log('Close');
    props.actionStatus(false);
  };

  const copyToClipboard = () => {
    Clipboard.setString(props.signature);
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
        keyboardShouldPersistTaps="always"
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
            <CircleCheck size={60} color={Colors.textGray400} />
            <Text
              style={[
                Fonts.textBold,
                Fonts.textRegular,
                Gutters.smallMargin,
                Fonts.textCenter,
              ]}
            >
              {t('home:evm_signing_request_approved')}
            </Text>
            <Text style={[Fonts.textTiny, Fonts.textCenter]}>
              {t('home:evm_signing_request_approved_info')}
            </Text>
            <Text
              style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallTMargin]}
            >
              {t('home:signature')}: {props.signature}
            </Text>
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <TouchableOpacity
              style={[
                Common.button.rounded,
                Common.button.primary,
                Gutters.regularBMargin,
                Gutters.smallTMargin,
              ]}
              onPress={() => close()}
            >
              <Text style={[Fonts.textRegular, Fonts.textOnPrimary]}>
                {t('home:close')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => copyToClipboard()}>
              <Text
                style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}
              >
                {t('home:copy_to_clipboard')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default EvmSigningSuccess;
