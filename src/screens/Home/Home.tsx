import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
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
import Authentication from '../../components/Authentication/Authentication';
import SettingsSection from '../../components/SettingsSection/SettingsSection';
import SyncNeeded from '../../components/SyncNeeded/SyncNeeded';
import ManualInput from '../../components/ManualInput/ManualInput';
import MenuModal from '../../components/MenuModal/MenuModal';
import Scanner from '../../components/Scanner/Scanner';
import Navbar from '../../components/Navbar/Navbar';
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import Toast from 'react-native-toast-message';
import axios from 'axios';
import { sspConfig } from '@storage/ssp';
import { cryptos } from '../../types';

import { blockchains } from '@storage/blockchains';

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
  setXpubWalletIdentity,
} from '../../store';

import { setSspWalletKeyIdentity, setsspWalletIdentity } from '../../store/ssp';

import { useAppSelector, useAppDispatch } from '../../hooks';
import { useSocket } from 'ssp-key/src/hooks/useSocket';
import { getFCMToken } from 'ssp-key/src/lib/fcmHelper';

type Props = {
  navigation: any;
};

function Home({ navigation }: Props) {
  // focusability of inputs
  const alreadyMounted = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  const { seedPhrase, sspWalletKeyIdentity, sspWalletIdentity, identityChain } =
    useAppSelector((state) => state.ssp);
  const { xpubWallet, xpubKey, xprivKey } = useAppSelector(
    (state) => state[identityChain],
  );
  const dispatch = useAppDispatch();
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [rawTx, setRawTx] = useState('');
  const [activeChain, setActiveChain] = useState<keyof cryptos>(identityChain);
  const [txPath, setTxPath] = useState('');
  const [syncReq, setSyncReq] = useState('');
  const [txid, setTxid] = useState('');
  const [syncSuccessOpen, setSyncSuccessOpen] = useState(false);
  const [addrDetailsOpen, setAddrDetailsOpen] = useState(false);
  const [sspKeyDetailsOpen, setSSPKeyDetailsOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [authenticationOpen, setAuthenticationOpen] = useState(false);
  const [actionToPerform, setActionToPerform] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncNeededModalOpen, setSyncNeededModalOpen] = useState(false);
  const [manualInputModalOpen, setIsManualInputModalOpen] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const { newTx, clearTx } = useSocket();

  const blockchainConfig = blockchains[activeChain];

  useEffect(() => {
    if (alreadyMounted.current) {
      return;
    }
    alreadyMounted.current = true;
    if (sspWalletKeyIdentity) {
      // get some pending request on W-K identity
      handleRefresh();
    }

    if (!sspWalletKeyIdentity || !sspWalletIdentity) {
      setSyncNeededModalOpen(true);
    }

    checkXpubXpriv();
    checkFCMToken();
  });

  useEffect(() => {
    if (newTx.rawTx) {
      handleTxRequest(newTx.rawTx, newTx.chain, newTx.path);
      clearTx?.();
    }
  }, [newTx.rawTx]);

  useEffect(() => {
    if (!xpubKey || !xpubWallet) {
      if (rawTx) {
        displayMessage('error', t('home:err_sync_with_ssp_needed'));
        setRawTx('');
        setActiveChain(identityChain);
      }
    }
  }, [xpubKey, xpubWallet, rawTx]);

  const checkFCMToken = async () => {
    if (sspWalletKeyIdentity) {
      try {
        const token = await getFCMToken();
        if (token) {
          postSyncToken(token, sspWalletKeyIdentity);
        }
      } catch (error) {
        console.log(error);
      }
    }
  };

  const checkXpubXpriv = async () => {
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
          const xpriv = getMasterXpriv(
            mnemonicPhrase,
            48,
            blockchainConfig.slip,
            0,
            blockchainConfig.scriptType,
          ); // takes ~3 secs
          const xpub = getMasterXpub(
            mnemonicPhrase,
            48,
            blockchainConfig.slip,
            0,
            blockchainConfig.scriptType,
          ); // takes ~3 secs
          const xprivBlob = CryptoJS.AES.encrypt(
            xpriv,
            pwForEncryption,
          ).toString();
          const xpubBlob = CryptoJS.AES.encrypt(
            xpub,
            pwForEncryption,
          ).toString();
          setXprivKey(activeChain, xprivBlob);
          setXpubKey(activeChain, xpubBlob);
        })
        .catch((error) => {
          console.log(error.message);
        });
    }
  };

  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  const generateAddressesForactiveChain = (
    suppliedXpubWallet: string,
    chain: keyof cryptos,
  ) => {
    getUniqueId()
      .then(async (id) => {
        // get password from encrypted storage
        const password = await EncryptedStorage.getItem('ssp_key_pw');
        const pwForEncryption = id + password;
        const xpk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
        const xpubKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
        const addrInfo = generateMultisigAddress(
          suppliedXpubWallet,
          xpubKeyDecrypted,
          0,
          0,
          chain,
        );
        CryptoJS.AES.encrypt(addrInfo.redeemScript, pwForEncryption).toString(); // just to test all is fine
        const encryptedXpubWallet = CryptoJS.AES.encrypt(
          suppliedXpubWallet,
          pwForEncryption,
        ).toString();
        setXpubWallet(chain, encryptedXpubWallet);
        // tell ssp relay that we are synced, post data to ssp sync
        const syncData = {
          chain,
          walletIdentity: sspWalletIdentity,
          keyXpub: xpubKeyDecrypted,
          wkIdentity: sspWalletKeyIdentity,
          keyToken: await getFCMToken(),
        };
        console.log(syncData);
        await axios.post(`https://${sspConfig().relay}/v1/sync`, syncData);
        setSyncReq('');
        setSyncSuccessOpen(true);
      })
      .catch((error) => {
        setSyncReq('');
        setActiveChain(identityChain);
        console.log(error.message);
        setTimeout(() => {
          displayMessage('error', t('home:err_sync_failed'));
        }, 200);
      });
  };

  const generateAddressesForSyncIdentity = (suppliedXpubWallet: string) => {
    getUniqueId()
      .then(async (id) => {
        // get password from encrypted storage
        const password = await EncryptedStorage.getItem('ssp_key_pw');
        const pwForEncryption = id + password;
        const xpk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
        const xpubKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
        const addrInfo = generateMultisigAddress(
          suppliedXpubWallet,
          xpubKeyDecrypted,
          0,
          0,
          identityChain,
        );
        CryptoJS.AES.encrypt(addrInfo.redeemScript, pwForEncryption).toString(); // just to test all is ok
        const encryptedXpubWallet = CryptoJS.AES.encrypt(
          suppliedXpubWallet,
          pwForEncryption,
        ).toString();
        setXpubWalletIdentity(encryptedXpubWallet);
        const generatedSspWalletKeyIdentity = generateMultisigAddress(
          suppliedXpubWallet,
          xpubKeyDecrypted,
          10,
          0,
          identityChain,
        );
        dispatch(
          setSspWalletKeyIdentity(generatedSspWalletKeyIdentity.address),
        );
        // generate ssp wallet identity
        const generatedSspWalletIdentity = generateIdentityAddress(
          suppliedXpubWallet,
          identityChain,
        );
        dispatch(setsspWalletIdentity(generatedSspWalletIdentity));
        // tell ssp relay that we are synced, post data to ssp sync
        const syncData = {
          chain: identityChain,
          walletIdentity: generatedSspWalletIdentity,
          keyXpub: xpubKeyDecrypted,
          wkIdentity: generatedSspWalletKeyIdentity.address,
          keyToken: await getFCMToken(),
        };
        console.log(syncData);
        await axios.post(`https://${sspConfig().relay}/v1/sync`, syncData);
        setSyncReq('');
        setSyncSuccessOpen(true);
      })
      .catch((error) => {
        setSyncReq('');
        setActiveChain(identityChain);
        console.log(error.message);
        setTimeout(() => {
          displayMessage('error', t('home:err_sync_failed'));
        }, 200);
      });
  };

  const generateAddressDetailsForSending = (
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

  const openManualInput = () => {
    setIsMenuModalOpen(false);
    setTimeout(() => {
      setIsManualInputModalOpen(true);
    });
  };
  const openAddressDetails = () => {
    setActionToPerform('address');
    setIsMenuModalOpen(false);
    setTimeout(() => {
      setAuthenticationOpen(true);
    });
  };
  const openSSPKeyDetails = () => {
    setActionToPerform('sspkey');
    setIsMenuModalOpen(false);
    setTimeout(() => {
      setAuthenticationOpen(true);
    });
  };
  const openMenuSettings = () => {
    setIsMenuModalOpen(false);
    setTimeout(() => {
      setSettingsMenuOpen(true);
    });
  };
  const postAction = (
    action: string,
    payload: string,
    chain: string,
    path: string,
    wkIdentity: string,
  ) => {
    const data = {
      action,
      payload,
      chain,
      path,
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
  const postSyncToken = async (token: string, wkIdentity: string) => {
    // post fcm token tied to wkIdentity
    const data = {
      keyToken: token,
      wkIdentity,
    };
    axios
      .post(`https://${sspConfig().relay}/v1/token`, data)
      .then((res) => {
        console.log(res.data);
      })
      .catch((error) => {
        console.log(error);
      });
  };
  const handleTxRequest = async (
    rawTransactions: string,
    chain: keyof cryptos = identityChain,
    path = '0-0',
  ) => {
    setRawTx(rawTransactions);
    setActiveChain(chain);
    setTxPath(path);
  };
  const handleSyncRequest = async (xpubw: string, chain: keyof cryptos) => {
    setActiveChain(chain);
    setSyncReq(xpubw);
  };
  const approveTransaction = async (
    rawTransactions: string,
    chain: keyof cryptos,
    derivationPath: string,
  ) => {
    try {
      const id = await getUniqueId();
      const password = await EncryptedStorage.getItem('ssp_key_pw');
      const pwForEncryption = id + password;

      const xpubk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
      const xpubKeyDecrypted = xpubk.toString(CryptoJS.enc.Utf8);
      const xpubw = CryptoJS.AES.decrypt(xpubWallet, pwForEncryption);
      const xpubKeyWalletDecrypted = xpubw.toString(CryptoJS.enc.Utf8);

      const addressDetails = generateAddressDetailsForSending(
        chain,
        derivationPath,
        xpubKeyWalletDecrypted,
        xpubKeyDecrypted,
      );
      const utxos = await fetchUtxos(addressDetails.address, chain);
      console.log(utxos);

      const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
      const xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);

      const splittedDerPath = derivationPath.split('-');
      const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
      const addressIndex = Number(splittedDerPath[1]);

      const keyPair = generateAddressKeypair(
        xprivKeyDecrypted,
        typeIndex,
        addressIndex,
        chain,
      );
      try {
        const signedTx = await signTransaction(
          rawTransactions,
          chain,
          keyPair.privKey,
          addressDetails.redeemScript,
          utxos,
        );
        const finalTx = finaliseTransaction(signedTx, chain);
        console.log(finalTx);
        const ttxid = await broadcastTx(finalTx, chain);
        console.log(ttxid);
        setRawTx('');
        setTxPath('');
        // here tell ssp-relay that we are finished, rewrite the request
        await postAction(
          'txid',
          ttxid,
          chain,
          derivationPath,
          sspWalletKeyIdentity,
        );
        setTxid(ttxid);
      } catch (error) {
        console.log(error);
        displayMessage('error', t('home:err_tx_failed'));
      }
    } catch (error) {
      console.log(error);
    }
    console.log('tx request');
  };
  const handleManualInput = async (manualInput: string) => {
    if (!manualInput) {
      return;
    } else if (manualInput === 'cancel') {
      // do not process
    } else {
      const splittedInput = manualInput.split(':');
      let chain: keyof cryptos = identityChain;
      let wallet = '0-0';
      let dataToProcess = '';
      if (splittedInput[1]) {
        // all is default
        chain = splittedInput[0] as keyof cryptos;
        if (splittedInput[1].includes('-')) {
          // wallet specifiedd
          wallet = splittedInput[1];
          dataToProcess = splittedInput[2];
        } else {
          // wallet default
          dataToProcess = splittedInput[1];
        }
      } else {
        // only data
        dataToProcess = splittedInput[0];
      }
      if (dataToProcess.startsWith('xpub')) {
        // xpub
        const xpubw = dataToProcess;
        handleSyncRequest(xpubw, chain);
      } else if (dataToProcess.startsWith('0')) {
        // transaction
        // sign transaction
        const rawTransactions = dataToProcess;
        handleTxRequest(rawTransactions, chain, wallet);
      } else {
        displayMessage('error', t('home:err_invalid_manual_input'));
      }
      setTimeout(() => {
        setIsManualInputModalOpen(false);
      });
    }
  };
  const handleMenuModalAction = (status: string) => {
    if (status === 'manualinput') {
      openManualInput();
    } else if (status === 'addressdetails') {
      openAddressDetails();
    } else if (status === 'sspkeydetails') {
      openSSPKeyDetails();
    } else if (status === 'menusettings') {
      openMenuSettings();
    } else if (status === 'restore') {
      handleRestore();
    }
    setIsMenuModalOpen(false);
  };
  const openSettings = () => {
    setIsMenuModalOpen(!isMenuModalOpen);
  };
  const scanCode = () => {
    console.log('scan code');
    setShowScanner(true);
  };
  const handleCancelScanner = () => {
    setTimeout(() => {
      setShowScanner(false);
    }, 100);
  };
  const handleScannedData = (scannedData: string) => {
    const splittedInput = scannedData.split(':');
    let chain: keyof cryptos = identityChain;
    let wallet = '0-0';
    let dataToProcess = '';
    if (splittedInput[1]) {
      // all is default
      chain = splittedInput[0] as keyof cryptos;
      if (splittedInput[1].includes('-')) {
        // wallet specifiedd
        wallet = splittedInput[1];
        dataToProcess = splittedInput[2];
      } else {
        // wallet default
        dataToProcess = splittedInput[1];
      }
    } else {
      // only data
      dataToProcess = splittedInput[0];
    }
    // check if input is xpub or transaction
    if (dataToProcess.startsWith('xpub')) {
      // xpub
      const xpubw = scannedData;
      handleSyncRequest(xpubw, chain);
    } else if (dataToProcess.startsWith('0')) {
      // transaction
      const rawTransactions = dataToProcess;
      handleTxRequest(rawTransactions, chain, wallet);
    } else {
      setTimeout(() => {
        displayMessage('error', t('home:err_invalid_scanned_data'));
      }, 200);
    }
    setTimeout(() => {
      setShowScanner(false);
    });
    console.log(scannedData);
  };
  const handleRefresh = async () => {
    // todo here can be a sync request too in the future?
    try {
      console.log('refresh');
      setIsRefreshing(true);
      if (sspWalletKeyIdentity) {
        // get some pending request on W-K identity
        console.log(sspWalletKeyIdentity);
        const result = await axios.get(
          `https://${sspConfig().relay}/v1/action/${sspWalletKeyIdentity}`,
        );
        console.log('result', result.data);
        if (result.data.action === 'tx') {
          // only this action is valid for us
          handleTxRequest(
            result.data.payload,
            result.data.chain,
            result.data.path,
          );
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
    } finally {
      setIsRefreshing(false);
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
        const rchain = activeChain as keyof cryptos;
        const rpath = txPath;
        await approveTransaction(rtx, rchain, rpath);
      } else {
        // reject
        const rtx = rawTx;
        const rchain = activeChain;
        const rpath = txPath;
        setRawTx('');
        setActiveChain(identityChain);
        setTxPath('');
        await postAction(
          'txrejected',
          rtx,
          rchain,
          rpath,
          sspWalletKeyIdentity,
        );
      }
    } catch (error) {
      console.log(error);
    }
  };

  const handleSynchronisationRequestAction = (status: boolean) => {
    try {
      if (status === true) {
        const xpubw = syncReq;
        const sChain = activeChain;
        if (sChain === identityChain) {
          generateAddressesForSyncIdentity(xpubw);
        } else {
          generateAddressesForactiveChain(xpubw, sChain);
        }
      } else {
        // reject
        setSyncReq('');
        setActiveChain(identityChain);
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
    setActiveChain(identityChain);
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

  const handleSyncNeededModalAction = async (status: string) => {
    try {
      setSyncNeededModalOpen(false);
      setTimeout(() => {
        if (status === 'scan') {
          scanCode();
        } else if (status === 'manual') {
          setIsManualInputModalOpen(true);
        }
      });
    } catch (error) {
      console.log(error);
    }
  };

  const handleAuthenticationOpen = (status: boolean) => {
    console.log(status);
    console.log('authentication modal close.');
    setAuthenticationOpen(false);
    if (status === true) {
      setTimeout(() => {
        // open proper dialog
        if (actionToPerform === 'address') {
          setAddrDetailsOpen(true);
        } else if (actionToPerform === 'sspkey') {
          setSSPKeyDetailsOpen(true);
        }
        setActionToPerform('');
      });
    }
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
      <Navbar openSettingsTrigger={openSettings} />
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
              {!sspWalletKeyIdentity || !sspWalletIdentity ? (
                <>{t('home:sync_needed')}!</>
              ) : (
                t('home:no_pending_actions')
              )}
            </Text>
            {(!sspWalletKeyIdentity || !sspWalletIdentity) && (
              <Text
                style={[
                  Fonts.textSmall,
                  Fonts.textCenter,
                  Gutters.smallLMargin,
                  Gutters.smallRMargin,
                ]}
              >
                {t('home:sync_qr_needed')}
              </Text>
            )}
            {isRefreshing && (
              <ActivityIndicator
                size={'large'}
                style={[Layout.row, Gutters.regularTMargin, { height: 30 }]}
              />
            )}
            {!isRefreshing && (
              <TouchableOpacity
                onPressIn={() => handleRefresh()}
                style={[Layout.row, Gutters.regularTMargin, { height: 30 }]}
              >
                <IconB
                  name="gesture-tap"
                  size={30}
                  color={Colors.bluePrimary}
                />
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
            )}
          </View>
          <View>
            <TouchableOpacity
              style={[
                Common.button.outlineRounded,
                Common.button.secondaryButton,
                Layout.fullWidth,
                Gutters.smallBMargin,
              ]}
              onPressIn={() => scanCode()}
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
      {rawTx && xpubWallet && xpubKey && (
        <TransactionRequest
          rawTx={rawTx}
          chain={activeChain as keyof cryptos}
          actionStatus={handleTransactionRequestAction}
        />
      )}
      {syncReq && (
        <SyncRequest
          chain={activeChain}
          actionStatus={handleSynchronisationRequestAction}
        />
      )}
      {txid && (
        <TxSent
          txid={txid}
          chain={activeChain as keyof cryptos}
          actionStatus={handleTxSentModalAction}
        />
      )}
      {syncSuccessOpen && (
        <SyncSuccess
          chain={activeChain}
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
      {syncNeededModalOpen && (
        <SyncNeeded actionStatus={handleSyncNeededModalAction} />
      )}
      {authenticationOpen && (
        <Authentication
          actionStatus={handleAuthenticationOpen}
          type="sensitive"
        />
      )}
      {manualInputModalOpen && <ManualInput actionStatus={handleManualInput} />}
      {isMenuModalOpen && <MenuModal actionStatus={handleMenuModalAction} />}
      {showScanner && (
        <Scanner
          onRead={(data) => handleScannedData(data)}
          onClose={handleCancelScanner}
        />
      )}
    </ScrollView>
  );
}

export default Home;
