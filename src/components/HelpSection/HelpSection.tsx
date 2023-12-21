import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Linking,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

const HelpSection = (props: { actionStatus: (status: boolean) => void }) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Common, Colors, darkMode, Images } =
    useTheme();

  const close = () => {
    console.log('Close');
    props.actionStatus(false);
  };

  const openWebsite = () => {
    console.log('Open Discord');
    Linking.openURL('https://sspwallet.io');
  };

  const openSupport = () => {
    console.log('Open Discord');
    Linking.openURL('https://support.runonflux.io');
  };

  const openDiscord = () => {
    console.log('Open Discord');
    Linking.openURL('https://discord.gg/runonflux');
  };

  const openFlux = () => {
    Linking.openURL('https://runonflux.io');
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <ScrollView
        keyboardShouldPersistTaps="always"
        style={[Layout.fill, Common.modalBackdrop]}
        contentInset={{ bottom: 80 }}
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
            Layout.alignItemsCenter,
          ]}
        >
          <View style={[Gutters.smallVPadding]}>
            <Text
              style={[
                Fonts.textBold,
                Fonts.textSmall,
                Fonts.textCenter,
                Gutters.tinyTMargin,
              ]}
            >
              {t('common:appName.moto')}
            </Text>
            <Text
              style={[Fonts.textSmall, Fonts.textCenter, Gutters.tinyTMargin]}
            >
              {t('home:ssp_help_about')}
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
          <TouchableOpacity
            style={[Gutters.regularVPadding]}
            onPressIn={() => openFlux()}
          >
            <Image
              testID={'powered-by-flux-img'}
              style={{ height: 24, width: 173 }}
              source={
                darkMode ? Images.ssp.poweredByLight : Images.ssp.poweredByDark
              }
            />
          </TouchableOpacity>
        </View>
        <View style={[Layout.justifyContentEnd]}>
          <TouchableOpacity
            style={[
              Common.button.outlineRounded,
              Common.button.secondaryButton,
              Layout.fullWidth,
              Gutters.regularTMargin,
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
      </ScrollView>
    </Modal>
  );
};

export default HelpSection;
