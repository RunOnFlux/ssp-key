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
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import { useAppSelector } from '../../hooks';
import { cryptos } from '../../types';
import { getMasterXpriv, getMasterXpub } from '../../lib/wallet';

import { blockchains } from '@storage/blockchains';

const CryptoJS = require('crypto-js');

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
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const blockchainConfig = blockchains[selectedChain];
  const [activityLoading, setActivityLoading] = useState(false);

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
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={[Layout.fill, Common.modalBackdrop]}
          contentInset={{ bottom: 80 }}
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
            Common.modalView,
          ]}
        >
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
              onPressIn={() => openChainSelect()}
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
                  onPressIn={() => setXpubVisible(!xpubVisible)}
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
                  onPressIn={() => setXprivVisible(!xprivVisible)}
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
                    {xprivVisible ? deryptedXpriv : '*** *** *** *** *** ***'}
                  </Text>
                )}
              </View>
            </View>
            <View>
              <View style={[Layout.rowCenter, Gutters.tinyRMargin]}>
                <TouchableOpacity
                  onPressIn={() => setMnemonicVisible(!mnemonicVisible)}
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
              <View>
                <Text
                  selectable={true}
                  style={[
                    Fonts.textTiny,
                    Fonts.textCenter,
                    Gutters.smallMargin,
                  ]}
                >
                  {mnemonicVisible
                    ? decryptedMnemonic
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
                Gutters.largeTMargin,
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
      <Modal
        animationType="fade"
        transparent={true}
        visible={isChainSelectOpen}
        onRequestClose={() => setIsChainSelectOpen(false)}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={[Layout.fill, Common.modalBackdrop]}
          contentInset={{ bottom: 80 }}
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
            Common.modalView,
          ]}
        >
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
              onPressIn={() => closeChainSelect()}
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
    </>
  );
};

export default SSPKeyDetails;
