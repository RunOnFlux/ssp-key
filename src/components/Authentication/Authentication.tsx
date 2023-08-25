import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import EncryptedStorage from 'react-native-encrypted-storage';
import { useTheme } from '../../hooks';

const rnBiometrics = new ReactNativeBiometrics();

const Authentication = (props: { actionStatus: (status: boolean) => void }) => {
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Common, Colors } = useTheme();
  const [password, setPassword] = useState('');
  const [passwordVisibility, setPasswordVisibility] = useState(false);

  rnBiometrics.isSensorAvailable().then((resultObject) => {
    const { available, biometryType } = resultObject;

    if (available && biometryType === BiometryTypes.TouchID) {
      console.log('TouchID is supported');
    } else if (available && biometryType === BiometryTypes.FaceID) {
      console.log('FaceID is supported');
    } else if (available && biometryType === BiometryTypes.Biometrics) {
      console.log('Biometrics is supported');
    } else {
      // here we show fallback mechanism if none of the above succeed
      console.log('Biometrics not supported');
    }
  });

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
      <ScrollView
        style={[styles.modalView]}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
          Layout.fullWidth,
          Layout.fill,
        ]}
      >
        <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
          {t('home:confirm_password_pin')}
        </Text>
        <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
          You are about to access sensitive information.
        </Text>
        <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
          Grant access with psasword.
        </Text>
        <View style={styles.passwordSection}>
          <TextInput
            style={styles.input}
            autoComplete="new-password"
            inputMode="email"
            textContentType="password"
            autoCapitalize="none"
            placeholder="Set Key Password PIN"
            secureTextEntry={passwordVisibility ? false : true}
            onChangeText={onChangePassword}
            value={password}
            autoCorrect={false}
          />
          <TouchableOpacity
            onPress={() => setPasswordVisibility(!passwordVisibility)}
            style={styles.eyeIcon}
          >
            <Icon
              name={passwordVisibility ? 'eye' : 'eye-off'}
              size={20}
              color={Colors.bluePrimary}
            />
          </TouchableOpacity>
        </View>
        <View>
          <TouchableOpacity
            style={[
              Common.button.rounded,
              Common.button.bluePrimary,
              Layout.fullWidth,
              Gutters.regularTMargin,
              Gutters.smallBMargin,
            ]}
            onPress={() => grantAccess()}
          >
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textWhite,
                Gutters.regularHPadding,
              ]}
            >
              {t('home:grant_access')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => close()}>
            <Text
              style={[Fonts.textSmall, Fonts.textBluePrimary, Fonts.textCenter]}
            >
              {t('common:cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <Toast />
    </Modal>
  );
};

export default Authentication;

const styles = StyleSheet.create({
  modalView: {
    backgroundColor: 'white',
    marginTop: 60,
    borderRadius: 20,
    padding: 20,
    marginLeft: 30,
    marginRight: 30,
    left: 0,
    right: 0,
    textAlign: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    height: 400,
    position: 'absolute',
    bottom: 30,
  },
  eyeIcon: {
    padding: 12,
  },
  passwordSection: {
    marginTop: 30,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    borderRadius: 10,
    backgroundColor: '#f6f6f6',
  },
  input: {
    flex: 1,
    padding: 12,
    color: '#424242',
    width: '100%',
  },
});
