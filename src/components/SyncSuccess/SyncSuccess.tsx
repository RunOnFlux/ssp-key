import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { explorerAddressUrl } from '../../lib/explorerUrl';
import { MONOSPACE_FONT } from '../../lib/typography';
import { PrimaryButton, SuccessHeader } from '../ui';
import { cryptos } from '../../types';
import * as Keychain from 'react-native-keychain';
import Toast from 'react-native-toast-message';
import { generateMultisigAddress } from '../../lib/wallet';
import BlurOverlay from '../../BlurOverlay';

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
    })
      .then(async (idData) => {
        // clean up password from encrypted storage
        const passwordData = await Keychain.getGenericPassword({
          service: 'sspkey_pw',
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

  useEffect(() => {
    generateAddress();
  }, [xpubKey, xpubWallet]);

  const close = () => {
    console.log('Close');
    props.actionStatus(false);
  };

  const openExplorer = () => {
    console.log('Open Explorer');
    Linking.openURL(explorerAddressUrl(props.chain, chainAddress));
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <BlurOverlay />
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
            <SuccessHeader title={t('home:sync_success')} />
            <Text
              selectable={true}
              style={[
                Fonts.textTiny,
                Fonts.textCenter,
                Gutters.smallMargin,
                { fontFamily: MONOSPACE_FONT, color: Colors.textGray800 },
              ]}
            >
              {chainAddress}
            </Text>
            <Text
              style={[
                Fonts.textTiny,
                Fonts.textCenter,
                { color: Colors.textGray400 },
              ]}
            >
              {t('home:double_check_address')}
            </Text>
          </View>
          <View style={[Layout.justifyContentEnd]}>
            <PrimaryButton
              label={t('home:show_in_explorer')}
              style={[Gutters.regularBMargin, Gutters.smallTMargin]}
              onPress={() => openExplorer()}
            />
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => close()}
              hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }}
            >
              <Text
                style={[Fonts.textSmall, Fonts.textPrimary, Fonts.textCenter]}
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
