import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Icon from 'react-native-vector-icons/Feather';
import IconB from 'react-native-vector-icons/MaterialCommunityIcons';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import EncryptedStorage from 'react-native-encrypted-storage';
import { useTheme } from '../../hooks';

const rnBiometrics = new ReactNativeBiometrics();

const Authentication = (props: {
  actionStatus: (status: boolean) => void;
  type: string;
}) => {
  // focusability of inputs
  const textInputA = useRef<TextInput | null>(null);
  const { t } = useTranslation(['home', 'common']);
  const { darkMode, Fonts, Gutters, Layout, Common, Colors } = useTheme();
  const [password, setPassword] = useState('');
  const [passwordVisibility, setPasswordVisibility] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  useEffect(() => {
    rnBiometrics.isSensorAvailable().then((resultObject) => {
      const { available, biometryType } = resultObject;

      if (available && biometryType === BiometryTypes.TouchID) {
        console.log('TouchID is supported');
        setBiometricsAvailable(true);
        initiateFingerprint();
      } else if (available && biometryType === BiometryTypes.FaceID) {
        console.log('FaceID is supported');
        setBiometricsAvailable(true);
        initiateFingerprint();
      } else if (available && biometryType === BiometryTypes.Biometrics) {
        console.log('Biometrics is supported');
        setBiometricsAvailable(true);
        initiateFingerprint();
      } else {
        // here we show fallback mechanism if none of the above succeed
        console.log('Biometrics not supported');
        setBiometricsAvailable(false);
      }
    });
  }, []);

  const initiateFingerprint = () => {
    let textForPrompt = 'Grant access to view senstivie SSP Key information.';
    if (props.type === 'tx') {
      textForPrompt = 'Confirm to sign and send transaction.';
    } else if (props.type === 'sync') {
      textForPrompt = 'Confirm to sync SSP Wallet with SSP Key.';
    }
    console.log('Initiate Fingerprint');
    rnBiometrics
      .simplePrompt({
        promptMessage: textForPrompt,
      })
      .then((resultObject) => {
        const { success } = resultObject;

        if (success) {
          console.log('successful biometrics provided');
          setPassword('');
          setPasswordVisibility(false);
          props.actionStatus(true);
        } else {
          console.log('user cancelled biometric prompt');
        }
      })
      .catch((error) => {
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
      const storedPassword = await EncryptedStorage.getItem('ssp_key_pw');
      if (password !== storedPassword) {
        displayMessage('error', 'Password PIN is incorrect');
        return;
      }
      setPassword('');
      setPasswordVisibility(false);
      props.actionStatus(true);
    } catch (error) {
      console.log(error);
      displayMessage('error', 'Error checking password. Try again later.');
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
      <KeyboardAwareScrollView
        enableOnAndroid={true}
        extraScrollHeight={20}
        style={[Layout.fill, Common.modalBackdrop]}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
          Layout.fullWidth,
          Layout.fill,
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
                ? 'You are about to sign and send transaction!'
                : props.type === 'sync'
                ? 'You are about to sync SSP Wallet with SSP Key!'
                : 'You are about to access sensitive information!'}
            </Text>
            <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
              {props.type === 'tx'
                ? 'Confirm with password.'
                : props.type === 'sync'
                ? 'Confirm with password.'
                : 'Grant access with psasword.'}
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
                placeholder="Set Key Password PIN"
                placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
                secureTextEntry={passwordVisibility ? false : true}
                onChangeText={onChangePassword}
                value={password}
                autoCorrect={false}
                ref={textInputA}
                onPressIn={() => textInputA.current?.focus()}
              />
              <TouchableOpacity
                onPressIn={() => setPasswordVisibility(!passwordVisibility)}
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
              onPressIn={() => grantAccess()}
            >
              <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                {props.type === 'sensitive'
                  ? t('home:grant_access')
                  : t('common:confirm')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPressIn={() => close()}>
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
      </KeyboardAwareScrollView>
      <Toast />
    </Modal>
  );
};

export default Authentication;

const styles = StyleSheet.create({
  modalView: {
    marginTop: '50%',
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
