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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PoweredByFlux from '../PoweredByFlux/PoweredByFlux';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

const HelpSection = (props: { actionStatus: (status: boolean) => void }) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Common, Colors } = useTheme();

  const close = () => {
    console.log('Close');
    props.actionStatus(false);
  };

  const openWebsite = () => {
    console.log('Open Discord');
    Linking.openURL('https://runonflux.io');
  };

  const openSupport = () => {
    console.log('Open Discord');
    Linking.openURL('https://support.runonflux.io');
  };

  const openDiscord = () => {
    console.log('Open Discord');
    Linking.openURL('https://discord.io/runonflux');
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
          {t('common:help')}
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
          <View style={[Gutters.smallVPadding]}>
            <Text style={[Fonts.textBold, Fonts.textRegular, Fonts.textCenter]}>
              SSP Key
            </Text>
            <Text
              style={[
                Fonts.textBold,
                Fonts.textSmall,
                Fonts.textCenter,
                Gutters.tinyTMargin,
              ]}
            >
              Secure. Simple. Powerful.
            </Text>
            <Text
              style={[Fonts.textSmall, Fonts.textCenter, Gutters.tinyTMargin]}
            >
              Your Second Key Factor authentication for your SSP Wallet.
            </Text>
          </View>

          <TouchableOpacity
            onPressIn={openWebsite}
            style={[Layout.center, Gutters.smallVPadding]}
          >
            <Icon name={'web'} size={30} color={Colors.bluePrimary} />
            <Text style={[Fonts.textSmall, Fonts.textCenter]}>Website</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPressIn={openSupport}
            style={[Layout.center, Gutters.tinyVPadding]}
          >
            <Icon name={'help'} size={30} color={Colors.bluePrimary} />
            <Text style={[Fonts.textSmall, Fonts.textCenter]}>Support</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPressIn={openDiscord}
            style={[Layout.center, Gutters.smallVPadding]}
          >
            <Icon name={'discord'} size={30} color={Colors.bluePrimary} />
            <Text style={[Fonts.textSmall, Fonts.textCenter]}>Discord</Text>
          </TouchableOpacity>
        </View>
        <View>
          <TouchableOpacity
            style={[
              Common.button.outlineRounded,
              Common.button.secondaryButton,
              Layout.fullWidth,
              Gutters.smallTMargin,
            ]}
            onPressIn={() => close()}
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
        <View style={[Gutters.smallTMargin, styles.poweredBy]}>
          <PoweredByFlux />
        </View>
      </ScrollView>
    </Modal>
  );
};

export default HelpSection;

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
  poweredBy: {
    marginBottom: -25,
  },
});
