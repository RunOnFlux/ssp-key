import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Icon from 'react-native-vector-icons/Feather';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import * as Keychain from 'react-native-keychain';
import { useAppSelector } from '../../hooks';
import { cryptos } from '../../types';
import { getMasterXpriv, getMasterXpub } from '../../lib/wallet';
import BlurOverlay from '../../BlurOverlay';

import { blockchains } from '@storage/blockchains';

import * as CryptoJS from 'crypto-js';

const SSPKeyDetails = (props: { actionStatus: (status: boolean) => void }) => {
  // ssp key seed phrase, xpriv, xpub
  const { identityChain } = useAppSelector((state) => state.ssp);
  const [isMainModalOpen, setIsMainModalOpen] = useState(true);
  const [isChainSelectOpen, setIsChainSelectOpen] = useState(false);
  const [selectedChain, setSelectedChain] =
    useState<keyof cryptos>(identityChain);
  const { xpubKey, xprivKey } = useAppSelector((state) => state[selectedChain]);
  const { seedPhrase } = useAppSelector((state) => state.ssp);
  const [decryptedXpub, setDecryptedXpub] = useState('');
  const [deryptedXpriv, setDecryptedXpriv] = useState('');
  const [decryptedMnemonic, setDecryptedMnemonic] = useState('');
  const [xpubVisible, setXpubVisible] = useState(false);
  const [xprivVisible, setXprivVisible] = useState(false);
  const [mnemonicVisible, setMnemonicVisible] = useState(false);
  const { t } = useTranslation(['home', 'common', 'cr']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const blockchainConfig = blockchains[selectedChain];
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
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
        const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
        const xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
        const xpubk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
        const xpubDecrypted = xpubk.toString(CryptoJS.enc.Utf8);
        const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
        const mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);
        if (xpubDecrypted) {
          setDecryptedXpub(xpubDecrypted);
        }
        if (xprivKeyDecrypted) {
          setDecryptedXpriv(xprivKeyDecrypted);
        }
        setDecryptedMnemonic(mnemonicPhrase);
        if (!xprivKeyDecrypted || !xprivKeyDecrypted) {
          if (activityLoading) {
            // not synced yet, derive it.
            // generate master xpriv, xpub for chain
            const xpriv = getMasterXpriv(
              mnemonicPhrase,
              48,
              blockchainConfig.slip,
              0,
              blockchainConfig.scriptType,
              selectedChain,
            ); // takes ~3 secs
            setDecryptedXpriv(xpriv);
            const xpub = getMasterXpub(
              mnemonicPhrase,
              48,
              blockchainConfig.slip,
              0,
              blockchainConfig.scriptType,
              selectedChain,
            ); // takes ~3 secs
            setDecryptedXpub(xpub);
          }
        }
        setActivityLoading(false);
      })
      .catch((error) => {
        console.log(error.message);
        setActivityLoading(false);
      });
  }, [selectedChain, isChainSelectOpen]);

  const close = () => {
    console.log('Close');
    setXprivVisible(false);
    setXpubVisible(false);
    setMnemonicVisible(false);
    setDecryptedXpriv('');
    setDecryptedXpub('');
    setDecryptedMnemonic('');
    props.actionStatus(false);
  };

  const openChainSelect = () => {
    console.log('Open chain select');
    setIsMainModalOpen(false);
    setActivityLoading(false);
    setTimeout(() => {
      setIsChainSelectOpen(true);
    });
  };

  const closeChainSelect = () => {
    console.log('Close chain select');
    setActivityLoading(true);
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
              {t('home:chain_ssp_details', { symbol: blockchainConfig.symbol })}
            </Text>
            <View style={[Gutters.regularTMargin, Layout.colCenter]}>
              <Text style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}>
                {t('home:selected_chain')}:
              </Text>
              <Text
                selectable={true}
                style={[Fonts.textTiny, Fonts.textCenter, Gutters.smallMargin]}
              >
                {blockchainConfig.name} ({blockchainConfig.symbol})
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
                <View style={[Layout.rowCenter, Gutters.tinyRMargin]}>
                  <TouchableOpacity
                    onPress={() => setXpubVisible(!xpubVisible)}
                    style={Common.inputIcon}
                  >
                    <Icon
                      name={xpubVisible ? 'eye' : 'eye-off'}
                      size={20}
                      color={Colors.bluePrimary}
                    />
                  </TouchableOpacity>
                  <Text
                    style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}
                  >
                    {t('home:chain_xpub', { chain: blockchainConfig.name })}:
                  </Text>
                </View>
                <Text
                  style={[
                    Fonts.textTinyTiny,
                    Fonts.textLight,
                    Fonts.textJustify,
                  ]}
                >
                  {t('home:chain_xpub_desc', { chain: blockchainConfig.name })}
                </Text>
                <View>
                  {activityLoading && <ActivityIndicator size={'large'} />}
                  {!activityLoading && (
                    <Text
                      selectable={true}
                      style={[
                        Fonts.textTiny,
                        Fonts.textCenter,
                        Gutters.smallMargin,
                      ]}
                    >
                      {xpubVisible ? decryptedXpub : '*** *** *** *** *** ***'}
                    </Text>
                  )}
                </View>
              </View>
              <View>
                <View style={[Layout.rowCenter, Gutters.tinyRMargin]}>
                  <TouchableOpacity
                    onPress={() => setXprivVisible(!xprivVisible)}
                    style={Common.inputIcon}
                  >
                    <Icon
                      name={xprivVisible ? 'eye' : 'eye-off'}
                      size={20}
                      color={Colors.bluePrimary}
                    />
                  </TouchableOpacity>
                  <Text
                    style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}
                  >
                    {t('home:chain_xpriv', { chain: blockchainConfig.name })}:
                  </Text>
                </View>
                <Text
                  style={[
                    Fonts.textTinyTiny,
                    Fonts.textLight,
                    Fonts.textJustify,
                  ]}
                >
                  {t('home:chain_xpriv_desc', { chain: blockchainConfig.name })}
                </Text>
                <Text
                  style={[
                    Fonts.textTinyTiny,
                    Fonts.textLight,
                    Gutters.tinyTMargin,
                    Fonts.textJustify,
                    Fonts.textError,
                  ]}
                >
                  {t('home:sensitive_data_warning', {
                    sensitive_data: t('home:chain_xpriv', {
                      chain: blockchainConfig.name,
                    }),
                  })}
                </Text>
                <View>
                  {activityLoading && <ActivityIndicator size={'large'} />}
                  {!activityLoading && (
                    <>
                      <Text
                        selectable={true}
                        style={[
                          Fonts.textTiny,
                          Fonts.textCenter,
                          Gutters.tinyMargin,
                        ]}
                      >
                        {xprivVisible
                          ? deryptedXpriv.slice(
                              0,
                              Math.floor(deryptedXpriv.length / 2),
                            )
                          : '*** *** *** *** *** ***'}
                      </Text>
                      <Text
                        selectable={true}
                        style={[
                          Fonts.textTiny,
                          Fonts.textCenter,
                          Gutters.tinyMargin,
                          Gutters.smallBMargin,
                        ]}
                      >
                        {xprivVisible
                          ? deryptedXpriv.slice(
                              Math.floor(deryptedXpriv.length / 2),
                              deryptedXpriv.length,
                            )
                          : '*** *** *** *** *** ***'}
                      </Text>
                    </>
                  )}
                </View>
              </View>
              <View>
                <View style={[Layout.rowCenter, Gutters.tinyRMargin]}>
                  <TouchableOpacity
                    onPress={() => setMnemonicVisible(!mnemonicVisible)}
                    style={Common.inputIcon}
                  >
                    <Icon
                      name={mnemonicVisible ? 'eye' : 'eye-off'}
                      size={20}
                      color={Colors.bluePrimary}
                    />
                  </TouchableOpacity>
                  <Text
                    style={[Fonts.textBold, Fonts.textSmall, Fonts.textCenter]}
                  >
                    {t('home:ssp_key_mnemonic')}:
                  </Text>
                </View>
                <Text
                  style={[
                    Fonts.textTinyTiny,
                    Fonts.textLight,
                    Fonts.textJustify,
                  ]}
                >
                  {t('home:ssp_key_mnemonic_desc')}
                </Text>
                <Text
                  style={[
                    Fonts.textTinyTiny,
                    Fonts.textLight,
                    Gutters.tinyTMargin,
                    Fonts.textJustify,
                    Fonts.textError,
                  ]}
                >
                  {t('cr:ssp_key_mnemonic_sec')}
                </Text>
                <View
                  style={[
                    { borderWidth: 1, borderColor: Colors.textInput },
                    Gutters.smallTMargin,
                    Gutters.smallBMargin,
                  ]}
                >
                  <Text
                    selectable={true}
                    style={[
                      Fonts.textSmall,
                      Fonts.textCenter,
                      Gutters.tinyMargin,
                      Fonts.textBold,
                    ]}
                  >
                    {mnemonicVisible
                      ? decryptedMnemonic
                          .split(' ')
                          .slice(
                            0,
                            Math.round(decryptedMnemonic.split(' ').length / 3),
                          )
                          .join(' ')
                      : '*** *** *** *** *** *** *** ***'}
                  </Text>
                  <Text
                    selectable={true}
                    style={[
                      Fonts.textSmall,
                      Fonts.textCenter,
                      Gutters.tinyMargin,
                      Fonts.textBold,
                    ]}
                  >
                    {mnemonicVisible
                      ? decryptedMnemonic
                          .split(' ')
                          .slice(
                            Math.round(decryptedMnemonic.split(' ').length / 3),
                            Math.round(
                              (decryptedMnemonic.split(' ').length / 3) * 2,
                            ),
                          )
                          .join(' ')
                      : '*** *** *** *** *** *** *** ***'}
                  </Text>
                  <Text
                    selectable={true}
                    style={[
                      Fonts.textSmall,
                      Fonts.textCenter,
                      Gutters.tinyMargin,
                      Fonts.textBold,
                    ]}
                  >
                    {mnemonicVisible
                      ? decryptedMnemonic
                          .split(' ')
                          .slice(
                            Math.round(
                              (decryptedMnemonic.split(' ').length / 3) * 2,
                            ),
                            decryptedMnemonic.split(' ').length,
                          )
                          .join(' ')
                      : '*** *** *** *** *** *** *** ***'}
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
                  Gutters.largeTMargin,
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
                onValueChange={(itemValue) => {
                  setSelectedChain(itemValue);
                }}
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

export default SSPKeyDetails;
