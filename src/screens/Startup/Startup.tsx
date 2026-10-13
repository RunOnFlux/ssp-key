import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Settings,
  I18nManager,
  Platform,
  Alert,
  AppState,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import EncryptedStorage from 'react-native-encrypted-storage';
import * as Keychain from 'react-native-keychain';
import * as CryptoJS from 'crypto-js';
import { getUniqueId } from 'react-native-device-info';
import JailMonkey from 'jail-monkey';
import { useTheme } from '../../hooks';
import { Brand } from '../../components';
import PillarMark from '../../components/PillarMark/PillarMark';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux';
import { setDefaultTheme } from '../../store/theme';
import { ApplicationScreenProps } from '../../../@types/navigation';
import { storage } from '../../store/index'; // mmkv
import { runEncKeyRotationGate } from '../../store/encKeyMigration';
import { PrimaryButton } from '../../components/ui';

// do we need this page? todo reevaluate to move to app and go straight to MainNavigator
const Startup = ({ navigation }: ApplicationScreenProps) => {
  const { i18n } = useTranslation();
  const { t } = useTranslation(['cr', 'common']);
  const { Layout, Gutters, Fonts } = useTheme();
  // KEY-3: Main must not mount while an enc_key rotation is staged.
  const [upgradeBlocked, setUpgradeBlocked] = useState(false);
  const startupRunning = useRef(false);
  const startupDone = useRef(false);

  const checkJailbroken = () => {
    const isJailbroken = JailMonkey.isJailBroken();
    if (isJailbroken) {
      console.log('jailbroken');
      if (__DEV__) {
        return;
      }
      // if ios, show alert with title and message
      if (Platform.OS === 'ios') {
        Alert.alert(t('cr:jailbroken_device_title'), t('cr:jailbroken_device'));
      } else {
        Alert.alert(t('cr:rooted_device_title'), t('cr:rooted_device'));
      }
    }
  };

  const migrateFromEncryptedStorage = async () => {
    // ====== migrate from encrypted storage to keychain, can be removed later ======
    const password = await EncryptedStorage.getItem('ssp_key_pw');
    if (password) {
      // migrate unique id to our random parameters
      const encKey = await getUniqueId();
      await Keychain.setGenericPassword('enc_key', encKey, {
        service: 'enc_key',
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      // generate salt
      const salt = CryptoJS.lib.WordArray.random(64).toString();
      // store salt, used for hashing password
      await Keychain.setGenericPassword('salt', salt, {
        service: 'salt',
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
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
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      // encrypt our password with enc_key
      const encryptedPassword = CryptoJS.AES.encrypt(
        password,
        encKey,
      ).toString();
      await Keychain.setGenericPassword('sspkey_pw', encryptedPassword, {
        service: 'sspkey_pw',
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      const isBiometricsSupported = await Keychain.getSupportedBiometryType();
      if (isBiometricsSupported) {
        await Keychain.setGenericPassword('sspkey_pw_bio', encryptedPassword, {
          service: 'sspkey_pw_bio',
          storage: Keychain.STORAGE_TYPE.AES_GCM, // force biometrics encryption, on android setGenericPassword PROMPTS for biometric inputs using AES_GCM, RSA does not prompt for it. iOS does not prompt.
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY, // iOS only
          accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET, // all  recognized by Android as a requirement for Biometric enabled storage (Till we got a better implementation);. On android only prompts biometrics, does not check for updates of biometrics. Face not supported.
          securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE, // android only, default is any
          authenticationPrompt: {
            title: t('cr:setup_biometrics'),
            // subtitle: textForPrompt, // android only
            // description: textForPrompt, // android only
            cancel: t('common:cancel'),
          },
        }).catch((error) => {
          // not critical, proceed without it
          console.log(error);
        });
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
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      // remove from encrypted storage
      await EncryptedStorage.removeItem('fcmkeytoken');
    }
    // ====== migrate from encrypted storage to keychain, can be removed later ======
  };

  const finishStartup = async () => {
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
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  /**
   * Runs once the app is in the foreground (and again on every return to the
   * foreground until it got through). The keychain items are WHEN_UNLOCKED_*,
   * so neither migration may run in the background.
   */
  const init = async () => {
    if (startupDone.current || startupRunning.current) return;
    if (AppState.currentState !== 'active') return;
    startupRunning.current = true;
    try {
      await migrateFromEncryptedStorage();

      // KEY-3: installs migrated above (here or in an earlier version) used the
      // device UID as enc_key — and the UID sits in iOS backups next to the
      // MMKV ciphertexts. Rotate it to a random keychain-only key and
      // re-encrypt everything. Runs before Main mounts, so nothing else is
      // reading or writing ciphertexts meanwhile; crash-safe and idempotent
      // (also finishes a rotation an earlier start was interrupted in). While
      // a rotation stays staged, Main is NOT mounted: it would decrypt with
      // (and write new blobs under) an enc_key the data may not be under.
      const gate = await runEncKeyRotationGate();
      if (gate === 'blocked') {
        setUpgradeBlocked(true);
        return;
      }
      if (gate === 'wait') return;
      startupDone.current = true;
      setUpgradeBlocked(false);
      await finishStartup();
    } catch (error) {
      console.log(error);
    } finally {
      startupRunning.current = false;
    }
  };

  useEffect(() => {
    init();
    checkJailbroken();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        init();
      }
    });
    return () => subscription.remove();
  }, []);

  if (upgradeBlocked) {
    return (
      <View
        style={[
          Layout.fill,
          Layout.colCenter,
          Gutters.largeTMargin,
          Gutters.regularHPadding,
        ]}
      >
        <Brand />
        <PillarMark size={48} pulse={true} style={Gutters.largeVMargin} />
        <Text
          style={[Fonts.titleSmall, Fonts.textCenter, Gutters.smallBMargin]}
        >
          {t('cr:security_upgrade_title')}
        </Text>
        <Text style={[Fonts.textSmall, Fonts.textCenter, Gutters.largeBMargin]}>
          {t('cr:security_upgrade_info')}
        </Text>
        <PrimaryButton
          label={t('cr:security_upgrade_retry')}
          onPress={() => {
            void init();
          }}
        />
      </View>
    );
  }

  return (
    <View style={[Layout.fill, Layout.colCenter, Gutters.largeTMargin]}>
      <Brand />
      <PillarMark size={48} pulse={true} style={Gutters.largeVMargin} />
      <PoweredByFlux isClickeable={true} />
    </View>
  );
};

export default Startup;
