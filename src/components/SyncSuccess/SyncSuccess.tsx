import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { backends } from '@storage/backends';
import { cryptos } from '../../types';
import Keychain from 'react-native-keychain';
import Toast from 'react-native-toast-message';
import { generateMultisigAddress } from '../../lib/wallet';

import { useAppSelector } from '../../hooks';

import * as CryptoJS from 'crypto-js';

const SyncSuccess = (props: {
  chain: keyof cryptos;
  actionStatus: (status: boolean) => void;
}) => {
  // so we need our xpubkey, then generate address and show user the address. If not the same, tell user to restore or create wallet from scratch.
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const { xpubKey, xpubWallet } = useAppSelector((state) => state[props.chain]);
  const [chainAddress, setChainAddress] = useState('');

  useEffect(() => {
    generateAddress();
  }, [xpubKey, xpubWallet]);

  const displayMessage = (
    type: string,
    content: string,
    visibilityTime?: number,
  ) => {
    Toast.show({
      type,
      text1: content,
      visibilityTime: visibilityTime,
    });
  };

  const generateAddress = () => {
    Keychain.getGenericPassword({
      service: 'enc_key',
      rules: Keychain.SECURITY_RULES.NONE, // prevent automatic update
    })
      .then(async (idData) => {
        // clean up password from encrypted storage
        const passwordData = await Keychain.getGenericPassword({
          service: 'sspkey_pw',
          rules: Keychain.SECURITY_RULES.NONE, // prevent automatic update
        });
        if (!passwordData || !idData) {
          throw new Error('Unable to decrypt stored data');
        }
        // decrypt passwordData.password with idData.password
        const password = CryptoJS.AES.decrypt(
          passwordData.password,
          idData.password,
        );
        const passwordDecrypted = password.toString(CryptoJS.enc.Utf8);
        const pwForEncryption = idData.password + passwordDecrypted;
        const xpk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
        const xpubKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
        const xpw = CryptoJS.AES.decrypt(xpubWallet, pwForEncryption);
        const xpubWalletDecrypted = xpw.toString(CryptoJS.enc.Utf8);
        const addrInfo = generateMultisigAddress(
          xpubWalletDecrypted,
          xpubKeyDecrypted,
          0,
          0,
          props.chain,
        );
        const address = addrInfo.address;
        setChainAddress(address);
      })
      .catch((error) => {
        setTimeout(() => {
          displayMessage('error', t('home:err_generate_address'));
        }, 200);
        console.log(error.message);
      });
  };

  const close = () => {
    console.log('Close');
    props.actionStatus(false);
  };

  const openExplorer = () => {
    console.log('Open Explorer');
    const backendConfig = backends()[props.chain];
    Linking.openURL(
      `https://${backendConfig.explorer ?? backendConfig.node}/address/${chainAddress}`,
    );
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
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
          <View
            style={[
              Layout.fill,
              Layout.relative,
              Layout.fullWidth,
              Layout.justifyContentCenter,
              Layout.alignItemsCenter,
            ]}
          >
            <Icon name="check-circle" size={60} color={Colors.textGray400} />
            <Text
              style={[
                Fonts.textBold,
                Fonts.textRegular,
                Gutters.smallMargin,
                Fonts.textCenter,
              ]}
            >
              {t('home:sync_success')}
            </Text>
            <Text
              style={[Fonts.textSmall, Fonts.textCenter, Gutters.smallMargin]}
            >
              {chainAddress}
            </Text>
            <Text style={[Fonts.textTiny, Fonts.textCenter]}>
              {t('home:double_check_address')}
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
              onPress={() => openExplorer()}
            >
              <Text style={[Fonts.textRegular, Fonts.textWhite]}>
                {t('home:show_in_explorer')}
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
                {t('home:close')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default SyncSuccess;
