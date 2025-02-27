import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import * as Keychain from 'react-native-keychain';
import QRCode from 'react-native-qrcode-svg';
import { generateMultisigAddress } from '../../lib/wallet';
import { useAppSelector } from '../../hooks';
import { cryptos } from '../../types';
import BlurOverlay from '../../BlurOverlay';

import { blockchains } from '@storage/blockchains';

import * as CryptoJS from 'crypto-js';

const Receive = (props: { actionStatus: (status: boolean) => void }) => {
  const { identityChain } = useAppSelector((state) => state.ssp);
  const [isMainModalOpen, setIsMainModalOpen] = useState(true);
  const [isChainSelectOpen, setIsChainSelectOpen] = useState(false);
  const [selectedChain, setSelectedChain] =
    useState<keyof cryptos>(identityChain);
  const [selectedPath, setSelectedPath] = useState('0-0');
  const [selectedWallet, setSelectedWallet] = useState('0');
  const [address, setAddress] = useState('');
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common, Images, darkMode } =
    useTheme();
  const { xpubKey, xpubWallet } = useAppSelector(
    (state) => state[selectedChain],
  );
  const blockchainConfig = blockchains[selectedChain];

  useEffect(() => {
    const path = '0-' + selectedWallet;
    setSelectedPath(path);
  }, [selectedWallet]);

  useEffect(() => {
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
        const xpubk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
        const xpubKeyDecrypted = xpubk.toString(CryptoJS.enc.Utf8);
        const xpubw = CryptoJS.AES.decrypt(xpubWallet, pwForEncryption);
        const xpubKeyWalletDecrypted = xpubw.toString(CryptoJS.enc.Utf8);

        const addressDetails = generateAddressDetails(
          selectedChain,
          selectedPath,
          xpubKeyWalletDecrypted,
          xpubKeyDecrypted,
        );
        setAddress(addressDetails.address);
      })
      .catch((error) => {
        console.log(error);
        setAddress(t('home:chain_not_synced_scan'));
      });
  }, [selectedPath, selectedChain]);

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
      witnessScript: addrInfo.witnessScript,
    };
    return addrDetails;
  };

  const close = () => {
    console.log('Close');
    props.actionStatus(false);
  };

  const openChainSelect = () => {
    console.log('Open chain select');
    setIsMainModalOpen(false);
    setTimeout(() => {
      setIsChainSelectOpen(true);
    });
  };

  const closeChainSelect = () => {
    console.log('Close chain select');
    setIsChainSelectOpen(false);
    setTimeout(() => {
      setIsMainModalOpen(true);
    });
  };

  return (
    <>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isMainModalOpen}
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
            <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
              {t('home:chain_addr_details', {
                symbol: blockchainConfig.symbol,
              })}
            </Text>
            <View style={[Gutters.regularTMargin, Layout.colCenter]}>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:selected_chain_wallet')}:
              </Text>
              <Text
                selectable={true}
                style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
              >
                {blockchainConfig.name} - {t('common:wallet')}{' '}
                {+selectedWallet + 1}
              </Text>
              <TouchableOpacity
                style={[
                  Common.button.outlineRounded,
                  Common.button.secondaryButton,
                ]}
                onPress={() => openChainSelect()}
              >
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textBluePrimary,
                    Gutters.regularHPadding,
                  ]}
                >
                  {t('home:select_chain')}
                </Text>
              </TouchableOpacity>
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
              <View>
                <Text
                  style={[
                    Fonts.textBold,
                    Fonts.textSmall,
                    Fonts.textCenter,
                    Gutters.tinyBMargin,
                  ]}
                >
                  {t('home:wallet_address')}:
                </Text>
                <Text
                  style={[
                    Fonts.textTinyTiny,
                    Fonts.textLight,
                    Fonts.textJustify,
                  ]}
                >
                  {t('home:wallet_address_desc')}
                </Text>
                {address && address !== t('home:chain_not_synced_scan') && (
                  <View style={[Gutters.smallTMargin, Layout.alignItemsCenter]}>
                    <QRCode
                      value={address}
                      logo={
                        darkMode ? Images.ssp.logoWhite : Images.ssp.logoBlack
                      }
                      color={Colors.textGray800}
                      backgroundColor={Colors.modalBackground}
                      size={150}
                    />
                  </View>
                )}
                <Text
                  selectable={true}
                  style={[
                    Fonts.textTiny,
                    Fonts.textCenter,
                    Gutters.smallMargin,
                  ]}
                >
                  {address}
                </Text>
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
                onPress={() => close()}
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
          </View>
        </ScrollView>
      </Modal>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isChainSelectOpen}
        onRequestClose={() => setIsChainSelectOpen(false)}
      >
        <BlurOverlay />
        <ScrollView
          keyboardShouldPersistTaps="always"
          style={[Layout.fill, Common.modalBackdrop]}
          contentInset={{ bottom: 80 }}
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
            Layout.justifyContentCenter,
          ]}
        >
          <View style={[Common.modalView]}>
            <Text style={[Fonts.titleSmall, Fonts.textCenter]}>
              {t('home:select_chain')}
            </Text>
            <View style={[Gutters.regularTMargin]}>
              <Picker
                selectedValue={selectedChain}
                onValueChange={(itemValue) => setSelectedChain(itemValue)}
              >
                {Object.keys(blockchains).map((key) => (
                  <Picker.Item
                    color={Colors.textInput}
                    label={blockchains[key].name}
                    value={key}
                    key={key}
                  />
                ))}
              </Picker>
              <Picker
                selectedValue={selectedWallet}
                onValueChange={(itemValue) => setSelectedWallet(itemValue)}
              >
                {Array.from(Array(42), (_, i) => (
                  <Picker.Item
                    color={Colors.textInput}
                    label={`Wallet ${i + 1}`}
                    value={i.toString()}
                    key={i.toString()}
                  />
                ))}
              </Picker>
            </View>
            <View style={[Layout.justifyContentEnd]}>
              <TouchableOpacity
                style={[
                  Common.button.outlineRounded,
                  Common.button.secondaryButton,
                  Layout.fullWidth,
                  Gutters.regularTMargin,
                ]}
                onPress={() => closeChainSelect()}
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
          </View>
        </ScrollView>
      </Modal>
    </>
  );
};

export default Receive;
