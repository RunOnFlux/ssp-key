import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  TextInput,
  StyleSheet,
  Modal,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Icon from 'react-native-vector-icons/Feather';
import Toast from 'react-native-toast-message';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
const CryptoJS = require('crypto-js');

import {
  generateMnemonic,
  getMasterXpriv,
  getMasterXpub,
} from '../../lib/wallet';

import { setSeedPhrase, setSeedPhraseInitialState } from '../../store/ssp';
import { setXpubKey, setXprivKey } from '../../store/flux';

import { useAppDispatch } from '../../hooks';

import Divider from '../../components/Divider/Divider';

type Props = {
  navigation: any;
};

function Create({ navigation }: Props) {
  // focusability of inputs
  const passwordInputA = useRef<TextInput | null>(null);
  const passwordInputB = useRef<TextInput | null>(null);
  const dispatch = useAppDispatch();
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisibility, setPasswordVisibility] = useState(true);
  const [rightIcon, setRightIcon] = useState('eye-off');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordVisibilityConfirm, setPasswordVisibilityConfirm] =
    useState(true);
  const [rightIconConfirm, setRightIconConfirm] = useState('eye-off');
  const [mnemonicShow, setMnemonicShow] = useState(false);
  const [WSPbackedUp, setWSPbackedUp] = useState(false);
  const [wspWasShown, setWSPwasShown] = useState(false);
  const { t } = useTranslation(['cr', 'common']);
  const { Common, Fonts, Gutters, Layout, Images, Colors } = useTheme();

  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  const generateMnemonicPhrase = (entValue: 128 | 256) => {
    const generatedMnemonic = generateMnemonic(entValue);
    setMnemonic(generatedMnemonic);
  };

  const onChangePassword = (text: string) => {
    setPassword(text);
  };

  const onChangePasswordConfirm = (text: string) => {
    setPasswordConfirm(text);
  };

  const handlePasswordVisibility = () => {
    if (rightIcon === 'eye') {
      setRightIcon('eye-off');
      setPasswordVisibility(!passwordVisibility);
    } else if (rightIcon === 'eye-off') {
      setRightIcon('eye');
      setPasswordVisibility(!passwordVisibility);
    }
  };

  const handlePasswordVisibilityConfirm = () => {
    if (rightIconConfirm === 'eye') {
      setRightIconConfirm('eye-off');
      setPasswordVisibilityConfirm(!passwordVisibilityConfirm);
    } else if (rightIconConfirm === 'eye-off') {
      setRightIconConfirm('eye');
      setPasswordVisibilityConfirm(!passwordVisibilityConfirm);
    }
  };

  const setupKey = () => {
    if (password !== passwordConfirm) {
      displayMessage('error', 'PINs do not match :(');
    } else if (password.length < 4) {
      displayMessage('error', 'PIN must be at least 4 characters');
    } else {
      generateMnemonicPhrase(256);
    }
  };

  const showModal = () => {
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (mnemonic) {
      showModal();
    }
  }, [mnemonic]);

  const onChangeWSP = () => {
    setWSPbackedUp(!WSPbackedUp);
  };

  const handleOk = () => {
    if (WSPbackedUp && wspWasShown) {
      storeMnemonic(mnemonic);
    } else {
      displayMessage(
        'info',
        'You must backup your key seed phrase before you can synchronise a key.',
      );
    }
  };

  const handleCancel = () => {
    setIsModalOpen(false);
    setMnemonic('');
    setPassword('');
    setPasswordConfirm('');
    setWSPwasShown(false);
    setWSPbackedUp(false);
    setMnemonicShow(false);
  };

  const storeMnemonic = (mnemonicPhrase: string) => {
    if (!mnemonicPhrase) {
      displayMessage('error', 'Key seed phrase is invalid.');
      return;
    }

    setIsLoading(true);

    getUniqueId()
      .then(async (id) => {
        const pwForEncryption = id + password;
        const mnemonicBlob = CryptoJS.AES.encrypt(
          mnemonicPhrase,
          pwForEncryption,
        ).toString();
        // store in redux persist
        dispatch(setSeedPhrase(mnemonicBlob));
        // generate master xpriv for flux
        const xpriv = getMasterXpriv(mnemonicPhrase, 48, 19167, 0, 'p2sh'); // takes ~3 secs
        const xpub = getMasterXpub(mnemonicPhrase, 48, 19167, 0, 'p2sh'); // takes ~3 secs
        const xprivBlob = CryptoJS.AES.encrypt(
          xpriv,
          pwForEncryption,
        ).toString();
        const xpubBlob = CryptoJS.AES.encrypt(xpub, pwForEncryption).toString();
        dispatch(setXprivKey(xprivBlob));
        dispatch(setXpubKey(xpubBlob));
        // In keychain plain password is stored (only password not id)
        await EncryptedStorage.setItem('ssp_key_pw', password);
        setIsModalOpen(false);
        setIsLoading(false);
        setMnemonic('');
        setPassword('');
        setPasswordConfirm('');
        navigation.navigate('Home');
      })
      .catch((error) => {
        setIsLoading(false);
        dispatch(setSeedPhraseInitialState());
        displayMessage(
          'error',
          'Code C1: Something went wrong while setting up your Key.',
        );
        console.log(error);
      });
  };

  return (
    <KeyboardAwareScrollView
      style={Layout.fill}
      contentContainerStyle={[
        Layout.fullSize,
        Layout.fill,
        Layout.colCenter,
        Layout.scrollSpaceBetween,
      ]}
    >
      <View
        style={[Layout.fullWidth, Gutters.smallTMargin, Gutters.smallHPadding]}
      >
        <TouchableOpacity
          onPressIn={() => navigation.navigate('Welcome')}
          style={[Layout.row]}
        >
          <Icon name="chevron-left" size={20} color={Colors.bluePrimary} />
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
              Gutters.tinyLPadding,
            ]}
          >
            {t('common:back')}
          </Text>
        </TouchableOpacity>
      </View>
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
          Gutters.regularBMargin,
        ]}
      >
        <Image
          style={{ width: 80, height: 160 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <Text style={[Fonts.titleSmall, Gutters.tinyBMargin]}>
          {t('cr:secure_key')}
        </Text>
        <View style={styles.passwordSection}>
          <TextInput
            style={styles.input}
            autoComplete="new-password"
            textContentType="password"
            autoCapitalize="none"
            placeholder="Set Key Password PIN"
            secureTextEntry={passwordVisibility ? true : false}
            onChangeText={onChangePassword}
            value={password}
            autoCorrect={false}
            ref={passwordInputA}
            onPressIn={() => passwordInputA.current?.focus()}
          />
          <TouchableOpacity
            onPressIn={handlePasswordVisibility}
            style={styles.eyeIcon}
          >
            <Icon name={rightIcon} size={20} color={Colors.bluePrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.passwordSection}>
          <TextInput
            style={styles.input}
            autoComplete="new-password"
            textContentType="password"
            autoCapitalize="none"
            placeholder="Confirm Key Password PIN"
            secureTextEntry={passwordVisibilityConfirm ? true : false}
            onChangeText={onChangePasswordConfirm}
            value={passwordConfirm}
            autoCorrect={false}
            ref={passwordInputB}
            onPressIn={() => passwordInputB.current?.focus()}
          />
          <TouchableOpacity
            onPressIn={handlePasswordVisibilityConfirm}
            style={styles.eyeIcon}
          >
            <Icon
              name={rightIconConfirm}
              size={20}
              color={Colors.bluePrimary}
            />
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
            Gutters.smallTMargin,
          ]}
          onPressIn={() => setupKey()}
        >
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            {t('cr:setup_key')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPressIn={() => navigation.navigate('Restore')}>
          <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
            {t('cr:restore_key')}
          </Text>
        </TouchableOpacity>
      </View>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isModalOpen}
        onRequestClose={() => handleCancel()}
      >
        <ScrollView
          style={[Layout.fill, styles.modalView]}
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
          ]}
        >
          <Text
            style={[Fonts.titleSmall, Gutters.smallBMargin, Fonts.textCenter]}
          >
            {t('cr:key_backup')}
          </Text>
          <Text
            style={[Fonts.textSmall, Gutters.tinyBMargin, Fonts.textCenter]}
          >
            {t('cr:key_backup_text_1')}
          </Text>
          <Text
            style={[Fonts.textSmall, Gutters.tinyBMargin, Fonts.textCenter]}
          >
            {t('cr:key_backup_text_2')}
          </Text>
          <Text
            style={[Fonts.textSmall, Gutters.smallBMargin, Fonts.textCenter]}
          >
            {t('cr:key_backup_text_3')}
          </Text>
          <Divider color={Colors.textGray200} />
          <Text
            style={[
              Fonts.textItalic,
              Fonts.textBold,
              Fonts.textSmall,
              Fonts.textCenter,
              Gutters.tinyBMargin,
            ]}
            selectable={true}
          >
            {mnemonicShow
              ? mnemonic
              : '*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***'}
          </Text>
          <View style={[Gutters.tinyBMargin]}>
            <TouchableOpacity
              style={[
                Common.button.outlineRounded,
                Common.button.dashed,
                Common.button.secondaryButton,
              ]}
              onPressIn={() => {
                setMnemonicShow(!mnemonicShow);
                setWSPwasShown(true);
              }}
            >
              <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
                {mnemonicShow ? t('cr:hide_mnemonic') : t('cr:show_mnemonic')}{' '}
                {t('common:key_seed_phrase')}
              </Text>
            </TouchableOpacity>
          </View>
          <Divider color={Colors.textGray200} />
          <View style={[Layout.row, Gutters.smallTMargin]}>
            <Switch
              onValueChange={onChangeWSP}
              value={WSPbackedUp}
              style={styles.toggleStyle}
            />
            <Text style={[Gutters.largeRPadding, Gutters.tinyBMargin]}>
              {t('cr:seed_phrase_backed_up')}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              Common.button.rounded,
              Common.button.bluePrimary,
              Gutters.regularBMargin,
              Gutters.smallTMargin,
            ]}
            disabled={isLoading}
            onPressIn={() => handleOk()}
          >
            {isLoading && (
              <ActivityIndicator
                size={'large'}
                style={[Gutters.largeVMargin]}
              />
            )}
            {!isLoading && (
              <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                {t('cr:setup_key')}
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            disabled={isLoading}
            onPressIn={() => handleCancel()}
          >
            <Text
              style={[Fonts.textSmall, Fonts.textBluePrimary, Fonts.textCenter]}
            >
              {t('common:cancel')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
        <Toast />
      </Modal>
      {!isModalOpen && <Toast />}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    padding: 12,
    backgroundColor: '#fff',
    color: '#424242',
    borderRadius: 10,
    zIndex: 19,
  },
  passwordSection: {
    width: '80%',
    height: 50,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginTop: 16,
    zIndex: 19,
  },
  eyeIcon: {
    padding: 12,
  },
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
  toggleStyle: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },
});

export default Create;
