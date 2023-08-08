import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Image,
  Modal,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Icon from 'react-native-vector-icons/Feather';
import IconB from 'react-native-vector-icons/MaterialCommunityIcons';
import Divider from '../../components/Divider/Divider';
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import axios from 'axios';

const CryptoJS = require('crypto-js');

import {
  getMasterXpriv,
  getMasterXpub,
  generateMultisigAddress,
  generateIdentityAddress,
} from '../../lib/wallet';

import {
  setXpubKey,
  setXprivKey,
  setXpubWallet,
  setRedeemScript,
  setAddress,
  setSspWalletKeyIdentity,
  setsspWalletIdentity,
} from '../../store/flux';

import { useAppSelector, useAppDispatch } from '../../hooks';

type Props = {
  navigation: any;
};

function Home({ navigation }: Props) {
  const dispatch = useAppDispatch();
  const { t } = useTranslation(['welcome', 'common']);
  const { Fonts, Gutters, Layout, Images, Colors, Common } = useTheme();
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);

  const { seedPhrase } = useAppSelector((state) => state.ssp);
  const {
    address,
    redeemScript,
    xpubWallet,
    xpubKey,
    xprivKey,
    sspWalletKeyIdentity,
    sspWalletIdentity,
  } = useAppSelector((state) => state.flux);
  console.log('seedPhrase', seedPhrase);
  // if seedPhrse does not exist, navigate to Welcome page
  if (!seedPhrase) {
    navigation.navigate('Welcome');
    return <></>;
  }

  if (!xpubKey || !xprivKey) {
    // just a precaution to make sure xpub and xpriv are set. Should acutally never end up here
    getUniqueId()
      .then(async (id) => {
        // clean up password from encrypted storage
        const password = await EncryptedStorage.getItem('ssp_key_pw');
        const pwForEncryption = id + password;
        const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
        const mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);
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
      })
      .catch((error) => {
        console.log(error.message);
      });
  }

  if (
    !address ||
    !redeemScript ||
    !xpubWallet ||
    !sspWalletKeyIdentity ||
    !sspWalletIdentity
  ) {
    console.log('Request for scanning QR code');
  }

  const generateAddresses = (suppliedXpubWallet: string) => {
    getUniqueId()
      .then(async (id) => {
        // clean up password from encrypted storage
        const password = await EncryptedStorage.getItem('ssp_key_pw');
        const pwForEncryption = id + password;
        const xpk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
        const xpubKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
        const addrInfo = generateMultisigAddress(
          suppliedXpubWallet,
          xpubKeyDecrypted,
          0,
          0,
          'flux',
        );
        console.log(addrInfo.address, addrInfo.redeemScript);
        dispatch(setAddress(addrInfo.address));
        const encryptedReedemScript = CryptoJS.AES.encrypt(
          addrInfo.redeemScript,
          pwForEncryption,
        ).toString();
        dispatch(setRedeemScript(encryptedReedemScript));
        const encryptedXpubWallet = CryptoJS.AES.encrypt(
          suppliedXpubWallet,
          pwForEncryption,
        ).toString();
        dispatch(setXpubWallet(encryptedXpubWallet));
        const generatedSspWalletKeyIdentity = generateMultisigAddress(
          suppliedXpubWallet,
          xpubKeyDecrypted,
          10,
          0,
          'flux',
        );
        dispatch(
          setSspWalletKeyIdentity(generatedSspWalletKeyIdentity.address),
        );
        // generate ssp wallet identity
        const generatedSspWalletIdentity = generateIdentityAddress(
          suppliedXpubWallet,
          'flux',
        );
        dispatch(setsspWalletIdentity(generatedSspWalletIdentity));
        console.log('TODO ALL DONE');
      })
      .catch((error) => {
        console.log(error.message);
      });
  };

  const manualInput = () => {
    // open input dialog. we recognise 2 strings. one with starting xpub being xpub of wallet and second starting 04 being transaction for signign
    console.log('manual');
  };
  const openHelp = () => {
    console.log('help');
  };
  const openSettings = () => {
    setIsMenuModalOpen(!isMenuModalOpen);
  };
  const scanCode = () => {
    console.log('scan code');
  };
  const handleRefresh = async () => {
    try {
      console.log('refresh');
      if (sspWalletIdentity) {
        // get some pending request
        const result = await axios.get(
          `https://relay.ssp.runonflux.io/v1/get/${sspWalletIdentity}`,
        );
        console.log('result', result.data);
      } else if (sspWalletKeyIdentity) {
        // get some pending request
        const result = await axios.get(
          `https://relay.ssp.runonflux.io/v1/get/${sspWalletKeyIdentity}`,
        );
        console.log('result', result.data);
      } else {
        console.log('no wallet synced yet');
      }
    } catch (error) {
      console.log(error);
    }
  };
  // refresh for pending actions needed
  // on click refresh pending actions
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
          Gutters.smallHPadding,
        ]}
      >
        <Image
          style={{ width: 35, height: 35 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <View style={[Layout.row, Gutters.tinyTMargin]}>
          <TouchableOpacity
            onPress={() => openHelp()}
            style={[Gutters.smallRMargin]}
          >
            <Icon name="help-circle" size={22} color={Colors.textGray400} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => openSettings()} style={[]}>
            <Icon name="settings" size={22} color={Colors.textGray400} />
          </TouchableOpacity>
        </View>
      </View>
      <Divider color={Colors.textGray200} />
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
        ]}
      >
        <Icon name="key" size={60} color={Colors.textGray400} />
        <Text style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}>
          No pending actions.
        </Text>
        <TouchableOpacity
          onPress={() => handleRefresh()}
          style={[Layout.row, Gutters.regularMargin]}
        >
          <IconB name="gesture-tap" size={30} color={Colors.bluePrimary} />
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBold,
              Fonts.textBluePrimary,
              Gutters.tinyTMargin,
              Gutters.tinyLMargin,
            ]}
          >
            Refresh
          </Text>
        </TouchableOpacity>
      </View>
      <View>
        <TouchableOpacity
          style={[
            Common.button.outlineRounded,
            Common.button.secondaryButton,
            Layout.fullWidth,
          ]}
          onPress={() => scanCode()}
        >
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
              Gutters.regularHPadding,
            ]}
          >
            Scan code
          </Text>
        </TouchableOpacity>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => {
          setIsMenuModalOpen(false);
        }}
        transparent={true}
        visible={isMenuModalOpen}
      >
        <TouchableWithoutFeedback
          onPressOut={() => {
            setIsMenuModalOpen(false);
          }}
        >
          <View style={[Layout.fill]}>
            <View style={[styles.modalMenu]}>
              <TouchableOpacity onPress={() => manualInput()}>
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textBluePrimary,
                    Fonts.textCenter,
                    Gutters.tinyPadding,
                  ]}
                >
                  Manual Input
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => manualInput()}>
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textBluePrimary,
                    Fonts.textCenter,
                    Gutters.tinyPadding,
                  ]}
                >
                  Settings
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  modalMenu: {
    position: 'absolute',
    top: 40,
    right: 5,
    width: 150,
    backgroundColor: 'white',
    marginTop: 60,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});

export default Home;
