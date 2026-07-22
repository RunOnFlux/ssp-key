import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux';
import { PrimaryButton } from '../../components/ui';
import * as Keychain from 'react-native-keychain';
import { clearSignHistory } from '../../lib/signHistory';

type Props = { navigation: any };

function Welcome({ navigation }: Props) {
  const { t } = useTranslation(['welcome']);
  const { darkMode, Fonts, Gutters, Layout, Images } = useTheme();

  const init = async () => {
    try {
      await Keychain.resetGenericPassword({ service: 'enc_key' });
      await Keychain.resetGenericPassword({ service: 'sspkey_pw' });
      await Keychain.resetGenericPassword({ service: 'sspkey_pw_bio' });
      await Keychain.resetGenericPassword({ service: 'sspkey_pw_hash' });
      await Keychain.resetGenericPassword({ service: 'fcm_key_token' });
      await Keychain.resetGenericPassword({ service: 'salt' });
      // the wipe contract says ALL data — the encrypted sign-history blob
      // (service sspkey_sign_history) must not linger on a "cleaned" device
      await clearSignHistory();
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    init();
  }, []);

  return (
    <ScrollView
      keyboardShouldPersistTaps="always"
      style={Layout.fill}
      contentContainerStyle={[
        Layout.fullSize,
        Layout.fill,
        Layout.colCenter,
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
          Gutters.largeBMargin,
        ]}
      >
        <Image
          style={{ width: 120, height: 200 }}
          source={darkMode ? Images.ssp.logoWhite : Images.ssp.logoBlack}
          resizeMode={'contain'}
        />
        <Text style={[Fonts.titleRegular, Gutters.tinyBMargin]}>
          {t('welcome:title')}
        </Text>
        <Text style={[Fonts.textBold, Fonts.textRegular, Gutters.smallBMargin]}>
          {t('welcome:subtitle')}
        </Text>
        <Text style={[Fonts.textSmall, Gutters.largeBMargin]}>
          {t('welcome:description')}
        </Text>
        <PrimaryButton
          label={t('welcome:synchronise_key')}
          style={[Gutters.regularBMargin]}
          onPress={() => navigation.navigate('Create')}
        />
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => navigation.navigate('Restore')}
          hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
        >
          <Text style={[Fonts.textSmall, Fonts.textPrimary]}>
            {t('welcome:restore_key')}
          </Text>
        </TouchableOpacity>
      </View>
      <PoweredByFlux isClickeable={true} />
    </ScrollView>
  );
}

export default Welcome;
