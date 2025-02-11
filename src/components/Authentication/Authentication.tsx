import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import IconB from 'react-native-vector-icons/MaterialCommunityIcons';
import * as CryptoJS from 'crypto-js';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import Keychain from 'react-native-keychain';
import { useTheme } from '../../hooks';
import ToastNotif from '../Toast/Toast';

const Authentication = (props: {
  actionStatus: (status: boolean) => void;
  type: string;
}) => {
  // focusability of inputs
  const textInputA = useRef<TextInput | null>(null);
  const { t } = useTranslation(['home', 'common', 'cr']);
  const { darkMode, Fonts, Gutters, Layout, Common, Colors } = useTheme();
  const [password, setPassword] = useState('');
  const [passwordVisibility, setPasswordVisibility] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [setupBiometrics, setSetupBiometrics] = useState(false);

  useEffect(() => {
    console.log('entered auth');
    Keychain.getSupportedBiometryType()
      .then((resultObject) => {
        if (resultObject) {
          console.log('Biometrics is supported');
          setBiometricsAvailable(true);
          // keep timeout
          // iOS freezes if we call biometrics right away
          // toggle biometrics immediately? reevaluate
          setTimeout(() => {
            initiateFingerprint();
          }, 250);
        } else {
          console.log('Biometrics not supported');
          setBiometricsAvailable(false);
        }
      })
      .catch((error) => {
        console.log(error);
      });
  }, []);

  const initiateFingerprint = () => {
    let textForPrompt = t('home:auth_sensitive_information');
    if (props.type === 'tx') {
      textForPrompt = t('home:auth_confirm_sign_send');
    } else if (props.type === 'sync') {
      textForPrompt = t('home:auth_confirm_sync');
    } else if (props.type === 'pubnonces') {
      textForPrompt = t('home:auth_confirm_public_nonces');
    }
    console.log('Initiate Fingerprint');
    // if success continue, if fail, show error message and only allow password authentication
    // get from keychain
    const options = {
      service: 'sspkey_pw_bio',
      authenticationPrompt: {
        title: textForPrompt,
        // subtitle: textForPrompt, // android only
        // description: textForPrompt, // android only
        cancel: t('common:cancel'),
      },
    };

    Keychain.getGenericPassword(options) // This does NOT work in simulator, library issues, direct access may be granted in simulator but not on real device!
      .then((data) => {
        setTimeout(() => {
          if (data && data.password) {
            setPassword('');
            setPasswordVisibility(false);
            props.actionStatus(true);
          } else {
            // biometrics failed, were tempered with, disable biometrics option and only allow for password authentication
            setPassword('');
            setPasswordVisibility(false);
            displayMessage('error', t('home:err_auth_biometrics_pw_needed'));
            setSetupBiometrics(true);
          }
        }, 250);
      })
      .catch((error) => {
        // some other failure, cancellation of biometrics
        setPassword('');
        setPasswordVisibility(false);
        setSetupBiometrics(true); // setup again
        console.log(error);
      });
  };
  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  const close = () => {
    console.log('Close');
    setPassword('');
    setPasswordVisibility(false);
    props.actionStatus(false);
  };

  const grantAccess = async () => {
    try {
      console.log('Grant Access');
      // get from keychain
      const passwordHash = await Keychain.getGenericPassword({
        service: 'sspkey_pw_hash',
      });
      // get salt
      const saltData = await Keychain.getGenericPassword({
        service: 'salt',
      });
      // from user password create hash
      if (!passwordHash || !saltData) {
        throw new Error('Unable to decrypt stored data');
      }
      // generate hash of our password
      const key256Bits1000Iterations = CryptoJS.PBKDF2(
        password,
        saltData.password,
        {
          keySize: 256 / 32,
          iterations: 1000, // more is too slow, favor performance, this is already 0.1 seconds
        },
      );
      const pwHash = key256Bits1000Iterations.toString();
      if (passwordHash.password !== pwHash) {
        displayMessage('error', t('home:err_auth_pw_incorrect'));
        return;
      }
      if (setupBiometrics) {
        // if we authenticated with password, check if biometrics is available and store the secret so bio can be used next time
        const isBiometricsSupported = await Keychain.getSupportedBiometryType();
        if (isBiometricsSupported) {
          const passwordData = await Keychain.getGenericPassword({
            service: 'sspkey_pw',
          });
          if (passwordData) {
            await Keychain.setGenericPassword(
              'sspkey_pw_bio',
              passwordData.password,
              {
                service: 'sspkey_pw_bio',
                storage: Keychain.STORAGE_TYPE.AES_GCM, // force biometrics encryption
                accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY, // iOS only
                accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET, // all  recognized by Android as a requirement for Biometric enabled storage (Till we got a better implementation);. On android only prompts biometrics, does not check for updates of biometrics. Face not supported.
                securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE, // android only, default is any
              },
            );
          }
        }
      }
      setPassword('');
      setPasswordVisibility(false);
      setSetupBiometrics(false);
      props.actionStatus(true);
    } catch (error) {
      console.log(error);
      displayMessage('error', t('home:err_auth_pw_check'));
    }
  };

  const onChangePassword = (text: string) => {
    setPassword(text);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[Layout.fill, Common.modalBackdrop]}
      >
        <ScrollView
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
            Layout.justifyContentCenter,
          ]}
        >
          <View style={[Common.modalView, styles.modalView]}>
            <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
              {t('home:confirm_password_pin')}
            </Text>
            <View
              style={[
                Layout.fill,
                Layout.relative,
                Layout.fullWidth,
                Layout.alignItemsCenter,
                Gutters.smallTMargin,
              ]}
            >
              <Text
                style={[
                  Fonts.textBold,
                  Fonts.textSmall,
                  Fonts.textCenter,
                  Gutters.smallTMargin,
                ]}
              >
                {props.type === 'tx'
                  ? t('home:auth_sign_tx')
                  : props.type === 'sync'
                    ? t('home:auth_sync_ssp')
                    : props.type === 'pubnonces'
                      ? t('home:auth_sync_pub_nonces')
                      : t('home:auth_sensitive_inf')}
              </Text>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {props.type === 'tx'
                  ? t('home:auth_confirm_with_pw')
                  : props.type === 'sync'
                    ? t('home:auth_confirm_with_pw')
                    : props.type === 'pubnonces'
                      ? t('home:auth_confirm_with_pw')
                      : t('home:auth_grant_access_pw')}
              </Text>

              {biometricsAvailable && (
                <IconB
                  name="fingerprint"
                  size={50}
                  color={Colors.bluePrimary}
                  style={[Fonts.textCenter, Gutters.regularTMargin]}
                  onPress={() => initiateFingerprint()}
                />
              )}
              {!biometricsAvailable && <View style={[Gutters.smallMargin]} />}
              <View
                style={[
                  Layout.rowCenter,
                  Common.inputWithButtonBgModalColors,
                  styles.inputWithButton,
                ]}
              >
                <TextInput
                  style={[Common.textInput, Common.textInputBgModal]}
                  autoComplete="new-password"
                  textContentType="password"
                  autoCapitalize="none"
                  placeholder={t('cr:confirm_key_pin')}
                  placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
                  secureTextEntry={passwordVisibility ? false : true}
                  onChangeText={onChangePassword}
                  value={password}
                  autoCorrect={false}
                  ref={textInputA}
                  onPressIn={() => textInputA.current?.focus()}
                />
                <TouchableOpacity
                  onPress={() => setPasswordVisibility(!passwordVisibility)}
                  style={Common.inputIcon}
                >
                  <Icon
                    name={passwordVisibility ? 'eye' : 'eye-off'}
                    size={20}
                    color={Colors.bluePrimary}
                  />
                </TouchableOpacity>
              </View>
            </View>
            <View style={[Layout.justifyContentEnd]}>
              <TouchableOpacity
                style={[
                  Common.button.rounded,
                  Common.button.bluePrimary,
                  Gutters.regularBMargin,
                  Gutters.smallTMargin,
                ]}
                onPress={() => grantAccess()}
              >
                <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                  {props.type === 'sensitive'
                    ? t('home:grant_access')
                    : t('common:confirm')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => close()}>
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
      </KeyboardAvoidingView>
      <ToastNotif />
    </Modal>
  );
};

export default Authentication;

const styles = StyleSheet.create({
  modalView: {
    justifyContent: 'center',
    left: 0,
    right: 0,
    height: 480,
    bottom: 40,
  },
  inputWithButton: {
    marginTop: 30,
    width: '100%',
    borderRadius: 10,
  },
});
