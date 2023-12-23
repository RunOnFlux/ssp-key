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
import { useKeyboardVisible } from '../../hooks/keyboardVisible';
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import { blockchains } from '@storage/blockchains';

const CryptoJS = require('crypto-js');

import {
  getMasterXpriv,
  getMasterXpub,
  validateMnemonic,
} from '../../lib/wallet';

import { setSeedPhrase, setSSPInitialState } from '../../store/ssp';
import { setXpubKeyIdentity, setXprivKeyIdentity } from '../../store';

import { setInitialStateForAllChains } from '../../store';

import { useAppSelector, useAppDispatch } from '../../hooks';

import Divider from '../../components/Divider/Divider';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux';
import CreationSteps from 'ssp-key/src/components/CreationSteps/CreationSteps';
// import Headerbar from 'ssp-key/src/components/Headerbar/Headerbar';

type Props = {
  navigation: any;
};

function Restore({ navigation }: Props) {
  // focusability of inputs
  const seedInput = useRef<TextInput | null>(null);
  const passwordInputA = useRef<TextInput | null>(null);
  const passwordInputB = useRef<TextInput | null>(null);
  const dispatch = useAppDispatch();
  const { seedPhrase, identityChain } = useAppSelector((state) => state.ssp);
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
  const { darkMode, Common, Fonts, Gutters, Layout, Images, Colors } =
    useTheme();
  const blockchainConfig = blockchains[identityChain];
  const keyboardVisible = useKeyboardVisible();

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
      displayMessage('error', t('cr:err_enter_seed'));
      return;
    }
    const splittedSeed = newSeedPhrase.split(' ');
    if (splittedSeed.length < 12) {
      displayMessage('error', t('cr:err_invalid_seed'));
      return;
    }
    const isValid = validateMnemonic(newSeedPhrase);
    if (!isValid) {
      displayMessage('error', t('cr:err_invalid_seed'));
      return;
    }
    if (password !== passwordConfirm) {
      displayMessage('error', t('cr:err_pins_no_match'));
    } else if (password.length < 4) {
      displayMessage('error', t('cr:err_pins_min_length'));
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
      displayMessage('info', t('cr:backup_needed'));
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
      displayMessage('error', t('cr:seed_phrase_invalid'));
      return;
    }
    // first clean up data
    dispatch(setSSPInitialState());
    setInitialStateForAllChains();
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
        // generate master xpriv for btc
        const xpriv = getMasterXpriv(
          mnemonicPhrase,
          48,
          blockchainConfig.slip,
          0,
          blockchainConfig.scriptType,
          identityChain,
        ); // takes ~3 secs
        const xpub = getMasterXpub(
          mnemonicPhrase,
          48,
          blockchainConfig.slip,
          0,
          blockchainConfig.scriptType,
          identityChain,
        ); // takes ~3 secs
        const xprivBlob = CryptoJS.AES.encrypt(
          xpriv,
          pwForEncryption,
        ).toString();
        const xpubBlob = CryptoJS.AES.encrypt(xpub, pwForEncryption).toString();
        setXprivKeyIdentity(xprivBlob);
        setXpubKeyIdentity(xpubBlob);
        // In keychain plain password is stored (only password not id)
        await EncryptedStorage.setItem('ssp_key_pw', password);
        setIsModalOpen(false);
        setIsLoading(false);
        setMnemonic('');
        setPassword('');
        setPasswordConfirm('');
        setWSPwasShown(false);
        setWSPbackedUp(false);
        setMnemonicShow(false);
        navigation.navigate('Home');
      })
      .catch((error) => {
        setIsLoading(false);
        dispatch(setSSPInitialState());
        displayMessage('error', error.message || t('cr:err_setting_key'));
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
    <View style={[Layout.fullSize, Layout.fill, Layout.scrollSpaceBetween]}>
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
      {/* <Headerbar
        headerText={t('cr:import_key_phrase')}
        backNavigation={seedPhrase ? 'Home' : 'Welcome'}
        navigation={navigation}
      />
      <Divider color={Colors.textGray200} /> */}
      <View
        style={[
          Gutters.smallTMargin,
          Gutters.regularBMargin,
          Gutters.regularHMargin,
        ]}
      >
        <CreationSteps step={1} isImport={true} />
      </View>
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="always"
        extraScrollHeight={20}
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
            style={{ width: 80, height: 160 }}
            source={darkMode ? Images.ssp.logoWhite : Images.ssp.logoBlack}
            resizeMode={'contain'}
          />
          <Text style={[Fonts.titleSmall, Gutters.tinyBMargin]}>
            {t('cr:import_key_phrase')}
          </Text>
          <View style={styles.seedPhraseArea}>
            <TextInput
              multiline={true}
              numberOfLines={4}
              style={[Common.inputArea, Common.inputAreaColors]}
              autoCapitalize="none"
              placeholder={t('cr:input_mnemonic')}
              placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
              secureTextEntry={false}
              onChangeText={onChangeMnemonic}
              value={mnemonic}
              autoCorrect={false}
              ref={seedInput}
              onPressIn={() => seedInput.current?.focus()}
            />
          </View>
          <View
            style={[
              Layout.rowCenter,
              Common.inputWithButtonBgColors,
              styles.inputWithButton,
            ]}
          >
            <TextInput
              style={[Common.textInput]}
              autoComplete="new-password"
              textContentType="password"
              autoCapitalize="none"
              placeholder={t('cr:set_key_pin')}
              placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
              secureTextEntry={passwordVisibility ? true : false}
              onChangeText={onChangePassword}
              value={password}
              autoCorrect={false}
              ref={passwordInputA}
              onPressIn={() => passwordInputA.current?.focus()}
            />
            <TouchableOpacity
              onPressIn={handlePasswordVisibility}
              style={Common.inputIcon}
            >
              <Icon name={rightIcon} size={20} color={Colors.bluePrimary} />
            </TouchableOpacity>
          </View>
          <View
            style={[
              Layout.rowCenter,
              Common.inputWithButtonBgColors,
              styles.inputWithButton,
            ]}
          >
            <TextInput
              style={[Common.textInput]}
              autoComplete="new-password"
              textContentType="password"
              autoCapitalize="none"
              placeholder={t('cr:confirm_key_pin')}
              placeholderTextColor={darkMode ? '#777' : '#c7c7c7'}
              secureTextEntry={passwordVisibilityConfirm ? true : false}
              onChangeText={onChangePasswordConfirm}
              value={passwordConfirm}
              autoCorrect={false}
              ref={passwordInputB}
              onPressIn={() => passwordInputB.current?.focus()}
            />
            <TouchableOpacity
              onPressIn={handlePasswordVisibilityConfirm}
              style={Common.inputIcon}
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
            onPressIn={() => setupImportKey()}
          >
            <Text style={[Fonts.textRegular, Fonts.textWhite]}>
              {t('cr:import_key')}
            </Text>
          </TouchableOpacity>
          {/* <TouchableOpacity
          style={[Gutters.largeBMargin]}
          onPressIn={() => navigateBack()}
        >
          <Text
            style={[Fonts.textSmall, Fonts.textBluePrimary, Fonts.textCenter]}
          >
            {t('common:cancel')}
          </Text>
        </TouchableOpacity> */}
        </View>
      </KeyboardAwareScrollView>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isModalOpen}
        onRequestClose={() => handleCancel()}
      >
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={[Layout.fill, Common.modalBackdrop]}
          contentInset={{ bottom: 80 }}
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
          ]}
        >
          <View style={[Layout.fill, Common.modalView]}>
            <Text
              style={[Fonts.titleSmall, Gutters.smallBMargin, Fonts.textCenter]}
            >
              {t('cr:key_backup')}
            </Text>
            <View style={[Gutters.smallBMargin]}>
              <CreationSteps step={2} isImport={true} />
            </View>
            <View
              style={[
                Layout.fill,
                Layout.relative,
                Layout.fullWidth,
                Layout.alignItemsCenter,
                Gutters.regularTMargin,
              ]}
            >
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
                style={[
                  Fonts.textSmall,
                  Gutters.smallBMargin,
                  Fonts.textCenter,
                ]}
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
                  onPress={() => {
                    setMnemonicShow(!mnemonicShow);
                    setWSPwasShown(true);
                  }}
                >
                  <Text
                    style={[
                      Fonts.textSmall,
                      Fonts.textBluePrimary,
                      Gutters.smallHPadding,
                    ]}
                  >
                    {mnemonicShow
                      ? t('cr:hide_mnemonic')
                      : t('cr:show_mnemonic')}{' '}
                    {t('common:key_seed_phrase')}
                  </Text>
                </TouchableOpacity>
              </View>
              <Divider color={Colors.textGray200} />
              <View
                style={[
                  Layout.row,
                  Gutters.smallTMargin,
                  Gutters.smallLPadding,
                ]}
              >
                <Switch
                  onValueChange={onChangeWSP}
                  value={WSPbackedUp}
                  style={styles.toggleStyle}
                />
                <Text
                  style={[
                    Gutters.largeRPadding,
                    Gutters.tinyBMargin,
                    Fonts.textTiny,
                  ]}
                >
                  {t('cr:seed_phrase_backed_up')}
                </Text>
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
                disabled={isLoading}
                onPress={() => handleOk()}
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
                onPress={() => handleCancel()}
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
          </View>
        </ScrollView>
        <Toast />
      </Modal>
      {!keyboardVisible && <PoweredByFlux />}
    </View>
  );
}

const styles = StyleSheet.create({
  seedPhraseArea: {
    width: '80%',
    height: 100,
  },
  inputWithButton: {
    width: '80%',
    height: 50,
    borderRadius: 10,
    marginTop: 16,
  },
  toggleStyle: {
    transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
  },
});

export default Restore;
