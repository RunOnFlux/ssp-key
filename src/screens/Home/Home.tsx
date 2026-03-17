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
import PublicNoncesRequest from '../../components/PublicNoncesRequest/PublicNoncesRequest';
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
  wkSigningRequest,
  vaultXpubRequest,
  vaultSigningRequest,
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
  getLibId,
} from '../../lib/wallet';
import utxolib from '@runonflux/utxo-lib';

import {
  signTransaction,
  finaliseTransaction,
  broadcastTx,
  fetchUtxos,
  signAndBroadcastEVM,
  selectPublicNonce,
} from '../../lib/constructTx';

import {
  continueSigningSchnorrMultisig,
  continueVaultSigningSchnorrMultisig,
} from '../../lib/evmSigning';
import {
  decodeVaultTransaction,
  type VaultDecodedTx,
} from '../../lib/transactions';
import { signMessage } from '../../lib/relayAuth';

import {
  setXpubKey,
  setXprivKey,
  setXpubWallet,
  setXpubWalletIdentity,
} from '../../store';

import {
  setSspWalletKeyInternalIdentity,
  setSspWalletKeyInternalIdentityWitnessScript,
  setSspWalletKeyInternalIdentityPubKey,
  setSspWalletInternalIdentity,
  setSspKeyInternalIdentity,
  setSspKeyPublicNonces,
  setSspKeyEnterprisePublicNonces,
} from '../../store/ssp';

import { useAppSelector, useAppDispatch, useRelayAuth } from '../../hooks';
import { useSocket } from '../../hooks/useSocket';
import { getFCMToken, refreshFCMToken } from '../../lib/fcmHelper';
import { changeTheme } from '../../store/theme';
import EvmSigningRequest from '../../components/EvmSigningRequest/EvmSigningRequest';
import EvmSigningSuccess from '../../components/EvmSigningSuccess/EvmSigningSuccess';
import WkSigningRequest from '../../components/WkSigningRequest/WkSigningRequest';
import VaultXpubRequest from '../../components/VaultXpubRequest/VaultXpubRequest';
import VaultSignRequest from '../../components/VaultSignRequest/VaultSignRequest';
import KeyNonceSyncRequest from '../../components/KeyNonceSyncRequest/KeyNonceSyncRequest';
import { MainScreenProps } from '../../../@types/navigation';

type Props = MainScreenProps<'Home'>;

const xpubRegex = /^([a-zA-Z]{2}ub[1-9A-HJ-NP-Za-km-z]{79,140})$/; // xpub start is the most usual, but can also be Ltub

function Home({ navigation }: Props) {
  // focusability of inputs
  const alreadyMounted = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  const {
    seedPhrase,
    sspWalletKeyInternalIdentity,
    sspWalletKeyInternalIdentityWitnessScript,
    sspWalletKeyInternalIdentityPubKey,
    sspWalletInternalIdentity,
    sspKeyInternalIdentity,
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
  const [wkSigningData, setWkSigningData] = useState<wkSigningRequest | null>(
    null,
  );
  const [vaultXpubData, setVaultXpubData] = useState<vaultXpubRequest | null>(
    null,
  );
  const [vaultSigningData, setVaultSigningData] =
    useState<vaultSigningRequest | null>(null);
  const [decodedVaultTx, setDecodedVaultTx] = useState<VaultDecodedTx | null>(
    null,
  );
  const [keyNonceSyncDialogOpen, setKeyNonceSyncDialogOpen] = useState(false);
  const { xpubWallet, xpubKey, xprivKey } = useAppSelector(
    (state) => state[activeChain],
  );
  // Get identity chain state for migration
  const identityChainState = useAppSelector((state) => state[identityChain]);
  const { publicNonces, enterprisePublicNonces } = useAppSelector(
    (state) => state.ssp,
  );
  const [activityStatus, setActivityStatus] = useState(false);
  const [submittingTransaction, setSubmittingTransaction] = useState(false);

  const {
    newTx,
    clearTx,
    publicNoncesRequest,
    clearPublicNoncesRequest,
    evmSigningRequest,
    clearEvmSigningRequest,
    wkSigningRequest: socketWkSigningRequest,
    clearWkSigningRequest,
    vaultXpubRequest: socketVaultXpubRequest,
    clearVaultXpubRequest,
    vaultSigningRequest: socketVaultSigningRequest,
    clearVaultSigningRequest,
    keyNonceSyncRequest: socketKeyNonceSyncRequest,
    clearKeyNonceSyncRequest,
  } = useSocket();
  const { createWkIdentityAuth } = useRelayAuth();

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
  }, []);

  // Ensure auth fields (witnessScript and pubKey) are generated if missing
  useEffect(() => {
    const ensureAuthFields = async () => {
      // Only run if synced but missing auth fields
      if (
        !sspWalletKeyInternalIdentity ||
        (sspWalletKeyInternalIdentityWitnessScript &&
          sspWalletKeyInternalIdentityPubKey)
      ) {
        return; // Not synced or already has auth fields
      }

      // Need xpubWallet, xpubKey, and xprivKey from identity chain
      const {
        xpubWallet: idXpubWallet,
        xpubKey: idXpubKey,
        xprivKey: idXprivKey,
      } = identityChainState || {};
      if (!idXpubWallet || !idXpubKey || !idXprivKey) {
        console.log(
          '[Auth] Missing required keys for auth field generation:',
          !idXpubWallet ? 'xpubWallet' : '',
          !idXpubKey ? 'xpubKey' : '',
          !idXprivKey ? 'xprivKey' : '',
        );
        return;
      }

      try {
        // Get decryption password
        const encryptionKey = await Keychain.getGenericPassword({
          service: 'enc_key',
        });
        const passwordData = await Keychain.getGenericPassword({
          service: 'sspkey_pw',
        });
        if (!encryptionKey || !passwordData) {
          console.log('[Auth] No encryption key or password available');
          return;
        }

        const passwordDecrypted = CryptoJS.AES.decrypt(
          passwordData.password,
          encryptionKey.password,
        );
        const pwForEncryption =
          encryptionKey.password +
          passwordDecrypted.toString(CryptoJS.enc.Utf8);

        // Decrypt xpubWallet
        const xpubWalletDecrypted = CryptoJS.AES.decrypt(
          idXpubWallet,
          pwForEncryption,
        ).toString(CryptoJS.enc.Utf8);

        // Decrypt xpubKey
        const xpubKeyDecrypted = CryptoJS.AES.decrypt(
          idXpubKey,
          pwForEncryption,
        ).toString(CryptoJS.enc.Utf8);

        // Decrypt xprivKey
        const xprivKeyDecrypted = CryptoJS.AES.decrypt(
          idXprivKey,
          pwForEncryption,
        ).toString(CryptoJS.enc.Utf8);

        // Generate multisig address for internal identity (typeIndex=10)
        const generatedIdentity = generateMultisigAddress(
          xpubWalletDecrypted,
          xpubKeyDecrypted,
          10,
          0,
          identityChain,
        );

        if (!generatedIdentity?.witnessScript) {
          console.error('[Auth] Could not generate witnessScript');
          return;
        }

        // Generate identity keypair from xprivKey
        const identityKeypair = generateAddressKeypair(
          xprivKeyDecrypted,
          10,
          0,
          identityChain,
        );

        // Store the generated auth fields
        dispatch(
          setSspWalletKeyInternalIdentityWitnessScript(
            generatedIdentity.witnessScript,
          ),
        );
        dispatch(setSspWalletKeyInternalIdentityPubKey(identityKeypair.pubKey));
        console.log('[Auth] Successfully generated auth fields');
      } catch (error) {
        console.error('[Auth] Error generating auth fields:', error);
      }
    };

    ensureAuthFields();
  }, [
    sspWalletKeyInternalIdentity,
    sspWalletKeyInternalIdentityWitnessScript,
    sspWalletKeyInternalIdentityPubKey,
    identityChainState,
    identityChain,
    dispatch,
  ]);

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
    if (socketWkSigningRequest) {
      console.log('[WK Signing] Received request:', socketWkSigningRequest);
      setWkSigningData(socketWkSigningRequest);
    }
  }, [socketWkSigningRequest]);

  useEffect(() => {
    if (socketVaultXpubRequest) {
      console.log('[Vault Xpub] Received request:', socketVaultXpubRequest);
      setVaultXpubData(socketVaultXpubRequest);
    }
  }, [socketVaultXpubRequest]);

  useEffect(() => {
    if (socketVaultSigningRequest) {
      console.log(
        '[Vault Signing] Received request for chain:',
        socketVaultSigningRequest.chain,
      );
      try {
        // Defensively parse fields that may arrive as JSON strings
        // (matching the refresh/action path parsing at handleRefresh)
        const data = { ...socketVaultSigningRequest };
        console.log(
          '[Vault Signing] Recipients type:',
          typeof data.recipients,
          'isArray:',
          Array.isArray(data.recipients),
          'length:',
          Array.isArray(data.recipients) ? data.recipients.length : 'N/A',
        );
        if (typeof data.recipients === 'string') {
          data.recipients = JSON.parse(data.recipients);
        }
        if (!Array.isArray(data.recipients)) {
          data.recipients = [];
        }
        if (typeof data.inputDetails === 'string') {
          data.inputDetails = JSON.parse(data.inputDetails);
        }
        if (typeof data.allSignerKeys === 'string') {
          data.allSignerKeys = JSON.parse(data.allSignerKeys);
        }
        if (typeof data.allSignerNonces === 'string') {
          data.allSignerNonces = JSON.parse(data.allSignerNonces);
        }
        setVaultSigningData(data);
        // Decode raw transaction independently for trustless verification
        if (data.chain) {
          const chainConf = blockchains[data.chain as keyof cryptos];
          if (chainConf?.chainType === 'evm' && data.evmUserOp) {
            // EVM: rawUnsignedTx is a hash, decode from evmUserOp instead
            try {
              const parsed =
                typeof data.evmUserOp === 'string'
                  ? JSON.parse(data.evmUserOp)
                  : data.evmUserOp;
              const decodableJson = JSON.stringify({
                userOpRequest: parsed,
              });
              setDecodedVaultTx(
                decodeVaultTransaction(
                  decodableJson,
                  data.chain as keyof cryptos,
                ),
              );
            } catch {
              setDecodedVaultTx({
                sender: '',
                recipients: [],
                fee: '0',
                error: 'Failed to parse EVM UserOp data',
              });
            }
          } else if (data.rawUnsignedTx) {
            // UTXO: decode from raw TX hex, pass first input scripts for sender derivation
            const inputs = Array.isArray(data.inputDetails)
              ? data.inputDetails
              : [];
            const inputAmounts = inputs.map(
              (inp: { amount?: string }) => inp.amount || '0',
            );
            const firstInput = inputs[0] as
              | { witnessScript?: string; redeemScript?: string }
              | undefined;
            setDecodedVaultTx(
              decodeVaultTransaction(
                data.rawUnsignedTx,
                data.chain as keyof cryptos,
                inputAmounts,
                firstInput,
              ),
            );
          }
        }
      } catch {
        displayMessage('error', t('home:err_invalid_request'), 5000);
      }
    }
  }, [socketVaultSigningRequest]);

  useEffect(() => {
    if (socketKeyNonceSyncRequest) {
      console.log('[Enterprise Nonces] Key nonce sync request received');
      setKeyNonceSyncDialogOpen(true);
    }
  }, [socketKeyNonceSyncRequest]);

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
        // sspKeyInternalIdentity is already set from identity chain sync
        // Note: may be undefined for SSPs synced before this field was stored
        const syncData: syncSSPRelay = {
          chain,
          walletIdentity: sspWalletInternalIdentity,
          keyXpub: xpubKeyDecrypted,
          wkIdentity: sspWalletKeyInternalIdentity,
          generatedAddress: addrInfo.address,
          keyToken: await getFCMToken(),
          // Include additional fields for verification
          walletXpub: suppliedXpubWallet,
          keyIdentity: sspKeyInternalIdentity,
          // Scripts from first address (index 0) - not strictly needed but extra assurance
          redeemScript: addrInfo.redeemScript,
          witnessScript: addrInfo.witnessScript,
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
        console.log('syncData', syncData);
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
        const xprk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
        const xprivKeyDecrypted = xprk.toString(CryptoJS.enc.Utf8);
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
          !generatedSspWalletKeyInternalIdentity.address ||
          !generatedSspWalletKeyInternalIdentity.witnessScript
        ) {
          throw new Error(
            'Could not generate SSP Wallet Key internal identity',
          );
        }
        // Generate identity keypair predictively from xprivKey
        const identityKeypair = generateAddressKeypair(
          xprivKeyDecrypted,
          10,
          0,
          identityChain,
        );
        dispatch(
          setSspWalletKeyInternalIdentity(
            generatedSspWalletKeyInternalIdentity.address,
          ),
        );
        dispatch(
          setSspWalletKeyInternalIdentityWitnessScript(
            generatedSspWalletKeyInternalIdentity.witnessScript,
          ),
        );
        dispatch(setSspWalletKeyInternalIdentityPubKey(identityKeypair.pubKey));
        // generate ssp wallet identity
        const generatedSspWalletInternalIdentity =
          generateInternalIdentityAddress(suppliedXpubWallet, identityChain);
        if (!generatedSspWalletInternalIdentity) {
          throw new Error('Could not generate SSP Wallet internal identity');
        }
        dispatch(
          setSspWalletInternalIdentity(generatedSspWalletInternalIdentity),
        );
        // Generate key's internal identity (single-sig from key's xpub)
        const keyInternalIdentity = generateInternalIdentityAddress(
          xpubKeyDecrypted,
          identityChain,
        );
        if (keyInternalIdentity) {
          dispatch(setSspKeyInternalIdentity(keyInternalIdentity));
        }
        // tell ssp relay that we are synced, post data to ssp sync
        const syncData: syncSSPRelay = {
          chain: identityChain,
          walletIdentity: generatedSspWalletInternalIdentity,
          keyXpub: xpubKeyDecrypted,
          wkIdentity: generatedSspWalletKeyInternalIdentity.address,
          generatedAddress: addrInfo.address,
          keyToken: await getFCMToken(),
          // Include additional fields for verification
          walletXpub: suppliedXpubWallet,
          keyIdentity: keyInternalIdentity,
          // Scripts from first address (index 0) - not strictly needed but extra assurance
          redeemScript: addrInfo.redeemScript,
          witnessScript: addrInfo.witnessScript,
        };
        console.log('syncData', syncData);
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
    const data: Record<string, unknown> = {
      action,
      payload,
      chain,
      path,
      wkIdentity,
    };

    // Add authentication if available (includes hash of request body)
    try {
      const auth = await createWkIdentityAuth('action', wkIdentity, data);
      if (auth) {
        Object.assign(data, auth);
      } else {
        console.warn(
          '[postAction] Auth not available, sending without signature',
        );
      }
    } catch (error) {
      console.error('[postAction] Error creating auth:', error);
      // Continue without auth for backward compatibility
    }

    const result = await axios.post(
      `https://${sspConfig().relay}/v1/action`,
      data,
    );
    console.log('[postAction] response:', result.data);
  };
  const postSyncToken = async (token: string, wkIdentity: string) => {
    // post fcm token tied to wkIdentity
    const data: Record<string, unknown> = {
      keyToken: token,
      wkIdentity,
    };

    // Add authentication if available (includes hash of request body)
    try {
      const auth = await createWkIdentityAuth('token', wkIdentity, data);
      if (auth) {
        Object.assign(data, auth);
      } else {
        console.warn(
          '[postSyncToken] Auth not available, sending without signature',
        );
      }
    } catch (error) {
      console.error('[postSyncToken] Error creating auth:', error);
      // Continue without auth for backward compatibility
    }

    axios
      .post(`https://${sspConfig().relay}/v1/token`, data)
      .then((res: { data: unknown }) => {
        console.log(res.data);
      })
      .catch((error: Error) => {
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
    console.log('[EVM Signing] handleEvmSigningRequest:', data);
    setActiveChain(data.chain as keyof cryptos);
    setEvmSigningData(data);
  };
  const handleWkSigningRequest = (data: wkSigningRequest) => {
    console.log('[WK Sign] Request received:', data);
    setWkSigningData(data);
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
  const handleManualInput = (inputValue: string) => {
    try {
      const manualInput = inputValue?.trim() || '';
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
        try {
          const evmData = JSON.parse(
            manualInput.replace('evmsigningrequest', ''),
          );
          handleEvmSigningRequest(evmData);
          setTimeout(() => {
            setIsManualInputModalOpen(false);
          });
        } catch {
          displayMessage('error', t('home:err_invalid_manual_input'));
        }
      } else if (manualInput.startsWith('wksigningrequest')) {
        try {
          const jsonPart = manualInput.substring('wksigningrequest'.length);
          console.log(
            '[WK Manual Input] JSON part:',
            jsonPart.substring(0, 100),
          );
          const wkData = JSON.parse(jsonPart);
          handleWkSigningRequest(wkData);
          setTimeout(() => {
            setIsManualInputModalOpen(false);
          });
        } catch (error) {
          console.error('[WK Manual Input] Parse error:', error);
          displayMessage('error', t('home:err_invalid_manual_input'));
        }
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
  const handleScannedData = (rawScannedData: string) => {
    try {
      const scannedData = rawScannedData?.trim() || '';
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
        try {
          const evmData = JSON.parse(
            scannedData.replace('evmsigningrequest', ''),
          );
          handleEvmSigningRequest(evmData);
        } catch {
          setTimeout(() => {
            displayMessage('error', t('home:err_invalid_scanned_data'));
          }, 200);
        }
        return;
      }
      // wksigningrequest{...payload}
      if (scannedData.startsWith('wksigningrequest')) {
        try {
          const jsonPart = scannedData.substring('wksigningrequest'.length);
          console.log('[WK QR Scan] JSON part:', jsonPart.substring(0, 100));
          const wkData = JSON.parse(jsonPart);
          handleWkSigningRequest(wkData);
        } catch (error) {
          console.error('[WK QR Scan] Parse error:', error);
          setTimeout(() => {
            displayMessage('error', t('home:err_invalid_scanned_data'));
          }, 200);
        }
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
  const nonceReplenishInProgressRef = useRef(false);

  /**
   * Check enterprise nonce pool and replenish if below threshold.
   * Generates nonces locally, stores private parts in Keychain,
   * submits public parts to relay.
   *
   * @param forceReplace - If true, delete all existing nonces and generate a fresh full set.
   *   Used by the manual "Sync Nonces" action triggered from the enterprise app.
   */
  const checkAndReplenishEnterpriseNonces = async (forceReplace = false) => {
    if (!sspWalletKeyInternalIdentity) return;
    if (nonceReplenishInProgressRef.current) {
      if (!forceReplace) return;
      // Force replace: wait for background replenish to finish before proceeding
      const maxWait = 30_000;
      const start = Date.now();
      while (
        nonceReplenishInProgressRef.current &&
        Date.now() - start < maxWait
      ) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (nonceReplenishInProgressRef.current) return; // timed out
    }
    nonceReplenishInProgressRef.current = true;
    try {
      const TARGET_COUNT = 50;

      // Check server-side pool status
      let serverAvailable = 0;
      try {
        const statusRes = await axios.get(
          `https://${sspConfig().relay}/v1/nonces/status/${sspWalletKeyInternalIdentity}`,
        );
        const poolData = statusRes.data?.data;
        if (!forceReplace && !poolData?.replenishNeeded?.key) return;
        serverAvailable = poolData?.key?.available ?? 0;
      } catch {
        // If status check fails, proceed with replenishment based on local count
      }

      // Get encryption key for local storage
      const encryptionKey = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });
      if (!encryptionKey || !passwordData) return;

      const passwordDecrypted = CryptoJS.AES.decrypt(
        passwordData.password,
        encryptionKey.password,
      );
      const pwForEncryption =
        encryptionKey.password + passwordDecrypted.toString(CryptoJS.enc.Utf8);

      // Load existing enterprise nonces from Redux store
      let existingNonces: publicPrivateNonce[] = [];
      try {
        if (enterprisePublicNonces) {
          const decrypted = CryptoJS.AES.decrypt(
            enterprisePublicNonces,
            pwForEncryption,
          );
          existingNonces = JSON.parse(
            decrypted.toString(CryptoJS.enc.Utf8),
          ) as publicPrivateNonce[];
        }
      } catch {
        // No existing nonces or corrupt data — start fresh
        existingNonces = [];
      }

      if (forceReplace) {
        // Force replace: purge ALL server nonces and clear local nonces
        try {
          await axios.post(`https://${sspConfig().relay}/v1/nonces/reconcile`, {
            wkIdentity: sspWalletKeyInternalIdentity,
            source: 'key',
            localNonces: [], // empty = purge all server nonces
          });
        } catch {
          // Best-effort purge
        }
        existingNonces = [];
        serverAvailable = 0;
      } else {
        // Reconcile: tell server which nonces we actually have locally.
        // This purges server-side 'available' nonces that we don't have
        // (e.g. local storage cleared, app reinstalled).
        if (existingNonces.length > 0 || serverAvailable > 0) {
          try {
            const localPublicKeys = existingNonces.map((n) => ({
              kPublic: n.kPublic,
              kTwoPublic: n.kTwoPublic,
            }));
            const reconcileRes = await axios.post(
              `https://${sspConfig().relay}/v1/nonces/reconcile`,
              {
                wkIdentity: sspWalletKeyInternalIdentity,
                source: 'key',
                localNonces: localPublicKeys,
              },
            );
            const purged =
              (reconcileRes.data as { data?: { purged?: number } } | undefined)
                ?.data?.purged ?? 0;
            if (purged > 0) {
              console.log(
                `[Enterprise Nonces] Key: Purged ${purged} orphaned server nonces`,
              );
              serverAvailable = Math.max(serverAvailable - purged, 0);
            }
          } catch {
            // Reconcile is best-effort — don't block replenishment
          }
        }
      }

      // Generate based on what the SERVER needs, not just local count.
      // Handles the case where server nonces were deleted but local still has them.
      const toGenerate = Math.max(
        TARGET_COUNT - existingNonces.length,
        TARGET_COUNT - serverAvailable,
        0,
      );
      if (toGenerate <= 0) return;

      // Generate new nonces
      const newNonces: publicPrivateNonce[] = [];
      for (let i = 0; i < toGenerate; i++) {
        newNonces.push(generatePublicNonce());
      }

      // Submit public parts to relay FIRST (if this fails, don't save locally)
      const publicParts = newNonces.map((n) => ({
        kPublic: n.kPublic,
        kTwoPublic: n.kTwoPublic,
      }));
      await axios.post(`https://${sspConfig().relay}/v1/nonces`, {
        wkIdentity: sspWalletKeyInternalIdentity,
        source: 'key',
        nonces: publicParts,
      });

      // Merge and store locally (encrypted in Redux, persisted via MMKV)
      const allNonces = [...existingNonces, ...newNonces];
      const encryptedNonces = CryptoJS.AES.encrypt(
        JSON.stringify(allNonces),
        pwForEncryption,
      ).toString();
      dispatch(setSspKeyEnterprisePublicNonces(encryptedNonces));

      console.log(
        `[Enterprise Nonces] Key: Generated and submitted ${toGenerate} nonces (server had ${serverAvailable}, local had ${existingNonces.length})`,
      );
    } catch (error) {
      // Non-critical — don't block Key functionality
      console.log('[Enterprise Nonces] Key replenish error:', error);
    } finally {
      nonceReplenishInProgressRef.current = false;
    }
  };

  const handleRefresh = async () => {
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
          try {
            const evmData = JSON.parse(result.data.payload);
            handleEvmSigningRequest(evmData);
          } catch {
            displayMessage('error', t('home:err_invalid_request'));
          }
        } else if (result.data.action === 'wksigningrequest') {
          try {
            const wkData = JSON.parse(result.data.payload);
            handleWkSigningRequest(wkData);
          } catch {
            displayMessage('error', t('home:err_invalid_request'));
          }
        } else if (result.data.action === 'enterprisevaultsign') {
          try {
            const vaultSignData = JSON.parse(result.data.payload);
            console.log(
              '[Vault Signing] handleRefresh recipients type:',
              typeof vaultSignData.recipients,
              'isArray:',
              Array.isArray(vaultSignData.recipients),
              'length:',
              Array.isArray(vaultSignData.recipients)
                ? vaultSignData.recipients.length
                : 'N/A',
            );
            // Defensively parse fields that may arrive as JSON strings instead of arrays
            // (e.g. from older wallet versions that double-stringified the payload)
            if (typeof vaultSignData.recipients === 'string') {
              vaultSignData.recipients = JSON.parse(vaultSignData.recipients);
            }
            if (!Array.isArray(vaultSignData.recipients)) {
              vaultSignData.recipients = [];
            }
            if (typeof vaultSignData.inputDetails === 'string') {
              vaultSignData.inputDetails = JSON.parse(
                vaultSignData.inputDetails,
              );
            }
            if (typeof vaultSignData.allSignerKeys === 'string') {
              vaultSignData.allSignerKeys = JSON.parse(
                vaultSignData.allSignerKeys,
              );
            }
            if (typeof vaultSignData.allSignerNonces === 'string') {
              vaultSignData.allSignerNonces = JSON.parse(
                vaultSignData.allSignerNonces,
              );
            }
            setVaultSigningData(vaultSignData);
            // Decode raw transaction independently for trustless verification
            if (vaultSignData.chain) {
              const chainConf =
                blockchains[vaultSignData.chain as keyof cryptos];
              if (chainConf?.chainType === 'evm' && vaultSignData.evmUserOp) {
                // EVM: rawUnsignedTx is a hash, decode from evmUserOp instead
                try {
                  const parsed =
                    typeof vaultSignData.evmUserOp === 'string'
                      ? JSON.parse(vaultSignData.evmUserOp)
                      : vaultSignData.evmUserOp;
                  const decodableJson = JSON.stringify({
                    userOpRequest: parsed,
                  });
                  setDecodedVaultTx(
                    decodeVaultTransaction(
                      decodableJson,
                      vaultSignData.chain as keyof cryptos,
                    ),
                  );
                } catch {
                  setDecodedVaultTx({
                    sender: '',
                    recipients: [],
                    fee: '0',
                    error: 'Failed to parse EVM UserOp data',
                  });
                }
              } else if (vaultSignData.rawUnsignedTx) {
                // UTXO: decode from raw TX hex, pass first input scripts for sender derivation
                const inputs = Array.isArray(vaultSignData.inputDetails)
                  ? vaultSignData.inputDetails
                  : [];
                const inputAmounts = inputs.map(
                  (inp: { amount?: string }) => inp.amount || '0',
                );
                const firstInput = inputs[0] as
                  | { witnessScript?: string; redeemScript?: string }
                  | undefined;
                setDecodedVaultTx(
                  decodeVaultTransaction(
                    vaultSignData.rawUnsignedTx,
                    vaultSignData.chain as keyof cryptos,
                    inputAmounts,
                    firstInput,
                  ),
                );
              }
            }
          } catch {
            displayMessage('error', t('home:err_invalid_request'));
          }
        } else if (result.data.action === 'enterprisevaultxpub') {
          try {
            const vaultData = JSON.parse(result.data.payload);
            setVaultXpubData(vaultData);
          } catch {
            displayMessage('error', t('home:err_invalid_request'));
          }
        } else if (result.data.action === 'enterprisekeynoncesync') {
          setKeyNonceSyncDialogOpen(true);
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
      // Non-blocking: replenish enterprise nonces on every refresh
      if (sspWalletKeyInternalIdentity) {
        checkAndReplenishEnterpriseNonces().catch((e) =>
          console.log('[Enterprise Nonces] check error:', e),
        );
      }
    }
  };

  const handleRestore = () => {
    setIsMenuModalOpen(false);
    navigation.navigate('Restore');
  };

  const handleKeyNonceSyncAction = async (approved: boolean) => {
    setKeyNonceSyncDialogOpen(false);
    clearKeyNonceSyncRequest?.();

    if (!approved) {
      // User rejected — notify wallet
      await postAction(
        'enterprisekeynoncesyncrejected',
        'enterprisekeynoncesyncrejected',
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      ).catch(() => {});
      return;
    }

    try {
      displayMessage('info', t('home:enterprise_nonce_sync_started'));
      await checkAndReplenishEnterpriseNonces(true);
      displayMessage('success', t('home:enterprise_nonce_sync_success'));
      await postAction(
        'enterprisekeynoncesynced',
        'enterprisekeynoncesynced',
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      );
    } catch {
      displayMessage('error', t('home:enterprise_nonce_sync_failed'));
      await postAction(
        'enterprisekeynoncesyncrejected',
        'enterprisekeynoncesyncrejected',
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      ).catch(() => {});
    }
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
        clearEvmSigningRequest?.();
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

  const handleWkSigningRequestAction = async (status: boolean) => {
    try {
      setActivityStatus(true);
      if (status === true) {
        await handleSignWkAction();
      } else {
        // reject
        setWkSigningData(null);
        clearWkSigningRequest?.();
        await postAction(
          'wksigningrejected',
          '{}',
          identityChain,
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

  const handleSignWkAction = async () => {
    if (!wkSigningData) return;

    try {
      // Get decryption keys from keychain
      const encryptionKey = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });

      if (!passwordData || !encryptionKey) {
        throw new Error('Unable to decrypt stored data');
      }

      // Decrypt password
      const passwordDecrypted = CryptoJS.AES.decrypt(
        passwordData.password,
        encryptionKey.password,
      );
      const passwordDecryptedString = passwordDecrypted.toString(
        CryptoJS.enc.Utf8,
      );
      const pwForEncryption = encryptionKey.password + passwordDecryptedString;

      // Get the identity chain state
      const { xprivKey: idXprivKey } = identityChainState || {};
      if (!idXprivKey) {
        throw new Error('xprivKey not available');
      }

      // Decrypt xpriv for signing
      const xprivDecrypted = CryptoJS.AES.decrypt(idXprivKey, pwForEncryption);
      const xprivKeyDecrypted = xprivDecrypted.toString(CryptoJS.enc.Utf8);
      if (!xprivKeyDecrypted) {
        throw new Error('Failed to decrypt xprivKey');
      }

      // Generate identity keypair for signing (typeIndex=10 for internal identity)
      const identityKeypair = generateAddressKeypair(
        xprivKeyDecrypted,
        10,
        0,
        identityChain,
      );

      // Sign the message using Bitcoin message signing
      const signature = signMessage(
        wkSigningData.message,
        identityKeypair.privKey,
        identityChain,
      );

      // Create the response payload
      const responsePayload = {
        keySignature: signature,
        keyPubKey: sspWalletKeyInternalIdentityPubKey,
        requestId: wkSigningData.requestId,
        message: wkSigningData.message,
      };

      // Post 'wksigned' action to relay
      await postAction(
        'wksigned',
        JSON.stringify(responsePayload),
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      );

      displayMessage('success', t('home:wk_signing_success'));
    } catch (error) {
      console.error('[WK Signing] Error:', error);
      displayMessage('error', t('home:err_signing_failed'));
    } finally {
      setWkSigningData(null);
      clearWkSigningRequest?.();
    }
  };

  const handleVaultXpubRequestAction = async (status: boolean) => {
    try {
      setActivityStatus(true);
      if (status === true) {
        await handleVaultXpubAction();
      } else {
        // reject
        setVaultXpubData(null);
        clearVaultXpubRequest?.();
        await postAction(
          'enterprisevaultxpubrejected',
          '{}',
          identityChain,
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

  const handleVaultXpubAction = async () => {
    if (!vaultXpubData) return;

    // Hoist sensitive vars outside try so they can be cleared in catch
    let pwForEncryption = '';
    let mnemonicPhrase = '';
    let xprivKeyDecrypted = '';

    try {
      // Get decryption keys from keychain
      const encryptionKey = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });

      if (!passwordData || !encryptionKey) {
        throw new Error('Unable to decrypt stored data');
      }

      // Decrypt password
      const passwordDecrypted = CryptoJS.AES.decrypt(
        passwordData.password,
        encryptionKey.password,
      );
      const passwordDecryptedString = passwordDecrypted.toString(
        CryptoJS.enc.Utf8,
      );
      pwForEncryption = encryptionKey.password + passwordDecryptedString;

      // Decrypt mnemonic seed phrase
      const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
      mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);

      if (!mnemonicPhrase) {
        throw new Error('Failed to decrypt mnemonic');
      }

      // Determine chain config for the requested chain
      const vaultChain = vaultXpubData.chain as keyof cryptos;
      const blockchainConfig = blockchains[vaultChain];
      if (!blockchainConfig) {
        throw new Error('Unsupported chain: ' + vaultXpubData.chain);
      }

      // Derive xpub at m/48'/coin'/orgIndex'/scriptType'
      const vaultXpub = getMasterXpub(
        mnemonicPhrase,
        48,
        blockchainConfig.slip,
        vaultXpubData.orgIndex,
        blockchainConfig.scriptType,
        vaultChain,
      );

      // Sign the keyXpub with identity key for verification
      const { xprivKey: idXprivKey } = identityChainState || {};
      if (!idXprivKey) {
        throw new Error('xprivKey not available');
      }
      const xprivDecrypted = CryptoJS.AES.decrypt(idXprivKey, pwForEncryption);
      xprivKeyDecrypted = xprivDecrypted.toString(CryptoJS.enc.Utf8);
      if (!xprivKeyDecrypted) {
        throw new Error('Failed to decrypt xprivKey');
      }
      const identityKeypair = generateAddressKeypair(
        xprivKeyDecrypted,
        10,
        0,
        identityChain,
      );
      const xpubMessage = `SSP_VAULT_XPUB:key:${vaultXpub}:${vaultXpubData.chain}:${String(vaultXpubData.orgIndex)}`;
      const keyXpubSignature = signMessage(
        xpubMessage,
        identityKeypair.privKey,
        identityChain,
      );

      // Clear sensitive key material
      identityKeypair.privKey = '';
      xprivKeyDecrypted = '';
      mnemonicPhrase = '';
      pwForEncryption = '';

      // Build response payload
      const responsePayload = {
        xpubKey: vaultXpub,
        keyXpubSignature,
        requestId: vaultXpubData.requestId,
        chain: vaultXpubData.chain,
        orgIndex: vaultXpubData.orgIndex,
      };

      // Post 'enterprisevaultxpubsigned' action to relay
      await postAction(
        'enterprisevaultxpubsigned',
        JSON.stringify(responsePayload),
        vaultXpubData.chain,
        '',
        sspWalletKeyInternalIdentity,
      );

      displayMessage('success', t('home:vault_xpub_success'));
    } catch (error) {
      // Clear sensitive key material on error path
      xprivKeyDecrypted = '';
      mnemonicPhrase = '';
      pwForEncryption = '';
      console.error('[Vault Xpub] Error:', error);
      displayMessage('error', t('home:err_vault_xpub_failed'));
    } finally {
      setVaultXpubData(null);
      clearVaultXpubRequest?.();
    }
  };

  const handleVaultSigningRequestAction = async (status: boolean) => {
    try {
      setActivityStatus(true);
      if (status === true) {
        await handleVaultSignAction();
      } else {
        // reject
        setVaultSigningData(null);
        setDecodedVaultTx(null);
        clearVaultSigningRequest?.();
        await postAction(
          'enterprisevaultsignrejected',
          '{}',
          identityChain,
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

  const handleVaultSignAction = async () => {
    if (!vaultSigningData) return;

    // Hoist sensitive vars outside try so they can be cleared in catch/finally
    let vaultXpriv = '';
    let pwForEncryption = '';
    let mnemonicPhrase = '';

    try {
      // Get decryption keys from keychain
      const encryptionKey = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });

      if (!passwordData || !encryptionKey) {
        throw new Error('Unable to decrypt stored data');
      }

      // Decrypt password
      const passwordDecrypted = CryptoJS.AES.decrypt(
        passwordData.password,
        encryptionKey.password,
      );
      const passwordDecryptedString = passwordDecrypted.toString(
        CryptoJS.enc.Utf8,
      );
      pwForEncryption = encryptionKey.password + passwordDecryptedString;

      // Decrypt mnemonic seed phrase
      const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
      mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);

      if (!mnemonicPhrase) {
        throw new Error('Failed to decrypt mnemonic');
      }

      // Determine chain config for the requested chain
      const vaultChain = vaultSigningData.chain as keyof cryptos;
      const blockchainConfig = blockchains[vaultChain];
      if (!blockchainConfig) {
        throw new Error('Unsupported chain: ' + vaultSigningData.chain);
      }

      // Derive xpriv at m/48'/coin'/orgIndex'/scriptType'
      vaultXpriv = getMasterXpriv(
        mnemonicPhrase,
        48,
        blockchainConfig.slip,
        vaultSigningData.orgIndex,
        blockchainConfig.scriptType,
        vaultChain,
      );

      // Clear mnemonic immediately — no longer needed
      mnemonicPhrase = '';
      // NOTE: pwForEncryption is still needed for nonce decryption/encryption below

      // Key's public key for this vault — set during signing
      let keyPubKey = '';

      // EVM vault signing: use enterprise nonce for Schnorr partial signature
      const isEvmChain = blockchainConfig.chainType === 'evm';
      let usedEnterpriseNonce: publicPrivateNonce | null = null;

      if (isEvmChain && vaultSigningData.reservedNonce) {
        // Load enterprise nonces from Redux store
        let enterpriseNonces: publicPrivateNonce[] = [];
        try {
          if (enterprisePublicNonces) {
            const decrypted = CryptoJS.AES.decrypt(
              enterprisePublicNonces,
              pwForEncryption,
            );
            enterpriseNonces = JSON.parse(
              decrypted.toString(CryptoJS.enc.Utf8),
            ) as publicPrivateNonce[];
          }
        } catch {
          throw new Error('Failed to decrypt enterprise nonces');
        }

        if (enterpriseNonces.length === 0) {
          throw new Error(
            'No enterprise nonces available. Please sync your SSP Key to generate nonces.',
          );
        }

        // Find the reserved nonce by matching public parts
        const reservedNonce = vaultSigningData.reservedNonce;
        let matchIdx = enterpriseNonces.findIndex(
          (n) =>
            n.kPublic === reservedNonce.kPublic &&
            n.kTwoPublic === reservedNonce.kTwoPublic,
        );
        if (matchIdx === -1 && enterpriseNonces.length > 0) {
          // Retry after short delay — storage may need a moment
          console.log(
            '[Vault Signing] Nonce not found on first try, retrying in 2s…',
          );
          await new Promise((r) => setTimeout(r, 2000));
          // Reload from Redux store
          try {
            if (enterprisePublicNonces) {
              const retryDecrypted = CryptoJS.AES.decrypt(
                enterprisePublicNonces,
                pwForEncryption,
              );
              enterpriseNonces = JSON.parse(
                retryDecrypted.toString(CryptoJS.enc.Utf8),
              ) as publicPrivateNonce[];
            }
          } catch {
            // Keep existing nonces from first attempt
          }
          matchIdx = enterpriseNonces.findIndex(
            (n) =>
              n.kPublic === reservedNonce.kPublic &&
              n.kTwoPublic === reservedNonce.kTwoPublic,
          );
        }
        if (matchIdx === -1) {
          const localPrefixes = enterpriseNonces
            .slice(0, 5)
            .map((n) => n.kPublic.slice(0, 8))
            .join(', ');
          console.log(
            `[Vault Signing] NONCE MISMATCH — looking for ${reservedNonce.kPublic.slice(0, 8)}, local pool (${enterpriseNonces.length}): [${localPrefixes}…]`,
          );
          throw new Error(
            'Reserved nonce not found locally. Nonces may be out of sync. Please sync nonces and recreate the proposal.',
          );
        }
        usedEnterpriseNonce = enterpriseNonces[matchIdx];

        // Delete used nonce from local store immediately (never reuse)
        enterpriseNonces.splice(matchIdx, 1);
        const encryptedNonces = CryptoJS.AES.encrypt(
          JSON.stringify(enterpriseNonces),
          pwForEncryption,
        ).toString();
        dispatch(setSspKeyEnterprisePublicNonces(encryptedNonces));
      }

      // Parse M-of-N signing arrays (sent as JSON strings from wallet)
      let parsedAllSignerKeys: string[] | undefined;
      let parsedAllSignerNonces:
        | Array<{ kPublic: string; kTwoPublic: string }>
        | undefined;
      if (vaultSigningData.allSignerKeys) {
        parsedAllSignerKeys =
          typeof vaultSigningData.allSignerKeys === 'string'
            ? (JSON.parse(
                vaultSigningData.allSignerKeys as unknown as string,
              ) as string[])
            : vaultSigningData.allSignerKeys;
      }
      if (vaultSigningData.allSignerNonces) {
        parsedAllSignerNonces =
          typeof vaultSigningData.allSignerNonces === 'string'
            ? (JSON.parse(
                vaultSigningData.allSignerNonces as unknown as string,
              ) as Array<{ kPublic: string; kTwoPublic: string }>)
            : vaultSigningData.allSignerNonces;
      }

      // Parse inputDetails from JSON string (wallet sends as serialized JSON in relay payload)
      const parsedInputDetails: Array<{
        index: number;
        addressIndex: number;
        witnessScript?: string;
        redeemScript?: string;
        amount?: string;
      }> =
        typeof vaultSigningData.inputDetails === 'string'
          ? (JSON.parse(vaultSigningData.inputDetails) as Array<{
              index: number;
              addressIndex: number;
              witnessScript?: string;
              redeemScript?: string;
              amount?: string;
            }>)
          : vaultSigningData.inputDetails;

      if (
        isEvmChain &&
        usedEnterpriseNonce &&
        vaultSigningData.sigOne &&
        parsedAllSignerKeys &&
        parsedAllSignerNonces
      ) {
        // EVM: Complete Schnorr multi-party signing
        // Derive keypair at the transaction's source address index
        const evmAddressIndex = parsedInputDetails[0]?.addressIndex ?? 0;
        const signingKeypair = generateAddressKeypair(
          vaultXpriv,
          vaultSigningData.vaultIndex,
          evmAddressIndex,
          vaultChain,
        );
        keyPubKey = signingKeypair.pubKey;

        const vaultSchnorrResult = continueVaultSigningSchnorrMultisig(
          vaultSigningData.rawUnsignedTx,
          signingKeypair,
          usedEnterpriseNonce,
          parsedAllSignerKeys,
          parsedAllSignerNonces,
          vaultSigningData.sigOne,
        );

        // Clear EVM signing keypair private key
        signingKeypair.privKey = '';

        // Build response with signerContribution + challenge for wallet to forward
        const responsePayload: Record<string, unknown> = {
          signerContribution: vaultSchnorrResult.signerContribution,
          challenge: vaultSchnorrResult.challenge,
          keyPubKey,
          requestId: vaultSigningData.requestId,
        };

        if (usedEnterpriseNonce) {
          responsePayload.usedNonce = {
            kPublic: usedEnterpriseNonce.kPublic,
            kTwoPublic: usedEnterpriseNonce.kTwoPublic,
          };
        }

        await postAction(
          'enterprisevaultsigned',
          JSON.stringify(responsePayload),
          vaultSigningData.chain,
          '',
          sspWalletKeyInternalIdentity,
        );

        // Clear sensitive key material
        vaultXpriv = '';
        pwForEncryption = '';

        displayMessage('success', t('home:vault_sign_success'));
        return; // Early return — EVM vault response already sent (finally handles cleanup)
      } else if (isEvmChain) {
        // EVM chain but missing Schnorr data — cannot sign
        const missing = [];
        if (!usedEnterpriseNonce) missing.push('nonce');
        if (!vaultSigningData.sigOne) missing.push('sigOne');
        if (!parsedAllSignerKeys) missing.push('signerKeys');
        if (!parsedAllSignerNonces) missing.push('signerNonces');
        throw new Error(`Missing Schnorr signing data: ${missing.join(', ')}`);
      } else {
        // UTXO: SIGHASH-based signing via TransactionBuilder
        // Load the wallet-signed TX and add Key's signatures on top
        const walletSignedHex = vaultSigningData.walletSignedHex;
        if (!walletSignedHex) {
          throw new Error(
            'Missing wallet-signed TX hex for UTXO vault signing',
          );
        }

        const libID = getLibId(vaultChain);
        const network = utxolib.networks[libID];

        // Determine hashType (BCH uses SIGHASH_BITCOINCASHBIP143)
        let hashType = utxolib.Transaction.SIGHASH_ALL;
        if (blockchainConfig.hashType) {
          hashType =
            utxolib.Transaction.SIGHASH_ALL |
            utxolib.Transaction.SIGHASH_BITCOINCASHBIP143;
        }

        // Parse wallet-signed TX into TransactionBuilder
        const txb = utxolib.TransactionBuilder.fromTransaction(
          utxolib.Transaction.fromHex(walletSignedHex, network),
          network,
        );

        // Validate input details match TX inputs
        if (parsedInputDetails.length === 0) {
          throw new Error('No input details provided for UTXO vault signing');
        }
        if (parsedInputDetails.length !== txb.inputs.length) {
          throw new Error(
            `Input details count (${parsedInputDetails.length}) does not match transaction inputs (${txb.inputs.length})`,
          );
        }

        // Sign each input with Key's per-address keypair
        for (let i = 0; i < parsedInputDetails.length; i++) {
          const input = parsedInputDetails[i];
          const signingKeypair = generateAddressKeypair(
            vaultXpriv,
            vaultSigningData.vaultIndex,
            input.addressIndex,
            vaultChain,
          );

          if (!keyPubKey) {
            keyPubKey = signingKeypair.pubKey;
          }

          const keyPair = utxolib.ECPair.fromWIF(
            signingKeypair.privKey,
            network,
          );

          const witnessScriptBuf = input.witnessScript
            ? Buffer.from(input.witnessScript, 'hex')
            : undefined;
          const redeemScriptBuf = input.redeemScript
            ? Buffer.from(input.redeemScript, 'hex')
            : undefined;
          const amount = input.amount ? Number(input.amount) : 0;

          txb.sign(
            i,
            keyPair,
            redeemScriptBuf,
            hashType,
            amount,
            witnessScriptBuf,
          );

          // Clear per-input private key material
          signingKeypair.privKey = '';
        }

        // Build with both wallet + key sigs (still incomplete if M>1)
        const signedHex = txb.buildIncomplete().toHex();

        // Clear sensitive key material
        vaultXpriv = '';
        pwForEncryption = '';

        // Build response payload with signedHex
        const utxoResponsePayload: Record<string, unknown> = {
          signedHex,
          keyPubKey,
          requestId: vaultSigningData.requestId,
        };

        // Post 'enterprisevaultsigned' action to relay
        await postAction(
          'enterprisevaultsigned',
          JSON.stringify(utxoResponsePayload),
          vaultSigningData.chain,
          '',
          sspWalletKeyInternalIdentity,
        );

        displayMessage('success', t('home:vault_sign_success'));
        return; // Early return — UTXO response already sent (finally handles cleanup)
      }
    } catch (error) {
      // Clear sensitive key material on error path
      vaultXpriv = '';
      pwForEncryption = '';
      mnemonicPhrase = '';
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Vault Signing] Error:', errMsg);
      displayMessage(
        'error',
        `${t('home:err_vault_sign_failed')}: ${errMsg}`,
        8000,
      );
    } finally {
      setVaultSigningData(null);
      setDecodedVaultTx(null);
      clearVaultSigningRequest?.();
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

    // Hoist sensitive vars so they can be cleared in catch/finally
    let pwForEncryption = '';
    let xprivKeyDecrypted = '';

    try {
      console.log(
        '[EVM Signing] handleSignEVMAction for chain:',
        evmSigningData.chain,
      );
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
      pwForEncryption = encryptionKey.password + passwordDecryptedString;

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
      console.log('[EVM Signing] nonce matched:', !!noncesToUse);

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
      xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);

      const splittedDerPath = evmSigningData.walletInUse.split('-');
      if (!splittedDerPath) {
        throw new Error('Invalid walletInUse');
      }
      const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
      const addressIndex = Number(splittedDerPath[1]);

      const keyPair = generateAddressKeypair(
        xprivKeyDecrypted,
        typeIndex,
        addressIndex,
        evmSigningData.chain as keyof cryptos,
      );

      // Clear private key immediately after use
      xprivKeyDecrypted = '';

      const xpubw = CryptoJS.AES.decrypt(xpubWallet, pwForEncryption);
      const xpubKeyWalletDecrypted = xpubw.toString(CryptoJS.enc.Utf8);

      // Clear encryption password — no longer needed
      pwForEncryption = '';

      const publicKeyWallet = deriveEVMPublicKey(
        xpubKeyWalletDecrypted,
        typeIndex,
        addressIndex,
        evmSigningData.chain as keyof cryptos,
      ); // ssp wallet

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

      // Clear private key from keypair
      keyPair.privKey = '';

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
      xprivKeyDecrypted = '';
      pwForEncryption = '';
      console.error('[EVM Signing] Error handling request:', error);
      displayMessage('error', 'Error processing request');
    } finally {
      xprivKeyDecrypted = '';
      pwForEncryption = '';
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
      <Navbar openSettingsTrigger={openSettings} navigation={navigation} />
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
            !evmSigningData &&
            !wkSigningData &&
            !vaultXpubData &&
            !vaultSigningData &&
            !keyNonceSyncDialogOpen && (
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
          {wkSigningData && (
            <WkSigningRequest
              activityStatus={activityStatus}
              message={wkSigningData.message}
              wkIdentity={wkSigningData.wkIdentity}
              requesterInfo={wkSigningData.requesterInfo}
              actionStatus={handleWkSigningRequestAction}
            />
          )}
          {vaultXpubData && (
            <VaultXpubRequest
              activityStatus={activityStatus}
              vaultName={vaultXpubData.vaultName}
              orgName={vaultXpubData.orgName}
              chain={vaultXpubData.chain}
              actionStatus={handleVaultXpubRequestAction}
            />
          )}
          {keyNonceSyncDialogOpen && (
            <KeyNonceSyncRequest
              activityStatus={activityStatus}
              actionStatus={(status: boolean) => {
                void handleKeyNonceSyncAction(status);
              }}
            />
          )}
          {vaultSigningData && (
            <VaultSignRequest
              activityStatus={activityStatus}
              recipients={vaultSigningData.recipients}
              fee={vaultSigningData.fee}
              feeLabel={vaultSigningData.feeLabel}
              memo={vaultSigningData.memo}
              chain={vaultSigningData.chain}
              vaultName={vaultSigningData.vaultName}
              orgName={vaultSigningData.orgName}
              actionStatus={handleVaultSigningRequestAction}
              tokenContract={vaultSigningData.tokenContract}
              tokenSymbol={vaultSigningData.tokenSymbol}
              tokenDecimals={vaultSigningData.tokenDecimals}
              sourceAddress={vaultSigningData.sourceAddress}
              decodedTx={decodedVaultTx}
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
