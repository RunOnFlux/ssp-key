import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import CreationSteps from '../CreationSteps/CreationSteps';
import BlurOverlay from '../../BlurOverlay';

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
          <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
            {t('common:appName.full')}
          </Text>
          <View style={[Gutters.smallTMargin]}>
            <CreationSteps step={3} isImport={false} />
          </View>
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
              {t('home:ssp_key_info')}
            </Text>
            <Text
              style={[Fonts.textSmall, Fonts.textCenter, Gutters.smallTMargin]}
            >
              {t('home:sync_qr_needed')}
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
              onPress={() => scanCode()}
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
              onPress={() => manualInput()}
            >
              <Text style={[Fonts.textRegular, Fonts.textBluePrimary]}>
                {t('home:manual_input')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => reject()}>
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textBluePrimary,
                  Fonts.textCenter,
                ]}
              >
                {t('common:cancel')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default SyncNeeded;
