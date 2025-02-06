import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  View,
  Settings,
  I18nManager,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import EncryptedStorage from 'react-native-encrypted-storage';
import Keychain from 'react-native-keychain';
import * as CryptoJS from 'crypto-js';
import { getUniqueId } from 'react-native-device-info';
import { useTheme } from '../../hooks';
import { Brand } from '../../components';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux';
import { setDefaultTheme } from '../../store/theme';
import { ApplicationScreenProps } from '../../../@types/navigation';
import { storage } from '../../store/index'; // mmkv

// do we need this page? todo reevaluate to move to app and go straight to MainNavigator
const Startup = ({ navigation }: ApplicationScreenProps) => {
  const { i18n } = useTranslation();
  const { Layout, Gutters } = useTheme();

  const init = async () => {
    try {
      // ====== migrate from encrypted storage to keychain, can be removed later ======
      const password = await EncryptedStorage.getItem('ssp_key_pw');
      if (password) {
        // migrate unique id to our random parameters
        const encKey = await getUniqueId();
        await Keychain.setGenericPassword('enc_key', encKey, {
          service: 'enc_key',
        });
        // encrypt our password with enc_key
        const encryptedPassword = CryptoJS.AES.encrypt(
          password,
          encKey,
        ).toString();
        await Keychain.setGenericPassword('sspkey_pw', encryptedPassword, {
          service: 'sspkey_pw',
        });
        // we use users sspkey_pw + enc_key to encrypt and decrypt data
        // remove from encrypted storage
        await EncryptedStorage.removeItem('ssp_key_pw');
      }
      // fcm token to keychain
      const fcmToken = await EncryptedStorage.getItem('fcmkeytoken');
      if (fcmToken) {
        await Keychain.setGenericPassword('fcm_key_token', fcmToken, {
          service: 'fcm_key_token',
        });
        // remove from encrypted storage
        await EncryptedStorage.removeItem('fcmkeytoken');
      }
      // ====== migrate from encrypted storage to keychain, can be removed later ======

      const deviceLanguage =
        Platform.OS === 'ios'
          ? Settings.get('AppleLocale') || Settings.get('AppleLanguages')[0]
          : I18nManager.getConstants().localeIdentifier;

      console.log(deviceLanguage); // en_US
      const language = storage.getString('language');
      if (language && language !== 'system') {
        await i18n.changeLanguage(language);
      } else {
        await i18n.changeLanguage(deviceLanguage.split('_')[0].split('-')[0]); // use system language
      }
      await new Promise((resolve) =>
        setTimeout(() => {
          resolve(true);
        }, 500),
      );
      setDefaultTheme({ theme: 'default', darkMode: null });
      navigation.reset({
        index: 0,
        routes: [{ name: 'Main' }],
      });
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    init();
  }, []);

  return (
    <View style={[Layout.fill, Layout.colCenter, Gutters.largeTMargin]}>
      <Brand />
      <ActivityIndicator size={'large'} style={[Gutters.largeVMargin]} />
      <PoweredByFlux isClickeable={true} />
    </View>
  );
};

export default Startup;
