import React, { useState, useRef } from 'react';
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

import { getMasterXpriv, getMasterXpub } from '../../lib/wallet';

import { setSeedPhrase, setSeedPhraseInitialState } from '../../store/ssp';
import { setXpubKey, setXprivKey, setFluxInitialState } from '../../store/flux';

import { useAppSelector, useAppDispatch } from '../../hooks';

import Divider from '../../components/Divider/Divider';
import Scanner from 'ssp-key/src/components/Scanner/Scanner';

type Props = {
  navigation: any;
};

function Restore({ navigation }: Props) {
  // focusability of inputs
  const seedInput = useRef<TextInput | null>(null);
  const passwordInputA = useRef<TextInput | null>(null);
  const passwordInputB = useRef<TextInput | null>(null);
  const dispatch = useAppDispatch();
  const { seedPhrase } = useAppSelector((state) => state.ssp);
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
  const { t } = useTranslation(['cr', 'common', 'home']);
  const { Common, Fonts, Gutters, Layout, Images, Colors } = useTheme();
  const [showScanner, setShowScanner] = useState(false);

  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
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

  const setupImportKey = () => {
    const newSeedPhrase = mnemonic.trim();
    if (!newSeedPhrase) {
      displayMessage('error', 'Please enter your Key seed phrase');
      return;
    }
    const splittedSeed = newSeedPhrase.split(' ');
    if (splittedSeed.length < 12) {
      displayMessage(
        'error',
        'Key Seed Phrase is invalid. Key Seed Phrase consists of at least 12 words.',
      );
      return;
    }
    if (password !== passwordConfirm) {
      displayMessage('error', 'PINs do not match :(');
    } else if (password.length < 4) {
      displayMessage('error', 'PIN must be at least 4 characters');
    } else {
      setMnemonic(newSeedPhrase);
      showModal();
    }
  };

  const showModal = () => {
    setIsModalOpen(true);
  };

  const onChangeMnemonic = (text: string) => {
    setMnemonic(text);
  };

  const onChangeWSP = () => {
    setWSPbackedUp(!WSPbackedUp);
  };

  const handleOk = () => {
    if (WSPbackedUp && wspWasShown) {
      storeMnemonic(mnemonic.trim());
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
    // first clean up data
    dispatch(setSeedPhraseInitialState());
    dispatch(setFluxInitialState());
    setIsLoading(true);

    getUniqueId()
      .then(async (id) => {
        // clean up password from encrypted storage
        await EncryptedStorage.clear();
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
          error.message ||
            'Code C1: Something went wrong while setting up your Key.',
        );
        console.log(error.message);
      });
  };

  const navigateBack = () => {
    if (seedPhrase) {
      navigation.navigate('Home');
    } else {
      navigation.navigate('Welcome');
    }
  };

  return (
    <KeyboardAwareScrollView
      extraScrollHeight={20}
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
          Layout.row,
          Layout.justifyContentBetween,
          Layout.fullWidth,
          Gutters.smallTMargin,
          Gutters.smallHPadding,
        ]}
      >
        <TouchableOpacity onPressIn={() => navigateBack()} style={[Layout.row]}>
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
        ]}
      >
        <Image
          style={{ width: 80, height: 160 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <Text style={[Fonts.titleSmall, Gutters.tinyBMargin]}>
          {t('cr:import_key_phrase')}
        </Text>
        <View style={styles.seedPhraseArea}>
          <TextInput
            multiline={true}
            numberOfLines={4}
            style={styles.inputArea}
            autoCapitalize="none"
            placeholder="Input your Mnemonic Key Seed Phrase"
            secureTextEntry={false}
            onChangeText={onChangeMnemonic}
            value={mnemonic}
            autoCorrect={false}
            ref={seedInput}
            onPressIn={() => seedInput.current?.focus()}
          />
        </View>
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
            Gutters.smallTMargin,
          ]}
          onPressIn={() => setupImportKey()}
        >
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>Import Key</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
            Gutters.smallTMargin,
          ]}
          onPressIn={() => setShowScanner(true)}
        >
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>{t('home:scan_code')}</Text>
        </TouchableOpacity>
      </View>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isModalOpen}
        onRequestClose={() => handleCancel()}
      >
        <ScrollView
          style={[Layout.fill, styles.modalBackdrop]}
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
            styles.modalView,
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
          <View style={[Layout.justifyContentEnd]}>
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
        </ScrollView>
        <Toast />
      </Modal>
      {!isModalOpen && <Toast />}
      <Scanner visible={showScanner} onRead={console.log} onClose={()=>setShowScanner(false)}/>
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
  },
  inputArea: {
    flex: 1,
    padding: 12,
    backgroundColor: '#fff',
    color: '#424242',
    borderRadius: 10,
    marginTop: 16,
  },
  seedPhraseArea: {
    width: '80%',
    height: 100,
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
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  toggleStyle: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },
});

export default Restore;
