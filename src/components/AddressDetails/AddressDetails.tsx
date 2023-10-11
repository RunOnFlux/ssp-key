import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import {
  generateAddressKeypair,
  generateMultisigAddress,
} from '../../lib/wallet';
import { useAppSelector } from '../../hooks';
import { cryptos } from '../../types';

import { blockchains } from '@storage/blockchains';

const CryptoJS = require('crypto-js');

const AddressDetails = (props: { actionStatus: (status: boolean) => void }) => {
  const { identityChain } = useAppSelector((state) => state.ssp);
  const [selectedChain] = useState<keyof cryptos>(identityChain);
  const [selectedPath] = useState('0-0');
  const [decryptedRedeemScript, setDecryptedRedeemScript] = useState('');
  const [decryptedPrivateKey, setDecryptedPrivateKey] = useState('');
  const [address, setAddress] = useState('');
  const [redeemScriptVisible, setRedeemScriptVisible] = useState(false);
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false);
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const { xprivKey, xpubKey, xpubWallet } = useAppSelector(
    (state) => state[selectedChain],
  );
  const blockchainConfig = blockchains[selectedChain];

  useEffect(() => {
    getUniqueId()
      .then(async (id) => {
        console.log('here');
        // clean up password from encrypted storage
        const password = await EncryptedStorage.getItem('ssp_key_pw');
        const pwForEncryption = id + password;
        const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
        const xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
        const xpubk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
        const xpubKeyDecrypted = xpubk.toString(CryptoJS.enc.Utf8);
        const xpubw = CryptoJS.AES.decrypt(xpubWallet, pwForEncryption);
        const xpubKeyWalletDecrypted = xpubw.toString(CryptoJS.enc.Utf8);

        const splittedDerPath = selectedPath.split('-');
        const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
        const addressIndex = Number(splittedDerPath[1]);

        const keyPair = generateAddressKeypair(
          xprivKeyDecrypted,
          typeIndex,
          addressIndex,
          selectedChain,
        );
        const privateKey = keyPair.privKey;
        setDecryptedPrivateKey(privateKey);

        const addressDetails = generateAddressDetails(
          selectedChain,
          selectedPath,
          xpubKeyWalletDecrypted,
          xpubKeyDecrypted,
        );
        setDecryptedRedeemScript(addressDetails.redeemScript);
        setAddress(addressDetails.address);
      })
      .catch((error) => {
        console.log(error.message);
      });
  }, []);

  const generateAddressDetails = (
    chain: keyof cryptos,
    path: string,
    decryptedXpubWallet: string,
    decryptedXpubKey: string,
  ) => {
    const splittedDerPath = path.split('-');
    const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
    const addressIndex = Number(splittedDerPath[1]);
    const addrInfo = generateMultisigAddress(
      decryptedXpubWallet,
      decryptedXpubKey,
      typeIndex,
      addressIndex,
      chain,
    );
    const addrDetails = {
      address: addrInfo.address,
      redeemScript: addrInfo.redeemScript,
    };
    return addrDetails;
  };

  const close = () => {
    console.log('Close');
    setPrivateKeyVisible(false);
    setRedeemScriptVisible(false);
    setDecryptedPrivateKey('');
    setDecryptedRedeemScript('');
    props.actionStatus(false);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={true}
      onRequestClose={() => close()}
    >
      <ScrollView
        style={[Layout.fill, Common.modalBackdrop]}
        contentContainerStyle={[
          Gutters.smallBPadding,
          Layout.scrollSpaceBetween,
          Common.modalView,
        ]}
      >
        <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
          {t('home:chain_addr_details', {
            symbol: blockchainConfig.symbol,
          })}
        </Text>
        <View
          style={[
            Layout.fill,
            Layout.relative,
            Layout.fullWidth,
            Layout.alignItemsCenter,
            Gutters.regularTMargin,
          ]}
        >
          <View style={[Gutters.regularTMargin]}>
            <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
              {t('home:wallet_address')}:
            </Text>
            <Text
              selectable={true}
              style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
            >
              {address}
            </Text>
          </View>
          <View>
            <View style={[Layout.rowCenter, Gutters.tinyRMargin]}>
              <TouchableOpacity
                onPressIn={() => setRedeemScriptVisible(!redeemScriptVisible)}
                style={Common.inputIcon}
              >
                <Icon
                  name={redeemScriptVisible ? 'eye' : 'eye-off'}
                  size={20}
                  color={Colors.bluePrimary}
                />
              </TouchableOpacity>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:wallet_redeem_script')}:
              </Text>
            </View>
            <View>
              <Text
                selectable={true}
                style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
              >
                {redeemScriptVisible
                  ? decryptedRedeemScript
                  : '*** *** *** *** *** ***'}
              </Text>
            </View>
          </View>
          <View>
            <View style={[Layout.rowCenter, Gutters.tinyRMargin]}>
              <TouchableOpacity
                onPressIn={() => setPrivateKeyVisible(!privateKeyVisible)}
                style={Common.inputIcon}
              >
                <Icon
                  name={privateKeyVisible ? 'eye' : 'eye-off'}
                  size={20}
                  color={Colors.bluePrimary}
                />
              </TouchableOpacity>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:wallet_private_key')}:
              </Text>
            </View>
            <View>
              <Text
                selectable={true}
                style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
              >
                {privateKeyVisible
                  ? decryptedPrivateKey
                  : '*** *** *** *** *** ***'}
              </Text>
            </View>
          </View>
        </View>
        <View style={[Layout.justifyContentEnd]}>
          <TouchableOpacity
            style={[
              Common.button.outlineRounded,
              Common.button.secondaryButton,
              Layout.fullWidth,
              Gutters.regularTMargin,
            ]}
            onPressIn={() => close()}
          >
            <Text
              style={[
                Fonts.textSmall,
                Fonts.textBluePrimary,
                Gutters.regularHPadding,
              ]}
            >
              {t('common:ok')}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
};

export default AddressDetails;
