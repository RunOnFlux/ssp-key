import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { MONOSPACE_FONT } from '../../lib/typography';
import BlurOverlay from '../../BlurOverlay';
import { PrimaryButton, SuccessHeader } from '../ui';

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
            <SuccessHeader title={t('home:evm_signing_request_approved')} />
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textCenter,
                { color: Colors.textGray400 },
              ]}
            >
              {t('home:evm_signing_request_approved_info')}
            </Text>
            <Text
              selectable={true}
              style={[
                Fonts.textTiny,
                Fonts.textCenter,
                Gutters.smallTMargin,
                { fontFamily: MONOSPACE_FONT, color: Colors.textGray400 },
              ]}
            >
              {t('home:signature')}: {props.signature}
            </Text>
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <PrimaryButton
              label={t('home:close')}
              style={[Gutters.regularBMargin, Gutters.smallTMargin]}
              onPress={() => close()}
            />
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => copyToClipboard()}
              hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
            >
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
