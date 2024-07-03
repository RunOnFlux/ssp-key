import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Icon from 'react-native-vector-icons/Feather';
import IconB from 'react-native-vector-icons/MaterialCommunityIcons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Divider from '../../components/Divider/Divider';
import TransactionRequest from '../../components/TransactionRequest/TransactionRequest';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux';
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
import PublicNoncesRequest from '../..//components/PublicNoncesRequest/PublicNoncesRequest';
import PublicNoncesSuccess from '../../components/PublicNoncesSuccess/PublicNoncesSuccess';
import { getUniqueId } from 'react-native-device-info';
import EncryptedStorage from 'react-native-encrypted-storage';
import Toast from 'react-native-toast-message';
import axios from 'axios';
import { sspConfig } from '@storage/ssp';
import {
  cryptos,
  utxo,
  syncSSPRelay,
  publicNonce,
  publicPrivateNonce,
} from '../../types';
import { blockchains } from '@storage/blockchains';

const CryptoJS = require('crypto-js');

import {
  getMasterXpriv,
  getMasterXpub,
  generateMultisigAddress,
  generateInternalIdentityAddress,
  generateAddressKeypair,
  generatePublicNonce,
} from '../../lib/wallet';

import {
  signTransaction,
  finaliseTransaction,
  broadcastTx,
  fetchUtxos,
  signAndBroadcastEVM,
  selectPublicNonce,
} from '../../lib/constructTx';

import {
  setXpubKey,
  setXprivKey,
  setXpubWallet,
  setXpubWalletIdentity,
} from '../../store';

import {
  setSspWalletKeyInternalIdentity,
  setSspWalletInternalIdentity,
  setSspKeyPublicNonces,
} from '../../store/ssp';

import { useAppSelector, useAppDispatch } from '../../hooks';
import { useSocket } from '../../hooks/useSocket';
import { getFCMToken, refreshFCMToken } from '../../lib/fcmHelper';

type Props = {
  navigation: any;
};

const xpubRegex = /^([a-zA-Z]{2}ub[1-9A-HJ-NP-Za-km-z]{79,140})$/; // xpub start is the most usual, but can also be Ltub

function Home({ navigation }: Props) {
  // focusability of inputs
  const alreadyMounted = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  const {
    seedPhrase,
    sspWalletKeyInternalIdentity,
    sspWalletInternalIdentity,
    identityChain,
  } = useAppSelector((state) => state.ssp);
  const dispatch = useAppDispatch();
  const { t } = useTranslation(['home', 'common']);
  const { Fonts, Gutters, Layout, Colors, Common } = useTheme();
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
  const [rawTx, setRawTx] = useState('');
  const [activeChain, setActiveChain] = useState<keyof cryptos>(identityChain);
  const [txPath, setTxPath] = useState('');
  const [txUtxos, setTxUtxos] = useState<utxo[]>([]);
  const [syncReq, setSyncReq] = useState('');
  const [publicNoncesReq, setPublicNoncesReq] = useState('');
  const [publicNoncesShared, setPublicNoncesShared] = useState(false);
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
  const { xpubWallet, xpubKey, xprivKey } = useAppSelector(
    (state) => state[activeChain],
  );
  const { publicNonces } = useAppSelector((state) => state.ssp);
  const [activityStatus, setActivityStatus] = useState(false);
  const [submittingTransaction, setSubmittingTransaction] = useState(false);

  const { newTx, clearTx, publicNoncesRequest, clearPublicNoncesRequest } =
    useSocket();

  useEffect(() => {
    if (alreadyMounted.current) {
      return;
    }
    alreadyMounted.current = true;
    if (sspWalletKeyInternalIdentity) {
      // get some pending request on W-K identity
      handleRefresh();
    }

    if (!sspWalletKeyInternalIdentity || !sspWalletInternalIdentity) {
      setSyncNeededModalOpen(true);
    }

    checkXpubXpriv();
    checkFCMToken();
  });

  useEffect(() => {
    checkXpubXpriv();
  }, [activeChain]);

  useEffect(() => {
    if (newTx.rawTx) {
      handleTxRequest(newTx.rawTx, newTx.chain, newTx.path, newTx.utxos);
      clearTx?.();
    }
  }, [newTx.rawTx]);

  useEffect(() => {
    if (publicNoncesRequest) {
      handlePublicNoncesRequest(identityChain);
      clearPublicNoncesRequest?.();
    }
  }, [publicNoncesRequest]);

  useEffect(() => {
    if (!xpubKey || !xpubWallet) {
      if (rawTx) {
        displayMessage('error', t('home:err_sync_with_ssp_needed'), 10000);
        setRawTx('');
        setActiveChain(identityChain);
      }
    }
  }, [xpubKey, xpubWallet, rawTx]);

  const checkFCMToken = async () => {
    if (sspWalletKeyInternalIdentity) {
      try {
        await refreshFCMToken();
        const token = await getFCMToken();
        if (token) {
          postSyncToken(token, sspWalletKeyInternalIdentity);
        }
      } catch (error) {
        console.log(error);
      }
    }
  };

  const checkXpubXpriv = async () => {
    // todo loading animation on chain sync approval
    const chainToUse = activeChain as keyof cryptos;
    const blockchainConfigToUse = blockchains[chainToUse];
    if (!xpubKey || !xprivKey) {
      // just a precaution to make sure xpub and xpriv are set. Should acutally never end up here
      getUniqueId()
        .then(async (id) => {
          // clean up password from encrypted storage
          const password = await EncryptedStorage.getItem('ssp_key_pw');
          const pwForEncryption = id + password;
          const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
          const mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);
          // generate master xpriv, xpub for chain
          const xpriv = getMasterXpriv(
            mnemonicPhrase,
            48,
            blockchainConfigToUse.slip,
            0,
            blockchainConfigToUse.scriptType,
            chainToUse,
          ); // takes ~3 secs
          const xpub = getMasterXpub(
            mnemonicPhrase,
            48,
            blockchainConfigToUse.slip,
            0,
            blockchainConfigToUse.scriptType,
            chainToUse,
          ); // takes ~3 secs
          const xprivBlob = CryptoJS.AES.encrypt(
            xpriv,
            pwForEncryption,
          ).toString();
          const xpubBlob = CryptoJS.AES.encrypt(
            xpub,
            pwForEncryption,
          ).toString();
          setXprivKey(chainToUse, xprivBlob);
          setXpubKey(chainToUse, xpubBlob);
        })
        .catch((error) => {
          console.log(error.message);
        });
    }
  };

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

  const generateAddressesForActiveChain = (
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
        if (!addrInfo || !addrInfo.address) {
          throw new Error('Could not generate multisig address');
        }
        CryptoJS.AES.encrypt(
          addrInfo.redeemScript || addrInfo.witnessScript,
          pwForEncryption,
        ).toString(); // just to test all is fine
        const encryptedXpubWallet = CryptoJS.AES.encrypt(
          suppliedXpubWallet,
          pwForEncryption,
        ).toString();
        setXpubWallet(chain, encryptedXpubWallet);
        // tell ssp relay that we are synced, post data to ssp sync
        const syncData: syncSSPRelay = {
          chain,
          walletIdentity: sspWalletInternalIdentity,
          keyXpub: xpubKeyDecrypted,
          wkIdentity: sspWalletKeyInternalIdentity,
          keyToken: await getFCMToken(),
        };
        // == EVM ==
        if (blockchains[chain].chainType === 'evm') {
          const ppNonces = [];
          // generate and replace nonces
          for (let i = 0; i < 50; i += 1) {
            // max 50 txs
            const nonce = generatePublicNonce();
            ppNonces.push(nonce);
          }
          const stringifiedNonces = JSON.stringify(ppNonces);
          const encryptedNonces = CryptoJS.AES.encrypt(
            stringifiedNonces,
            pwForEncryption,
          ).toString();
          dispatch(setSspKeyPublicNonces(encryptedNonces));
          // on publicNonces delete k and kTwo, leave only public parts
          const pNs: publicNonce[] = ppNonces.map((nonce) => ({
            kPublic: nonce.kPublic,
            kTwoPublic: nonce.kTwoPublic,
          }));
          syncData.publicNonces = pNs;
        }
        // == EVM end
        console.log(syncData);
        await axios.post(`https://${sspConfig().relay}/v1/sync`, syncData);
        setSyncReq('');
        setSyncSuccessOpen(true);
      })
      .catch((error) => {
        setSyncReq('');
        setActiveChain(identityChain);
        console.log(error);
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
        if (!addrInfo || !addrInfo.address) {
          throw new Error('Could not generate multisig address');
        }
        CryptoJS.AES.encrypt(
          addrInfo.redeemScript || addrInfo.witnessScript,
          pwForEncryption,
        ).toString(); // just to test all is ok
        const encryptedXpubWallet = CryptoJS.AES.encrypt(
          suppliedXpubWallet,
          pwForEncryption,
        ).toString();
        setXpubWalletIdentity(encryptedXpubWallet);
        const generatedSspWalletKeyInternalIdentity = generateMultisigAddress(
          suppliedXpubWallet,
          xpubKeyDecrypted,
          10,
          0,
          identityChain,
        );
        if (
          !generatedSspWalletKeyInternalIdentity ||
          !generatedSspWalletKeyInternalIdentity.address
        ) {
          throw new Error(
            'Could not generate SSP Wallet Key internal identity',
          );
        }
        dispatch(
          setSspWalletKeyInternalIdentity(
            generatedSspWalletKeyInternalIdentity.address,
          ),
        );
        // generate ssp wallet identity
        const generatedSspWalletInternalIdentity =
          generateInternalIdentityAddress(suppliedXpubWallet, identityChain);
        if (!generatedSspWalletInternalIdentity) {
          throw new Error('Could not generate SSP Wallet internal identity');
        }
        dispatch(
          setSspWalletInternalIdentity(generatedSspWalletInternalIdentity),
        );
        // tell ssp relay that we are synced, post data to ssp sync
        const syncData: syncSSPRelay = {
          chain: identityChain,
          walletIdentity: generatedSspWalletInternalIdentity,
          keyXpub: xpubKeyDecrypted,
          wkIdentity: generatedSspWalletKeyInternalIdentity.address,
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
      witnessScript: addrInfo.witnessScript,
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
  const postSyncToken = (token: string, wkIdentity: string) => {
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
  const handleTxRequest = (
    rawTransaction: string,
    chain: keyof cryptos,
    path: string,
    utxos: utxo[] = [],
  ) => {
    setActiveChain(chain);
    if (utxos) {
      setTxUtxos(utxos);
    }
    setRawTx(rawTransaction);
    setTxPath(path);
  };
  const handlePublicNoncesRequest = (chain: keyof cryptos) => {
    console.log(chain);
    setActiveChain(chain);
    setPublicNoncesReq(chain);
  };
  const handleSyncRequest = async (xpubw: string, chain: keyof cryptos) => {
    setActiveChain(chain);
    setSyncReq(xpubw);
  };
  const approvePublicNoncesAction = async (chain: keyof cryptos) => {
    try {
      const ppNonces = [];
      // generate and replace nonces
      for (let i = 0; i < 50; i += 1) {
        // max 50 txs
        const nonce = generatePublicNonce();
        ppNonces.push(nonce);
      }
      const id = await getUniqueId();
      const password = await EncryptedStorage.getItem('ssp_key_pw');
      const pwForEncryption = id + password;
      const stringifiedNonces = JSON.stringify(ppNonces);
      const encryptedNonces = CryptoJS.AES.encrypt(
        stringifiedNonces,
        pwForEncryption,
      ).toString();
      dispatch(setSspKeyPublicNonces(encryptedNonces));
      // on publicNonces delete k and kTwo, leave only public parts
      const pNs: publicNonce[] = ppNonces.map((nonce) => ({
        kPublic: nonce.kPublic,
        kTwoPublic: nonce.kTwoPublic,
      }));
      await postAction(
        'publicnonces',
        JSON.stringify(pNs),
        chain,
        '',
        sspWalletKeyInternalIdentity,
      );
      setPublicNoncesReq('');
      setPublicNoncesShared(true);
    } catch (error) {
      // @ts-ignore
      displayMessage('error', error.message ?? 'home:err_tx_failed');
      console.log(error);
    }
  };
  const approveTransaction = async (
    rawTransaction: string,
    chain: keyof cryptos,
    derivationPath: string,
    suggestedUtxos: utxo[],
  ) => {
    try {
      console.log('tx request');
      setSubmittingTransaction(true);
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
      let utxos = suggestedUtxos;
      // if utxos are not provided, fetch them
      if (!(suggestedUtxos && suggestedUtxos.length > 0)) {
        utxos = await fetchUtxos(addressDetails.address, chain, 2); // in ssp key, we want to fetch both confirmed and unconfirmed utxos
      }

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
      let ttxid = '';
      if (blockchains[chain].chainType === 'evm') {
        const pNs = CryptoJS.AES.decrypt(publicNonces, pwForEncryption);
        const pNsDecrypted = pNs.toString(CryptoJS.enc.Utf8);
        const pubNonces = JSON.parse(pNsDecrypted) as publicPrivateNonce[];
        const publicNonceKey = selectPublicNonce(rawTransaction, pubNonces);
        // crucial delete nonce from publicNonces
        const newPublicNonces = pubNonces.filter(
          (nonce: publicPrivateNonce) =>
            nonce.kPublic !== publicNonceKey.kPublic,
        );
        // encrypt and save new publicNonces
        const stringifiedNonces = JSON.stringify(newPublicNonces);
        const encryptedNonces = CryptoJS.AES.encrypt(
          stringifiedNonces,
          pwForEncryption,
        ).toString();
        dispatch(setSspKeyPublicNonces(encryptedNonces));
        // sign and broadcast
        ttxid = await signAndBroadcastEVM(
          rawTransaction,
          chain,
          keyPair.privKey as `0x${string}`,
          publicNonceKey,
        );
      } else {
        const signedTx = await signTransaction(
          rawTransaction,
          chain,
          keyPair.privKey,
          addressDetails.redeemScript ?? '',
          addressDetails.witnessScript ?? '',
          utxos,
        );
        const finalTx = finaliseTransaction(signedTx, chain);
        console.log(finalTx);
        ttxid = await broadcastTx(finalTx, chain);
      }
      console.log(ttxid);
      setRawTx('');
      setTxPath('');
      setTxUtxos([]);
      // here tell ssp-relay that we are finished, rewrite the request
      await postAction(
        'txid',
        ttxid,
        chain,
        derivationPath,
        sspWalletKeyInternalIdentity,
      );
      setTxid(ttxid);
    } catch (error) {
      // @ts-ignore
      displayMessage('error', error.message ?? 'home:err_tx_failed');
      console.log(error);
    } finally {
      setSubmittingTransaction(false);
    }
  };
  const handleManualInput = async (manualInput: string) => {
    try {
      if (!manualInput) {
        return;
      } else if (manualInput === 'cancel') {
        // do not process
        setTimeout(() => {
          setIsManualInputModalOpen(false);
        });
      } else if (manualInput === 'publicnonces') {
        handlePublicNoncesRequest(identityChain);
        setTimeout(() => {
          setIsManualInputModalOpen(false);
        });
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
        if (!dataToProcess || !blockchains[chain]) {
          displayMessage('error', t('home:err_invalid_manual_input'));
        } else {
          if (xpubRegex.test(dataToProcess)) {
            // xpub
            const xpubw = dataToProcess;
            handleSyncRequest(xpubw, chain);
            setTimeout(() => {
              setIsManualInputModalOpen(false);
            });
          } else if (dataToProcess.startsWith('0')) {
            // transaction
            // sign transaction
            const rawTransaction = dataToProcess;
            handleTxRequest(rawTransaction, chain, wallet);
            setTimeout(() => {
              setIsManualInputModalOpen(false);
            });
          } else {
            displayMessage('error', t('home:err_invalid_manual_input'));
          }
        }
      }
    } catch (error) {
      console.log(error);
      displayMessage('error', t('home:err_invalid_manual_input'));
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
    try {
      // https://apps.apple.com/us/app/ssp-key/id6463717332
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
      if (!dataToProcess || !blockchains[chain]) {
        setTimeout(() => {
          displayMessage('error', t('home:err_invalid_scanned_data'));
        }, 200);
      } else {
        // check if input is xpub or transaction
        if (xpubRegex.test(dataToProcess)) {
          // xpub
          const xpubw = dataToProcess;
          handleSyncRequest(xpubw, chain);
        } else if (dataToProcess.startsWith('0')) {
          // transaction
          const rawTransaction = dataToProcess;
          handleTxRequest(rawTransaction, chain, wallet);
        } else {
          setTimeout(() => {
            displayMessage('error', t('home:err_invalid_scanned_data'));
          }, 200);
        }
      }
      setTimeout(() => {
        setShowScanner(false);
      });
      console.log(scannedData);
    } catch (error) {
      console.log(error);
      setTimeout(() => {
        displayMessage('error', t('home:err_invalid_scanned_data'));
      }, 200);
      setTimeout(() => {
        setShowScanner(false);
      });
    }
  };
  const handleRefresh = async () => {
    // todo here can be a sync request too in the future?
    try {
      console.log('refresh');
      setIsRefreshing(true);
      if (sspWalletKeyInternalIdentity) {
        // get some pending request on W-K identity
        console.log(sspWalletKeyInternalIdentity);
        const result = await axios.get(
          `https://${
            sspConfig().relay
          }/v1/action/${sspWalletKeyInternalIdentity}`,
        );
        console.log('result', result.data);
        if (result.data.action === 'tx') {
          // only this action is valid for us
          handleTxRequest(
            result.data.payload,
            result.data.chain,
            result.data.path,
            result.data.utxos,
          );
        } else if (result.data.action === 'publicnoncesrequest') {
          // only this action is valid for us
          handlePublicNoncesRequest(result.data.chain);
        }
      } else {
        // here open sync needed modal
        setSyncNeededModalOpen(true);
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
      setActivityStatus(true);
      if (status === true) {
        const rtx = rawTx;
        const rchain = activeChain as keyof cryptos;
        const rpath = txPath;
        const rUtxos = txUtxos;
        await approveTransaction(rtx, rchain, rpath, rUtxos);
      } else {
        // reject
        const rtx = rawTx;
        const rchain = activeChain;
        const rpath = txPath;
        setRawTx('');
        setActiveChain(identityChain);
        setTxPath('');
        setTxUtxos([]);
        await postAction(
          'txrejected',
          rtx,
          rchain,
          rpath,
          sspWalletKeyInternalIdentity,
        );
      }
    } catch (error) {
      console.log(error);
    } finally {
      setActivityStatus(false);
    }
  };

  const handleSynchronisationRequestAction = (status: boolean) => {
    try {
      setActivityStatus(true);
      if (status === true) {
        const xpubw = syncReq;
        const sChain = activeChain;
        if (sChain === identityChain) {
          generateAddressesForSyncIdentity(xpubw);
        } else {
          generateAddressesForActiveChain(xpubw, sChain);
        }
      } else {
        // reject
        setSyncReq('');
        setActiveChain(identityChain);
      }
    } catch (error) {
      console.log(error);
    } finally {
      setActivityStatus(false);
    }
  };

  const handlePublicNoncesRequestAction = async (status: boolean) => {
    try {
      setActivityStatus(true);
      if (status === true) {
        const rchain = activeChain as keyof cryptos;
        await approvePublicNoncesAction(rchain);
      } else {
        // reject
        const rchain = activeChain;
        setActiveChain(identityChain);
        setPublicNoncesReq('');
        await postAction(
          'publicnoncesrejected',
          '{}',
          rchain,
          '',
          sspWalletKeyInternalIdentity,
        );
      }
    } catch (error) {
      console.log(error);
    } finally {
      setActivityStatus(false);
    }
  };

  const handlePublicNoncesSharedModalAction = () => {
    console.log('public nonces modal close. Clean chain');
    setActiveChain(identityChain);
    setPublicNoncesShared(false);
  };

  const handleTxSentModalAction = () => {
    console.log('tx sent modal close. Clean TXID');
    setTxid('');
    setActiveChain(identityChain);
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
    <View style={[Layout.fill, Layout.colCenter, Layout.scrollSpaceBetween]}>
      <Navbar openSettingsTrigger={openSettings} />
      <Divider color={Colors.textGray200} />
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="always"
        extraScrollHeight={20}
        contentContainerStyle={[Layout.fullWidth, Layout.scrollSpaceBetween]}
      >
        <View
          style={[
            Gutters.largeBMargin,
            Gutters.regularTMargin,
            Layout.colCenter,
          ]}
        >
          {submittingTransaction && (
            <View
              style={[
                Layout.fill,
                Layout.relative,
                Layout.fullWidth,
                Layout.justifyContentCenter,
                Layout.alignItemsCenter,
              ]}
            >
              <Icon name="send" size={60} color={Colors.textGray400} />
              <Text
                style={[Fonts.textBold, Fonts.textRegular, Gutters.smallMargin]}
              >
                {t('home:submitting_transaction')}
              </Text>
              <ActivityIndicator
                size={'large'}
                style={[Layout.row, Gutters.regularVMargin, { height: 30 }]}
              />
            </View>
          )}
          {!submittingTransaction && !rawTx && !syncReq && !publicNoncesReq && (
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
                  style={[
                    Fonts.textBold,
                    Fonts.textRegular,
                    Gutters.smallMargin,
                  ]}
                >
                  {!sspWalletKeyInternalIdentity ||
                  !sspWalletInternalIdentity ? (
                    <>{t('home:sync_needed')}!</>
                  ) : (
                    t('home:no_pending_actions')
                  )}
                </Text>
                {(!sspWalletKeyInternalIdentity ||
                  !sspWalletInternalIdentity) && (
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
                    style={[Layout.row, Gutters.regularVMargin, { height: 30 }]}
                  />
                )}
                {!isRefreshing && (
                  <TouchableOpacity
                    onPressIn={() => handleRefresh()}
                    style={[Layout.row, Gutters.regularVMargin, { height: 30 }]}
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
          {!submittingTransaction && rawTx && xpubWallet && xpubKey && (
            <TransactionRequest
              rawTx={rawTx}
              chain={activeChain as keyof cryptos}
              utxos={txUtxos}
              activityStatus={activityStatus}
              actionStatus={handleTransactionRequestAction}
            />
          )}
          {syncReq && (
            <SyncRequest
              chain={activeChain}
              activityStatus={activityStatus}
              actionStatus={handleSynchronisationRequestAction}
            />
          )}
          {publicNoncesReq && (
            <PublicNoncesRequest
              activityStatus={activityStatus}
              actionStatus={handlePublicNoncesRequestAction}
            />
          )}
          {publicNoncesShared && (
            <PublicNoncesSuccess
              actionStatus={handlePublicNoncesSharedModalAction}
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
          {manualInputModalOpen && (
            <ManualInput actionStatus={handleManualInput} />
          )}
          {isMenuModalOpen && (
            <MenuModal actionStatus={handleMenuModalAction} />
          )}
        </View>
      </KeyboardAwareScrollView>
      {showScanner && (
        <Scanner
          onRead={(data) => handleScannedData(data)}
          onClose={handleCancelScanner}
        />
      )}
      <PoweredByFlux />
    </View>
  );
}

export default Home;
