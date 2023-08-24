import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Image,
  Modal,
  TextInput,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Icon from 'react-native-vector-icons/Feather';
import IconB from 'react-native-vector-icons/MaterialCommunityIcons';
import Divider from '../../components/Divider/Divider';
import TransactionRequest from '../../components/TransactionRequest/TransactionRequest';
import SyncRequest from '../../components/SyncRequest/SyncRequest';
import AddressDetails from '../../components/AddressDetails/AddressDetails';
import SSPKeyDetails from '../../components/SSPKeyDetails/SSKeyDetails';
import TxSent from '../../components/TxSent/TxSent';
import SyncSuccess from '../../components/SyncSuccess/SyncSuccess';
import HelpSection from '../../components/HelpSection/HelpSection';
import SettingsSection from '../../components/SettingsSection/SettingsSection';
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import Toast from 'react-native-toast-message';
import axios from 'axios';
import { sspConfig } from '@storage/ssp';

const CryptoJS = require('crypto-js');

import {
  getMasterXpriv,
  getMasterXpub,
  generateMultisigAddress,
  generateIdentityAddress,
  generateAddressKeypair,
} from '../../lib/wallet';

import {
  signTransaction,
  finaliseTransaction,
  broadcastTx,
  fetchUtxos,
} from '../../lib/constructTx';

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
  const alreadyMounted = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  const dispatch = useAppDispatch();
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Images, Colors, Common } = useTheme();
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [isManuaInputlModalOpen, setIsManualInputModalOpen] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [rawTx, setRawTx] = useState('');
  const [syncReq, setSyncReq] = useState('');
  const [txid, setTxid] = useState('');
  const [syncSuccessOpen, setSyncSuccessOpen] = useState(false);
  const [addrDetailsOpen, setAddrDetailsOpen] = useState(false);
  const [sspKeyDetailsOpen, setSSPKeyDetailsOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [helpSectionModalOpen, setHelpSectionModalOpen] = useState(false);

  const { seedPhrase } = useAppSelector((state) => state.ssp);
  useEffect(() => {
    if (alreadyMounted.current) {
      return;
    }
    alreadyMounted.current = true;
    if (sspWalletKeyIdentity) {
      // get some pending request on W-K identity
      handleRefresh();
    }
  });

  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  const {
    address,
    redeemScript,
    xpubWallet,
    xpubKey,
    xprivKey,
    sspWalletKeyIdentity,
    sspWalletIdentity,
  } = useAppSelector((state) => state.flux);
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
    // todo use effect
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
        // tell ssp relay that we are synced, post data to ssp sync
        const syncData = {
          chain: 'flux',
          walletIdentity: generatedSspWalletIdentity,
          keyXpub: xpubKeyDecrypted,
          wkIdentity: generatedSspWalletKeyIdentity.address,
        };
        await axios.post(`https://${sspConfig().relay}/v1/sync`, syncData);
        setSyncReq('');
        setSyncSuccessOpen(true);
      })
      .catch((error) => {
        console.log(error.message);
      });
  };

  const openManualInput = () => {
    setIsMenuModalOpen(false);
    setTimeout(() => {
      setIsManualInputModalOpen(true);
    });
  };
  const openAddressDetails = () => {
    setIsMenuModalOpen(false);
    setTimeout(() => {
      setAddrDetailsOpen(true);
    });
  };
  const openSSPKeyDetails = () => {
    setIsMenuModalOpen(false);
    setTimeout(() => {
      setSSPKeyDetailsOpen(true);
    });
  };
  const openMenuSettings = () => {
    setIsMenuModalOpen(false);
    setTimeout(() => {
      setSettingsMenuOpen(true);
    });
  };
  const handleCancelManualInput = () => {
    setIsManualInputModalOpen(false);
    setManualInput('');
  };
  const onChangeManualInput = (text: string) => {
    setManualInput(text);
  };
  const postAction = (
    action: string,
    payload: string,
    chain: string,
    wkIdentity: string,
  ) => {
    const data = {
      action,
      payload,
      chain,
      wkIdentity,
    };
    axios
      .post(`https://${sspConfig().relay}/v1/action`, data)
      .then((res) => {
        console.log(res.data);
      })
      .catch((error) => {
        console.log(error);
      });
  };
  const handleTxRequest = async (rawTransactions: string) => {
    setRawTx(rawTransactions);
  };
  const handleSyncRequest = async (xpubw: string) => {
    setSyncReq(xpubw);
  };
  const approveTransaction = async (rawTransactions: string) => {
    try {
      const utxos = await fetchUtxos(address, 'flux');
      console.log(utxos);
      const id = await getUniqueId();
      const password = await EncryptedStorage.getItem('ssp_key_pw');

      const pwForEncryption = id + password;
      const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
      const xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
      const rds = CryptoJS.AES.decrypt(redeemScript, pwForEncryption);
      const redeemScriptDecrypted = rds.toString(CryptoJS.enc.Utf8);

      const keyPair = generateAddressKeypair(xprivKeyDecrypted, 0, 0, 'flux');
      try {
        const signedTx = await signTransaction(
          rawTransactions,
          'flux',
          keyPair.privKey,
          redeemScriptDecrypted,
          utxos,
        );
        const finalTx = finaliseTransaction(signedTx, 'flux');
        console.log(finalTx);
        const ttxid = await broadcastTx(finalTx, 'flux');
        console.log(ttxid);
        setRawTx('');
        // here tell ssp-relay that we are finished, rewrite the request
        await postAction('txid', ttxid, 'flux', sspWalletKeyIdentity);
        setTxid(ttxid);
      } catch (error) {
        console.log(error);
      }
    } catch (error) {
      console.log(error);
    }
    console.log('tx request');
  };
  const handleMnualInput = async () => {
    // check if input is xpub or transaction
    if (manualInput.startsWith('xpub')) {
      // xpub
      const xpubw = manualInput;
      handleSyncRequest(xpubw);
    } else if (manualInput.startsWith('04')) {
      // transaction
      // sign transaction
      if (!address || !redeemScript) {
        // display error, we are not synced yet with wallet
        console.log('not synced yet');
      } else {
        const rawTransactions = manualInput;
        handleTxRequest(rawTransactions);
      }
    } else {
      displayMessage('error', 'Invalid manual input');
    }
    setTimeout(() => {
      setManualInput('');
      setIsManualInputModalOpen(false);
    });
  };
  const openHelp = () => {
    setHelpSectionModalOpen(true);
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
      if (sspWalletKeyIdentity) {
        // get some pending request on W-K identity
        console.log(sspWalletKeyIdentity);
        const result = await axios.get(
          `https://${sspConfig().relay}/v1/action/${sspWalletKeyIdentity}`,
        );
        console.log('result', result.data);
        if (result.data.action === 'tx') {
          // only this action is valid for us
          handleTxRequest(result.data.payload);
        }
      } else if (sspWalletIdentity) {
        // should not be possible?
        // get some pending request on W identity
        const result = await axios.get(
          `https://${sspConfig().relay}/v1/action/${sspWalletIdentity}`,
        );
        console.log('result', result.data);
      } else {
        console.log('no wallet synced yet');
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleRestore = () => {
    setIsMenuModalOpen(false);
    navigation.navigate('Restore');
  };

  const handleTransactionRequestAction = async (status: boolean) => {
    try {
      if (status === true) {
        const rtx = rawTx;
        await approveTransaction(rtx);
      } else {
        // reject
        const rtx = rawTx;
        setRawTx('');
        await postAction('txrejected', rtx, 'flux', sspWalletKeyIdentity);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleSynchronisationRequestAction = async (status: boolean) => {
    try {
      if (status === true) {
        const xpubw = syncReq;
        generateAddresses(xpubw);
      } else {
        // reject
        setSyncReq('');
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleTxSentModalAction = () => {
    console.log('tx sent modal close. Clean TXID');
    setTxid('');
  };

  const handleSyncSuccessModalAction = () => {
    console.log('sync success modal close.');
    setSyncSuccessOpen(false);
  };

  const handleAddrDetailsModalAction = () => {
    console.log('address details modal close.');
    setAddrDetailsOpen(false);
  };

  const handleSSPKeyModalAction = () => {
    console.log('address details modal close.');
    setSSPKeyDetailsOpen(false);
  };

  const handleSettingsModalAction = () => {
    console.log('settings modal close.');
    setSettingsMenuOpen(false);
  };

  const handleHelpModalAction = () => {
    console.log('help modal close.');
    setHelpSectionModalOpen(false);
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
          Gutters.smallHPadding,
          Gutters.tinyTMargin,
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
      {!rawTx && !syncReq && (
        <>
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
            <Text
              style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}
            >
              {t('home:no_pending_actions')}
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
                {t('common:refresh')}
              </Text>
            </TouchableOpacity>
          </View>
          <View>
            <TouchableOpacity
              style={[
                Common.button.outlineRounded,
                Common.button.secondaryButton,
                Layout.fullWidth,
                Gutters.smallBMargin,
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
                {t('home:scan_code')}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
      {rawTx && (
        <TransactionRequest
          rawTx={rawTx}
          actionStatus={handleTransactionRequestAction}
        />
      )}
      {syncReq && (
        <SyncRequest
          chain="flux"
          actionStatus={handleSynchronisationRequestAction}
        />
      )}
      {txid && <TxSent txid={txid} actionStatus={handleTxSentModalAction} />}
      {syncSuccessOpen && (
        <SyncSuccess
          address={address}
          actionStatus={handleSyncSuccessModalAction}
        />
      )}
      {addrDetailsOpen && (
        <AddressDetails actionStatus={handleAddrDetailsModalAction} />
      )}
      {sspKeyDetailsOpen && (
        <SSPKeyDetails actionStatus={handleSSPKeyModalAction} />
      )}
      {settingsMenuOpen && (
        <SettingsSection
          actionStatus={handleSettingsModalAction}
          navigation={navigation}
        />
      )}
      {helpSectionModalOpen && (
        <HelpSection actionStatus={handleHelpModalAction} />
      )}

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
              <TouchableOpacity onPress={() => openManualInput()}>
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textBluePrimary,
                    Fonts.textCenter,
                    Gutters.tinyPadding,
                  ]}
                >
                  {t('home:manual_input')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openAddressDetails()}>
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textBluePrimary,
                    Fonts.textCenter,
                    Gutters.tinyPadding,
                  ]}
                >
                  {t('home:synced_ssp_address')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openSSPKeyDetails()}>
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textBluePrimary,
                    Fonts.textCenter,
                    Gutters.tinyPadding,
                  ]}
                >
                  {t('home:ssp_key_details')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openMenuSettings()}>
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textBluePrimary,
                    Fonts.textCenter,
                    Gutters.tinyPadding,
                  ]}
                >
                  {t('common:settings')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleRestore()}>
                <Text
                  style={[
                    Fonts.textSmall,
                    Fonts.textBluePrimary,
                    Fonts.textCenter,
                    Gutters.tinyPadding,
                  ]}
                >
                  {t('common:restore')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
        <Toast />
      </Modal>
      <Modal
        animationType="fade"
        transparent={true}
        visible={isManuaInputlModalOpen}
        onRequestClose={() => handleCancelManualInput()}
      >
        <ScrollView
          style={[Layout.fill, styles.modalManualInput]}
          contentContainerStyle={[
            Gutters.smallBPadding,
            Layout.scrollSpaceBetween,
          ]}
        >
          <Text
            style={[Fonts.titleSmall, Gutters.tinyBMargin, Fonts.textCenter]}
          >
            {t('home:manual_input')}
          </Text>
          <Text
            style={[
              Fonts.textRegular,
              Fonts.textCenter,
              Fonts.textBold,
              Gutters.tinyBMargin,
            ]}
          >
            {t('home:sign_resync')}
          </Text>
          <View style={styles.seedPhraseArea}>
            <TextInput
              multiline={true}
              numberOfLines={6}
              style={styles.inputArea}
              inputMode="email"
              autoCapitalize="none"
              placeholder="Input your transaction to sign or xpub of your wallet to sync."
              secureTextEntry={false}
              onChangeText={onChangeManualInput}
              value={manualInput}
              autoCorrect={false}
            />
          </View>
          <TouchableOpacity
            style={[
              Common.button.rounded,
              Common.button.bluePrimary,
              Gutters.regularBMargin,
              Gutters.smallTMargin,
            ]}
            onPress={() => handleMnualInput()}
          >
            <Text style={[Fonts.textRegular, Fonts.textWhite]}>
              {t('home:process_input')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleCancelManualInput()}>
            <Text
              style={[Fonts.textSmall, Fonts.textBluePrimary, Fonts.textCenter]}
            >
              {t('common:cancel')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
        <Toast />
      </Modal>
      {!isManuaInputlModalOpen && !isMenuModalOpen && <Toast />}
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
  modalManualInput: {
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
  seedPhraseArea: {
    width: '100%',
    height: 150,
  },
  inputArea: {
    flex: 1,
    padding: 12,
    backgroundColor: '#f6f6f6',
    color: '#424242',
    borderRadius: 10,
    marginTop: 16,
  },
});

export default Home;