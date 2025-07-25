import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
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
import Receive from '../../components/Receive/Receive';
import * as Keychain from 'react-native-keychain';
import Toast from 'react-native-toast-message';
import axios from 'axios';
import { sspConfig } from '@storage/ssp';
import {
  cryptos,
  utxo,
  syncSSPRelay,
  publicNonce,
  publicPrivateNonce,
  evmSigningRequest,
} from '../../types';
import { blockchains } from '@storage/blockchains';

import * as CryptoJS from 'crypto-js';

import {
  getMasterXpriv,
  getMasterXpub,
  generateMultisigAddress,
  generateInternalIdentityAddress,
  generateAddressKeypair,
  generatePublicNonce,
  deriveEVMPublicKey,
} from '../../lib/wallet';

import {
  signTransaction,
  finaliseTransaction,
  broadcastTx,
  fetchUtxos,
  signAndBroadcastEVM,
  selectPublicNonce,
} from '../../lib/constructTx';

import { continueSigningSchnorrMultisig } from '../../lib/evmSigning';

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
import { changeTheme } from '../../store/theme';
import EvmSigningRequest from '../../components/EvmSigningRequest/EvmSigningRequest';
import EvmSigningSuccess from '../../components/EvmSigningSuccess/EvmSigningSuccess';

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
  const [pNonces, setPNonces] = useState('');
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
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [evmSigningData, setEvmSigningData] =
    useState<evmSigningRequest | null>(null);
  const [evmSigningSignature, setEvmSigningSignature] = useState<string | null>(
    null,
  );
  const { xpubWallet, xpubKey, xprivKey } = useAppSelector(
    (state) => state[activeChain],
  );
  const { publicNonces } = useAppSelector((state) => state.ssp);
  const [activityStatus, setActivityStatus] = useState(false);
  const [submittingTransaction, setSubmittingTransaction] = useState(false);

  const {
    newTx,
    clearTx,
    publicNoncesRequest,
    clearPublicNoncesRequest,
    evmSigningRequest,
    clearEvmSigningRequest,
  } = useSocket();

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
      handleTxRequest(
        newTx.rawTx,
        newTx.chain as keyof cryptos,
        newTx.path,
        newTx.utxos,
      );
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
    if (evmSigningRequest) {
      console.log('[EVM Signing] Received request:', evmSigningRequest);
      setActiveChain(evmSigningRequest.chain as keyof cryptos);
      setEvmSigningData(evmSigningRequest);
    }
  }, [evmSigningRequest]);

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

  const checkXpubXpriv = () => {
    // todo loading animation on chain sync approval
    const chainToUse = activeChain;
    const blockchainConfigToUse = blockchains[chainToUse];
    if (!xpubKey || !xprivKey) {
      // just a precaution to make sure xpub and xpriv are set. Should acutally never end up here
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
          addrInfo.redeemScript || addrInfo.witnessScript || '',
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
          generatedAddress: addrInfo.address,
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
          addrInfo.redeemScript || addrInfo.witnessScript || '',
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
          generatedAddress: addrInfo.address,
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
  const postAction = async (
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
    const result = await axios.post(
      `https://${sspConfig().relay}/v1/action`,
      data,
    );
    console.log(result.data);
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
  const handleEvmSigningRequest = (data: evmSigningRequest) => {
    console.log(data);
    setActiveChain(data.chain as keyof cryptos);
    setEvmSigningData(data);
  };
  const handleSyncRequest = (xpubw: string, chain: keyof cryptos) => {
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
      // get from keychain
      // encryption key
      const encryptionKey = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });
      if (!passwordData || !encryptionKey) {
        throw new Error('Unable to decrypt stored data');
      }
      const passwordDecrypted = CryptoJS.AES.decrypt(
        passwordData.password,
        encryptionKey.password,
      );
      const passwordDecryptedString = passwordDecrypted.toString(
        CryptoJS.enc.Utf8,
      );
      const pwForEncryption = encryptionKey.password + passwordDecryptedString;
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
      try {
        await postAction(
          'publicnonces',
          JSON.stringify(pNs),
          chain,
          '',
          sspWalletKeyInternalIdentity,
        );
      } catch (error) {
        // we can ignore this error and show success message as user can copy the nonces
        displayMessage(
          'error',
          // @ts-expect-error 'error' is of type 'unknown'
          error.message ?? 'home:err_sharing_public_nonces',
        );
        console.log(error);
      }
      setPNonces(JSON.stringify(pNs));
      setPublicNoncesReq('');
      setTimeout(() => {
        setPublicNoncesShared(true); // display
      }, 100);
    } catch (error) {
      displayMessage(
        'error',
        // @ts-expect-error 'error' is of type 'unknown'
        error.message ?? 'home:err_generating_public_nonces',
      );
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
      // get from keychain
      // encryption key
      const encryptionKey = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });
      if (!passwordData || !encryptionKey) {
        throw new Error('Unable to decrypt stored data');
      }
      const passwordDecrypted = CryptoJS.AES.decrypt(
        passwordData.password,
        encryptionKey.password,
      );
      const passwordDecryptedString = passwordDecrypted.toString(
        CryptoJS.enc.Utf8,
      );
      const pwForEncryption = encryptionKey.password + passwordDecryptedString;

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
        const signedTx = signTransaction(
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
      // @ts-expect-error 'error' is of type 'unknown'
      displayMessage('error', error.message ?? 'home:err_tx_failed');
      console.log(error);
    } finally {
      setSubmittingTransaction(false);
    }
  };
  const handleManualInput = (manualInput: string) => {
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
      } else if (manualInput.startsWith('evmsigningrequest')) {
        handleEvmSigningRequest(
          JSON.parse(manualInput.replace('evmsigningrequest', '')),
        );
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
      dispatch(changeTheme({ theme: 'default', darkMode: null })); // make our theme dark
    }, 100);
  };
  const handleScannedData = (scannedData: string) => {
    try {
      // https://apps.apple.com/us/app/ssp-key/id6463717332
      const splittedInput = scannedData.split(':');
      let chain: keyof cryptos = identityChain;
      let wallet = '0-0';
      let dataToProcess = '';
      if (scannedData === 'publicnonces') {
        handlePublicNoncesRequest(identityChain);
        return;
      }
      // evmsigningrequest{chain: string, path: string, payload: string}
      if (scannedData.startsWith('evmsigningrequest')) {
        // this is a evm signing request, remove evmsigningrequest prefix
        handleEvmSigningRequest(
          JSON.parse(scannedData.replace('evmsigningrequest', '')),
        );
        return;
      }
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
        dispatch(changeTheme({ theme: 'default', darkMode: null })); // make our theme dark
      });
      console.log(scannedData);
    } catch (error) {
      console.log(error);
      setTimeout(() => {
        displayMessage('error', t('home:err_invalid_scanned_data'));
      }, 200);
      setTimeout(() => {
        setShowScanner(false);
        dispatch(changeTheme({ theme: 'default', darkMode: null })); // make our theme dark
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
          handleTxRequest(
            result.data.payload,
            result.data.chain,
            result.data.path,
            result.data.utxos,
          );
        } else if (result.data.action === 'publicnoncesrequest') {
          handlePublicNoncesRequest(result.data.chain);
        } else if (result.data.action === 'evmsigningrequest') {
          handleEvmSigningRequest(JSON.parse(result.data.payload));
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
        const rchain = activeChain;
        const rpath = txPath;
        const rUtxos = txUtxos;
        await approveTransaction(rtx, rchain, rpath, rUtxos);
      } else {
        // reject
        const rtx = rawTx;
        const rchain = activeChain;
        const rpath = txPath;
        setRawTx('');
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
        const rchain = activeChain;
        await approvePublicNoncesAction(rchain);
      } else {
        // reject
        const rchain = activeChain;
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

  const handleEvmSigningRequestAction = async (status: boolean) => {
    try {
      setActivityStatus(true);
      if (status === true) {
        await handleSignEVMAction();
      } else {
        // reject
        setEvmSigningData(null);
        await postAction(
          'evmsigningrejected',
          '{}',
          activeChain,
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
    console.log('public nonces modal close.');
    setPublicNoncesShared(false);
    setPNonces('');
  };

  const handleEvmSigningSuccessModalAction = () => {
    console.log('evm signing success modal close.');
    setEvmSigningSignature(null);
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

  const handleSyncNeededModalAction = (status: string) => {
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

  const handleReceiveModalAction = () => {
    console.log('receive modal close.');
    setReceiveModalOpen(false);
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

  const handleSignEVMAction = async () => {
    // Handle both socket-received and scanned/manual EVM signing requests requests
    if (!evmSigningData) return;

    try {
      console.log(evmSigningData);
      // EVM signing with nonce management - same as approveTransaction
      const encryptionKey = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });

      if (!passwordData || !encryptionKey) {
        throw new Error('Unable to decrypt stored data');
      }

      const passwordDecrypted = CryptoJS.AES.decrypt(
        passwordData.password,
        encryptionKey.password,
      );
      const passwordDecryptedString = passwordDecrypted.toString(
        CryptoJS.enc.Utf8,
      );
      const pwForEncryption = encryptionKey.password + passwordDecryptedString;

      // Use the same nonce management as normal transactions
      const pNs = CryptoJS.AES.decrypt(publicNonces, pwForEncryption);
      const pNsDecrypted = pNs.toString(CryptoJS.enc.Utf8);
      const pubNonces = JSON.parse(pNsDecrypted) as publicPrivateNonce[];

      // const EVMSigningRequest = {
      //   sigOne: result.sigOne,
      //   challenge: result.challenge,
      //   pubNoncesOne: result.pubNoncesOne, // this is wallet
      //   pubNoncesTwo: result.pubNoncesTwo, // this is key
      //   data: message,
      //   chain: activeChain,
      //   walletInUse: walletInUse,
      //   requestId: requestId,
      // };

      const publicNonceKey = evmSigningData.pubNoncesTwo;
      console.log(`publicNonceKey:`, publicNonceKey);

      const noncesToUse = pubNonces.find(
        (nonce) =>
          nonce.kPublic === publicNonceKey?.kPublic &&
          nonce.kTwoPublic === publicNonceKey?.kTwoPublic,
      );
      console.log(`noncesToUse:`, noncesToUse);

      if (!noncesToUse) {
        throw new Error('Nonces not found');
      }

      // crucial delete nonce from publicNonces - same as normal transactions
      const newPublicNonces = pubNonces.filter(
        (nonce: publicPrivateNonce) =>
          nonce.kPublic !== publicNonceKey?.kPublic,
      );

      // encrypt and save new publicNonces
      const stringifiedNonces = JSON.stringify(newPublicNonces);
      const encryptedNonces = CryptoJS.AES.encrypt(
        stringifiedNonces,
        pwForEncryption,
      ).toString();
      dispatch(setSspKeyPublicNonces(encryptedNonces));

      const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
      const xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);

      const splittedDerPath = evmSigningData.walletInUse.split('-');
      if (!splittedDerPath) {
        throw new Error('Invalid walletInUse');
      }
      const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
      const addressIndex = Number(splittedDerPath[1]);

      console.log(`activeChain`, activeChain);
      console.log(`typeIndex`, typeIndex);
      console.log(`addressIndex`, addressIndex);

      const keyPair = generateAddressKeypair(
        xprivKeyDecrypted,
        typeIndex,
        addressIndex,
        evmSigningData.chain as keyof cryptos,
      );

      const xpubw = CryptoJS.AES.decrypt(xpubWallet, pwForEncryption);
      const xpubKeyWalletDecrypted = xpubw.toString(CryptoJS.enc.Utf8);

      console.log(`keyPair:`, keyPair);

      console.log(`xpubWallet`, xpubKeyWalletDecrypted);

      const publicKeyWallet = deriveEVMPublicKey(
        xpubKeyWalletDecrypted,
        typeIndex,
        addressIndex,
        activeChain,
      ); // ssp key

      const result = continueSigningSchnorrMultisig(
        evmSigningData.data || '',
        keyPair,
        publicKeyWallet,
        evmSigningData.pubNoncesOne || {
          kPublic: '',
          kTwoPublic: '',
        }, // public wallet nonces
        noncesToUse, // our key nonces with pks
        evmSigningData.sigOne || '',
        evmSigningData.challenge || '',
      );
      setEvmSigningSignature(result);

      const dataToSend = {
        signature: result,
        requestId: evmSigningData.requestId,
        chain: evmSigningData.chain,
        walletInUse: evmSigningData.walletInUse,
        data: evmSigningData.data,
      };

      try {
        await postAction(
          'evmsigned',
          JSON.stringify(dataToSend),
          evmSigningData.chain,
          evmSigningData.walletInUse,
          sspWalletKeyInternalIdentity,
        );
      } catch (error) {
        // we can ignore this error and show success message as user can copy the nonces
        displayMessage(
          'error',
          // @ts-expect-error 'error' is of type 'unknown'
          error.message ?? 'home:err_sharing_public_nonces',
        );
        console.log(error);
      }

      // Send successful response - try API first, fallback to socket
      // result is the signature.
      // todo if this is wallet connect there should be some id attached
    } catch (error) {
      console.error('[EVM Signing] Error handling request:', error);
      displayMessage('error', 'Error processing request');
    } finally {
      setActiveChain(identityChain);
      setEvmSigningData(null);

      // Clear the appropriate request
      if (evmSigningRequest) {
        clearEvmSigningRequest?.();
      }
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
                style={[
                  Fonts.textBold,
                  Fonts.textCenter,
                  Fonts.textRegular,
                  Gutters.smallMargin,
                ]}
              >
                {t('home:submitting_transaction')}
              </Text>
              <ActivityIndicator
                size={'large'}
                style={[Layout.row, Gutters.regularVMargin, { height: 30 }]}
              />
            </View>
          )}
          {!submittingTransaction &&
            !rawTx &&
            !syncReq &&
            !publicNoncesReq &&
            !evmSigningData && (
              <>
                <TouchableOpacity
                  onPressIn={() => setReceiveModalOpen(true)}
                  style={[Layout.row, { height: 30, marginTop: -30 }]}
                >
                  <IconB name="qrcode" size={30} color={Colors.textGray400} />
                  <Text
                    style={[
                      Fonts.textSmall,
                      Fonts.textBold,
                      Gutters.tinyTinyTMargin,
                      Gutters.tinyTinyLMargin,
                    ]}
                  >
                    {t('common:receive')}
                  </Text>
                </TouchableOpacity>
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
                    <>
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
                      <TouchableOpacity
                        onPressIn={() =>
                          Linking.openURL('https://sspwallet.io/guide')
                        }
                      >
                        <Text
                          style={[
                            Fonts.textTiny,
                            Fonts.textCenter,
                            Gutters.regularTMargin,
                            Gutters.smallLMargin,
                            Gutters.smallRMargin,
                          ]}
                        >
                          {t('home:dont_have_ssp_wallet')}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                  {isRefreshing && (
                    <ActivityIndicator
                      size={'large'}
                      style={[
                        Layout.row,
                        Gutters.regularVMargin,
                        { height: 30 },
                      ]}
                    />
                  )}
                  {!isRefreshing && (
                    <TouchableOpacity
                      onPressIn={() => handleRefresh()}
                      style={[
                        Layout.row,
                        Gutters.regularVMargin,
                        { height: 30 },
                      ]}
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
              chain={activeChain}
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
              nonces={pNonces}
            />
          )}
          {evmSigningData && (
            <EvmSigningRequest
              activityStatus={activityStatus}
              dataToSign={evmSigningData.data || ''}
              chain={evmSigningData.chain as keyof cryptos}
              walletInUse={evmSigningData.walletInUse}
              actionStatus={handleEvmSigningRequestAction}
            />
          )}
          {evmSigningSignature && (
            <EvmSigningSuccess
              actionStatus={handleEvmSigningSuccessModalAction}
              signature={evmSigningSignature}
            />
          )}
          {txid && (
            <TxSent
              txid={txid}
              chain={activeChain}
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
              biomatricsAllowed={true}
            />
          )}
          {manualInputModalOpen && (
            <ManualInput actionStatus={handleManualInput} />
          )}
          {receiveModalOpen && (
            <Receive actionStatus={handleReceiveModalAction} />
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
