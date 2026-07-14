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
import CreationSteps from '../CreationSteps/CreationSteps';
import BlurOverlay from '../../BlurOverlay';
import { PrimaryButton, SecondaryButton } from '../ui';

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
              style={[
                Fonts.textBold,
                Fonts.textCenter,
                Fonts.textRegular,
                Gutters.smallMargin,
              ]}
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
            <TouchableOpacity
              onPress={() => Linking.openURL('https://sspwallet.io/guide')}
            >
              <Text
                style={[
                  Fonts.textTinyTiny,
                  Fonts.textCenter,
                  Gutters.regularTMargin,
                  Gutters.smallLMargin,
                  Gutters.smallRMargin,
                ]}
              >
                {t('home:dont_have_ssp_wallet')}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <PrimaryButton
              label={t('home:scan_code')}
              style={[Gutters.regularBMargin, Gutters.smallTMargin]}
              onPress={() => scanCode()}
            />
            <SecondaryButton
              label={t('home:manual_input')}
              style={[Layout.fullWidth, Gutters.regularBMargin]}
              onPress={() => manualInput()}
            />
            <TouchableOpacity onPress={() => reject()}>
              <Text
                style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}
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
