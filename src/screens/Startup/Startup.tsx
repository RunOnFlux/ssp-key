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
          storage: Keychain.STORAGE_TYPE.AES,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        // generate salt
        const salt = CryptoJS.lib.WordArray.random(64).toString();
        // store salt, used for hashing password
        await Keychain.setGenericPassword('salt', salt, {
          service: 'salt',
          storage: Keychain.STORAGE_TYPE.AES,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        // generate hash of our password
        const key256Bits1000Iterations = CryptoJS.PBKDF2(password, salt, {
          keySize: 256 / 32,
          iterations: 1000, // more is too slow, favor performance, this is already 0.1 seconds
        });
        const pwHash = key256Bits1000Iterations.toString();
        // store the pwHash
        // this is used in case password is supplied and not biometrics
        await Keychain.setGenericPassword('sspkey_pw_hash', pwHash, {
          // this encrypted one should be for biometrics?
          service: 'sspkey_pw_hash',
          storage: Keychain.STORAGE_TYPE.AES,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        // encrypt our password with enc_key
        const encryptedPassword = CryptoJS.AES.encrypt(
          password,
          encKey,
        ).toString();
        await Keychain.setGenericPassword('sspkey_pw', encryptedPassword, {
          service: 'sspkey_pw',
          storage: Keychain.STORAGE_TYPE.AES,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        const isBiometricsSupported = await Keychain.getSupportedBiometryType();
        if (isBiometricsSupported) {
          await Keychain.setGenericPassword(
            'sspkey_pw_bio',
            encryptedPassword,
            {
              service: 'sspkey_pw_bio',
              storage: Keychain.STORAGE_TYPE.RSA, // https://github.com/oblador/react-native-keychain/issues/244 THIS IS FORCING BIOMETRICS ON ANDROID android only,
              accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY, // iOS only
              accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET, // all  recognized by Android as a requirement for Biometric enabled storage (Till we got a better implementation);. On android only prompts biometrics, does not check for updates of biometrics. Face not supported.
              authenticationType: Keychain.AUTHENTICATION_TYPE.BIOMETRICS, // iOS only Only allow biometrics, not passcodem use default is both
              securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE, // android only, default is any
            },
          );
        }
        // we use users sspkey_pw + enc_key to encrypt and decrypt data
        // remove from encrypted storage
        await EncryptedStorage.removeItem('ssp_key_pw');
      }
      // fcm token to keychain
      const fcmToken = await EncryptedStorage.getItem('fcmkeytoken');
      if (fcmToken) {
        await Keychain.setGenericPassword('fcm_key_token', fcmToken, {
          service: 'fcm_key_token',
          storage: Keychain.STORAGE_TYPE.AES,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
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
