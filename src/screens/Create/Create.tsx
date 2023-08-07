import React, { useState, useEffect } from 'react';
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
} from 'react-native';
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

import { setSeedPhrase } from '../../store/ssp';
import { setXpubKey, setXprivKey } from '../../store/flux';

import { useAppSelector, useAppDispatch } from '../../hooks';

import Divider from '../../components/Divider/Divider';

type Props = {
  navigation: any;
};

function Welcome({ navigation }: Props) {
  const dispatch = useAppDispatch();
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
  const { t } = useTranslation(['create', 'common']);
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

  const { seedPhrase } = useAppSelector((state) => state.ssp);
  // if seedPhrse exist, navigate to Home page

  if (seedPhrase) {
    // todo navigate to home page
  }
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
    } else if (!seedPhrase) {
      // todo change negation of condition
      displayMessage('error', 'Unexpected error C1. Contact support'); // this should not occur otherwise we would be in home screen already
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
      setIsModalOpen(false);
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
  };

  const storeMnemonic = (mnemonicPhrase: string) => {
    if (!mnemonicPhrase) {
      displayMessage('error', 'Key seed phrase is invalid.');
      return;
    }

    getUniqueId()
      .then(async (id) => {
        const pwForEncryption = id + password;
        const mnemonicBlob = CryptoJS.AES.encrypt(
          mnemonicPhrase,
          pwForEncryption,
        ).toString();
        console.log(mnemonicBlob);
        const mmm = CryptoJS.AES.decrypt(mnemonicBlob, pwForEncryption);
        console.log(mmm.toString(CryptoJS.enc.Utf8));
        // store in redux persist
        dispatch(setSeedPhrase(mnemonicBlob));
        // generate master xpriv for flux
        console.log(new Date().getTime());
        const xpriv = getMasterXpriv(mnemonicPhrase, 48, 19167, 0, 'p2sh'); // takes ~3 secs
        console.log(new Date().getTime());
        const xpub = getMasterXpub(mnemonicPhrase, 48, 19167, 0, 'p2sh'); // takes ~3 secs
        console.log(new Date().getTime());
        const xprivBlob = CryptoJS.AES.encrypt(
          xpriv,
          pwForEncryption,
        ).toString();
        const xpubBlob = CryptoJS.AES.encrypt(xpub, pwForEncryption).toString();
        const fingerprint: string = await getUniqueId();
        console.log(fingerprint);
        dispatch(setSeedPhrase(mnemonicBlob));
        dispatch(setXprivKey(xprivBlob));
        dispatch(setXpubKey(xpubBlob));
        // In keychain plain password is stored (only password not id)
        await EncryptedStorage.setItem('ssp_key_pw', password);
        // navigate('/home');
      })
      .catch((error) => {
        displayMessage(
          'error',
          'Code C1: Something went wrong while setting up your Key.',
        );
        console.log(error);
      });
  };

  return (
    <ScrollView
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
        <TouchableOpacity
          onPress={() => navigation.navigate('Welcome')}
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
        ]}
      >
        <Image
          style={{ width: 80, height: 160 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <Text style={[Fonts.titleSmall, Gutters.tinyBMargin]}>
          {t('create:secure_key')}
        </Text>
        <View style={styles.passwordSection}>
          <TextInput
            style={styles.input}
            autoComplete="new-password"
            inputMode="email"
            textContentType="password"
            autoCapitalize="none"
            placeholder="Set Key Password PIN"
            secureTextEntry={passwordVisibility ? true : false}
            onChangeText={onChangePassword}
            value={password}
            autoCorrect={false}
          />
          <TouchableOpacity
            onPress={handlePasswordVisibility}
            style={styles.eyeIcon}
          >
            <Icon name={rightIcon} size={20} color={Colors.bluePrimary} />
          </TouchableOpacity>
        </View>
        <View style={styles.passwordSection}>
          <TextInput
            style={styles.input}
            autoComplete="new-password"
            inputMode="email"
            textContentType="password"
            autoCapitalize="none"
            placeholder="Confirm Key Password PIN"
            secureTextEntry={passwordVisibilityConfirm ? true : false}
            onChangeText={onChangePasswordConfirm}
            value={passwordConfirm}
            autoCorrect={false}
          />
          <TouchableOpacity
            onPress={handlePasswordVisibilityConfirm}
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
          onPress={() => setupKey()}
        >
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            {t('create:setup_key')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Restore')}>
          <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
            {t('create:restore_key')}
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
          contentContainerStyle={[Gutters.smallBPadding]}
        >
          <Text
            style={[Fonts.titleSmall, Gutters.smallBMargin, Fonts.textCenter]}
          >
            Key Backup
          </Text>
          <Text
            style={[Fonts.textSmall, Gutters.tinyBMargin, Fonts.textCenter]}
          >
            Wallet seed is used to generate all addresses. Anyone with the
            access to the wallet seed has partial control over the wallet.
          </Text>
          <Text
            style={[Fonts.textSmall, Gutters.tinyBMargin, Fonts.textCenter]}
          >
            Keep your wallet seed backup safe and secure
          </Text>
          <Text
            style={[Fonts.textSmall, Gutters.smallBMargin, Fonts.textCenter]}
          >
            Loosing the wallet seed will result in the loss of access to your
            wallet.
          </Text>
          <Divider color={'#C0C0C0'} />
          <Text
            style={[
              Fonts.textItalic,
              Fonts.textBold,
              Fonts.textSmall,
              Fonts.textCenter,
              Gutters.tinyBMargin,
            ]}
          >
            {mnemonicShow
              ? mnemonic
              : '*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***'}
          </Text>
          <View style={[Gutters.tinyBMargin]}>
            <TouchableOpacity
              style={[
                Common.button.outlineRounded,
                Common.button.secondaryButton,
              ]}
              onPress={() => {
                setMnemonicShow(!mnemonicShow);
                setWSPwasShown(true);
              }}
            >
              <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
                {mnemonicShow ? 'Hide Mnemonic' : 'Show Mnemonic'} Key Seed
                Phrase
              </Text>
            </TouchableOpacity>
          </View>
          <Divider color={'#C0C0C0'} />
          <View style={[Layout.row, Gutters.smallTMargin]}>
            <Switch
              onValueChange={onChangeWSP}
              value={WSPbackedUp}
              style={styles.toggleStyle}
            />
            <Text style={[Gutters.largeRPadding, Gutters.tinyBMargin]}>
              I have backed up my key seed phrase in a secure location.
            </Text>
          </View>
          <TouchableOpacity
            style={[
              Common.button.rounded,
              Common.button.bluePrimary,
              Gutters.regularBMargin,
              Gutters.smallTMargin,
            ]}
            onPress={() => handleOk()}
          >
            <Text style={[Fonts.textRegular, Fonts.textWhite]}>
              {t('create:setup_key')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleCancel()}>
            <Text
              style={[Fonts.textSmall, Fonts.textBluePrimary, Fonts.textCenter]}
            >
              Cancel
            </Text>
          </TouchableOpacity>
        </ScrollView>
        <Toast />
      </Modal>
      {!isModalOpen && <Toast />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    padding: 12,
    backgroundColor: '#fff',
    color: '#424242',
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
    marginTop: 50,
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

export default Welcome;