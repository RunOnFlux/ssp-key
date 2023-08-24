import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

const SettingsSection = (props: {
  actionStatus: (status: boolean) => void;
}) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Common } = useTheme();

  const close = () => {
    console.log('Close');
    props.actionStatus(false);
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
        <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
          {t('common:settings')}
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
          <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
            Change Password PIN
          </Text>
          <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
            Change Password PIN? Restore!
          </Text>
          <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
            SSP Relay Server
          </Text>
          <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
            Flux Node Service
          </Text>
        </View>
        <View>
          <TouchableOpacity
            style={[
              Common.button.outlineRounded,
              Common.button.secondaryButton,
              Layout.fullWidth,
              Gutters.regularTMargin,
            ]}
            onPress={() => close()}
          >
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBluePrimary,
                Gutters.regularHPadding,
              ]}
            >
              {t('common:ok')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default SettingsSection;

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
  eyeIcon: {
    padding: 12,
  },
  passwordSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
});
