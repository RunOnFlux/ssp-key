import React, { useState, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import Divider from '../../components/Divider/Divider';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux';
import Scanner from '../../components/Scanner/Scanner';
import Navbar from '../../components/Navbar/Navbar';
import * as Keychain from 'react-native-keychain';
import Toast from 'react-native-toast-message';
import axios from 'axios';
import { sspConfig } from '@storage/ssp';
import { cryptos, utxo } from '../../types';
import { blockchains } from '@storage/blockchains';

import * as CryptoJS from 'crypto-js';

import {
  getMasterXpriv,
  getMasterXpub,
  generateMultisigAddress,
  generateAddressKeypair,
} from '../../lib/wallet';
import { recordSignAction } from '../../lib/signHistory';

import { setXpubKey, setXprivKey } from '../../store';

import {
  setSspWalletKeyInternalIdentityWitnessScript,
  setSspWalletKeyInternalIdentityPubKey,
} from '../../store/ssp';

import { useAppSelector, useAppDispatch, useRelayAuth } from '../../hooks';
import { useSocket } from '../../hooks/useSocket';
import { usePendingRequests } from './hooks/usePendingRequests';
import {
  getFCMToken,
  refreshFCMToken,
  setNotificationOpenHandler,
} from '../../lib/fcmHelper';
import { changeTheme } from '../../store/theme';
import HomeProgress from './components/HomeProgress';
import HomeIdle from './components/HomeIdle';
import HomeRequests from './components/HomeRequests';
import HomeModals from './components/HomeModals';
import {
  sessionVerificationWords,
  type VerifyEntry,
} from '../../lib/pairingVerification';
import {
  parseChainSyncRequest,
  buildChainSyncRejectionPayload,
  type ParsedChainSyncRequest,
} from '../../lib/chainSyncRequest';
import { looksLikeXpub, splitSSPInput } from '../../lib/inputParsing';
import type { HomeActionContext } from './actions/types';
import * as syncActions from './actions/syncActions';
import * as signingActions from './actions/signingActions';
import * as recoveryActions from './actions/recoveryActions';
import * as nonceActions from './actions/nonceActions';
import * as vaultActions from './actions/vaultActions';
import { MainScreenProps } from '../../../@types/navigation';

type Props = MainScreenProps<'Home'>;

function Home({ navigation }: Props) {
  // focusability of inputs
  const alreadyMounted = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  // Holds the latest handleRefresh so the notification deep-link handler always
  // invokes the current closure without re-registering on every render.
  const handleRefreshRef = useRef<() => void>(() => {});
  // Guards concurrent enterprise-nonce replenishment (moved up with the
  // other refs so it is initialized before actionCtx references it).
  const nonceReplenishInProgressRef = useRef(false);
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
  const { Gutters, Layout, Colors } = useTheme();
  const [isMenuModalOpen, setIsMenuModalOpen] = useState(false);
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
  const [evmSigningSignature, setEvmSigningSignature] = useState<string | null>(
    null,
  );
  // Pending-request state + socket -> pending-request mapping effects.
  // Mechanical relocation from this file — see usePendingRequests.
  const {
    rawTx,
    setRawTx,
    activeChain,
    setActiveChain,
    txPath,
    setTxPath,
    txUtxos,
    setTxUtxos,
    syncReq,
    setSyncReq,
    publicNoncesReq,
    setPublicNoncesReq,
    evmSigningData,
    setEvmSigningData,
    wkSigningData,
    setWkSigningData,
    vaultXpubData,
    setVaultXpubData,
    vaultSigningData,
    decodedVaultTx,
    solDecodeState,
    fluxNodeStartData,
    setFluxNodeStartData,
    keyNonceSyncDialogOpen,
    setKeyNonceSyncDialogOpen,
    handleTxRequest,
    handlePublicNoncesRequest,
    handleEvmSigningRequest,
    handleWkSigningRequest,
    handleSyncRequest,
    ingestVaultSigningRequest,
    clearVaultSigningState,
  } = usePendingRequests(identityChain);
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
  const [preparingChainKeys, setPreparingChainKeys] = useState(false);
  const [chainSyncData, setChainSyncData] =
    useState<ParsedChainSyncRequest | null>(null);
  const [chainSyncProgress, setChainSyncProgress] = useState<{
    current: number;
    total: number;
    chain: keyof cryptos;
  } | null>(null);
  // Out-of-band pairing verification words for the current session. ONE code
  // covers every chain synced this session (identity chain + any batch chains),
  // shown once at the end so the user can compare it against SSP Wallet (or
  // scan the wallet's QR). Display-only — never logged.
  const [batchVerifyWords, setBatchVerifyWords] = useState<string[]>([]);
  // The identity chain's own verification entry, captured when the identity
  // pairing completes. It is folded into the unified session code as just
  // another entry (empty for an already-paired wallet activating extra chains).
  const identityVerifyEntryRef = useRef<VerifyEntry | null>(null);
  // Whether a batch chain-sync started this session. When it did, the batch
  // completion drives the unified verification screen; otherwise the identity
  // sync alone does. Prevents showing an identity-only code that a following
  // batch would supersede.
  const batchStartedRef = useRef(false);

  const {
    evmSigningRequest,
    clearEvmSigningRequest,
    clearWkSigningRequest,
    clearVaultXpubRequest,
    clearVaultSigningRequest,
    clearKeyNonceSyncRequest,
    recoveryRequest,
    clearRecoveryRequest,
    chainSyncRequest: socketChainSyncRequest,
    clearChainSyncRequest,
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

  // Deep-link: when a signing-request notification is opened (foreground,
  // background, or quit-state launch), fetch and surface the pending request.
  useEffect(() => {
    setNotificationOpenHandler(() => {
      handleRefreshRef.current();
    });
    return () => {
      setNotificationOpenHandler(null);
    };
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

  // NOTE: the socket -> pending-request mapping effects (newTx,
  // publicNoncesRequest, evmSigningRequest, wkSigningRequest,
  // vaultXpubRequest, vaultSigningRequest, keyNonceSyncRequest,
  // fluxNodeStartRequest) were mechanically relocated to
  // usePendingRequests. The chainsyncrequest effect below stays here
  // because its handler posts rejection actions through postAction
  // (relay auth) and drives the pairing-verification session refs.
  useEffect(() => {
    if (socketChainSyncRequest) {
      console.log('[Chain Sync] Received batch chain sync request');
      handleChainSyncRequestPayload(socketChainSyncRequest);
      clearChainSyncRequest?.();
    }
  }, [socketChainSyncRequest]);

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
    const chainToUse = activeChain;
    const blockchainConfigToUse = blockchains[chainToUse];
    if (!xpubKey || !xprivKey) {
      // just a precaution to make sure xpub and xpriv are set. Should acutally never end up here
      setPreparingChainKeys(true);
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
        })
        .finally(() => {
          setPreparingChainKeys(false);
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
  ) =>
    syncActions.generateAddressesForActiveChain(
      actionCtx,
      suppliedXpubWallet,
      chain,
    );

  // ==== Batch chain sync (chainsyncrequest) ====
  // One approval activates many chains: the wallet posts a versioned list of
  // chains over the existing action transport; after slide + Authentication
  // the key derives each chain's keys (~3s per not-yet-prepared chain) with
  // visible progress and answers per chain through the EXISTING sync POST.
  const handleChainSyncRequestPayload = (payload: string) => {
    if (!sspWalletKeyInternalIdentity) {
      console.log('[Chain Sync] Ignoring request — no wallet synced yet');
      return;
    }
    const parsed = parseChainSyncRequest(payload, identityChain);
    if (parsed.status === 'ok') {
      // A batch is now in flight this session — the unified verification code
      // will be shown when the batch completes (folding in the identity entry),
      // not by the identity sync alone.
      batchStartedRef.current = true;
      setChainSyncData(parsed.request);
      return;
    }
    if (parsed.status === 'unsupported_version') {
      // A future wallet spoke a newer protocol — tell it so it can fall
      // back to per-chain QR sync instead of waiting for a timeout.
      console.log('[Chain Sync] Unsupported request version:', parsed.version);
      postAction(
        'chainsyncrejected',
        buildChainSyncRejectionPayload('unsupported_version'),
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      ).catch((error) => console.log(error));
      return;
    }
    console.log('[Chain Sync] Invalid request:', parsed.reason);
    displayMessage('error', t('home:err_invalid_request'));
    // Tell the wallet immediately — without this it waits out the full 30s
    // fallback timeout before offering per-chain QR sync.
    postAction(
      'chainsyncrejected',
      buildChainSyncRejectionPayload('invalid'),
      identityChain,
      '',
      sspWalletKeyInternalIdentity,
    ).catch((error) => console.log(error));
  };

  const handleChainSyncRequestAction = (status: boolean) => {
    if (status === true) {
      void processChainSyncBatch();
    } else {
      // reject — notify wallet so it can offer per-chain QR sync right away
      setChainSyncData(null);
      // The declined batch will never drive the code screen. If identity was
      // paired this session, show its code now (the wallet shows one), and
      // clear the batch flag so a later pairing starts clean — leaving it set
      // would suppress every future identity code this session.
      batchStartedRef.current = false;
      if (identityVerifyEntryRef.current) {
        setBatchVerifyWords(
          sessionVerificationWords([identityVerifyEntryRef.current]),
        );
      }
      postAction(
        'chainsyncrejected',
        buildChainSyncRejectionPayload('declined'),
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      ).catch((error) => console.log(error));
    }
  };

  const processChainSyncBatch = async () =>
    syncActions.processChainSyncBatch(actionCtx);

  const generateAddressesForSyncIdentity = (suppliedXpubWallet: string) =>
    syncActions.generateAddressesForSyncIdentity(actionCtx, suppliedXpubWallet);

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
    // Local, encrypted, biometric-gated signed-action History (Phase 3,
    // invariant 4). Additive and fire-and-forget: recordSignAction internally
    // filters to successful co-sign actions, stores ONLY public metadata (never
    // the signature payload — for 'txid' the public txid is kept as a reference),
    // and swallows all errors so it can never disturb the signing flow.
    void recordSignAction(
      action,
      chain,
      wkIdentity,
      action === 'txid' ? payload : undefined,
    );
    return result;
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
  // Per-render context handed to the relocated action modules
  // (./actions/*). Rebuilt every render so the moved handler bodies see
  // exactly the values the former inline closures captured.
  const actionCtx: HomeActionContext = {
    seedPhrase,
    identityChain,
    identityChainState,
    sspWalletKeyInternalIdentity,
    sspWalletKeyInternalIdentityPubKey,
    sspWalletInternalIdentity,
    sspKeyInternalIdentity,
    publicNonces,
    enterprisePublicNonces,
    xpubWallet,
    xpubKey,
    xprivKey,
    dispatch,
    t,
    displayMessage,
    postAction,
    activeChain,
    setActiveChain,
    setRawTx,
    setTxPath,
    setTxUtxos,
    setSyncReq,
    setPublicNoncesReq,
    evmSigningData,
    setEvmSigningData,
    wkSigningData,
    setWkSigningData,
    vaultXpubData,
    setVaultXpubData,
    vaultSigningData,
    solDecodeState,
    clearVaultSigningState,
    setSubmittingTransaction,
    setTxid,
    setPNonces,
    setPublicNoncesShared,
    setSyncSuccessOpen,
    setEvmSigningSignature,
    setActivityStatus,
    chainSyncData,
    setChainSyncData,
    setChainSyncProgress,
    setBatchVerifyWords,
    identityVerifyEntryRef,
    nonceReplenishInProgressRef,
    evmSigningRequest,
    clearEvmSigningRequest,
    clearWkSigningRequest,
    clearVaultXpubRequest,
    clearVaultSigningRequest,
    recoveryRequest,
    clearRecoveryRequest,
  };
  const approvePublicNoncesAction = async (chain: keyof cryptos) =>
    signingActions.approvePublicNoncesAction(actionCtx, chain);
  const approveRecoveryRequest = async () =>
    recoveryActions.approveRecoveryRequest(actionCtx);

  const denyRecoveryRequest = async () =>
    recoveryActions.denyRecoveryRequest(actionCtx);

  /**
   * Wired from RecoveryRequest component after the user tapped Approve and
   * the biometric/password auth succeeded (status=true), or after they
   * tapped Reject (status=false). Matches the handler pattern of the other
   * request-action handlers in this file.
   */
  const handleRecoveryRequestAction = async (status: boolean) => {
    try {
      setActivityStatus(true);
      if (status === true) {
        await approveRecoveryRequest();
      } else {
        await denyRecoveryRequest();
      }
    } catch (error) {
      console.log('[recovery] action handler error', error);
    } finally {
      setActivityStatus(false);
    }
  };

  const approveTransaction = async (
    rawTransaction: string,
    chain: keyof cryptos,
    derivationPath: string,
    suggestedUtxos: utxo[],
  ) =>
    signingActions.approveTransaction(
      actionCtx,
      rawTransaction,
      chain,
      derivationPath,
      suggestedUtxos,
    );
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
        const { chain, wallet, dataToProcess } = splitSSPInput(
          manualInput,
          identityChain,
        );
        if (!dataToProcess || !blockchains[chain]) {
          displayMessage('error', t('home:err_invalid_manual_input'));
        } else {
          if (looksLikeXpub(dataToProcess)) {
            // xpub
            const xpubw = dataToProcess;
            handleSyncRequest(xpubw, chain);
            setTimeout(() => {
              setIsManualInputModalOpen(false);
            });
          } else {
            // transaction (UTXO hex, EVM userOp JSON, or Solana base64)
            const rawTransaction = dataToProcess;
            handleTxRequest(rawTransaction, chain, wallet);
            setTimeout(() => {
              setIsManualInputModalOpen(false);
            });
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
      const { chain, wallet, dataToProcess } = splitSSPInput(
        scannedData,
        identityChain,
      );
      if (!dataToProcess || !blockchains[chain]) {
        setTimeout(() => {
          displayMessage('error', t('home:err_invalid_scanned_data'));
        }, 200);
      } else {
        // check if input is xpub or transaction
        if (looksLikeXpub(dataToProcess)) {
          // xpub
          const xpubw = dataToProcess;
          handleSyncRequest(xpubw, chain);
        } else {
          // transaction (UTXO hex, EVM userOp JSON, or Solana base64)
          const rawTransaction = dataToProcess;
          handleTxRequest(rawTransaction, chain, wallet);
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

  const checkAndReplenishEnterpriseNonces = async (forceReplace = false) =>
    nonceActions.checkAndReplenishEnterpriseNonces(actionCtx, forceReplace);

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
            // Shared ingestion (defensive JSON-string field parsing +
            // trustless decode) — same code path as the socket effect in
            // usePendingRequests.
            ingestVaultSigningRequest(
              vaultSignData,
              '[Vault Signing] handleRefresh recipients type:',
            );
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
        } else if (result.data.action === 'chainsyncrequest') {
          if (typeof result.data.payload === 'string') {
            handleChainSyncRequestPayload(result.data.payload);
          } else {
            displayMessage('error', t('home:err_invalid_request'));
          }
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

  // Keep the deep-link ref pointing at the latest handleRefresh closure so a
  // tapped notification always fetches the freshest pending request.
  useEffect(() => {
    handleRefreshRef.current = () => {
      void handleRefresh();
    };
  });

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

  const handleSignWkAction = async () =>
    signingActions.handleSignWkAction(actionCtx);

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

  const handleFluxNodeStartAction = async (status: boolean) => {
    if (!fluxNodeStartData) return;
    try {
      if (!status) {
        // User rejected via the UI
        const requestId = (fluxNodeStartData.requestId as string) || '';
        const nodeChain = (fluxNodeStartData.chain as string) || '';
        await postAction(
          'enterprisefluxnodestarted',
          JSON.stringify({ requestId, error: 'User rejected' }),
          nodeChain,
          '',
          sspWalletKeyInternalIdentity,
        );
        return;
      }
      setActivityStatus(true);
      await handleFluxNodeStart(fluxNodeStartData);
    } catch (err) {
      console.error('[Enterprise Flux Node] Action error:', err);
    } finally {
      setActivityStatus(false);
      setFluxNodeStartData(null);
    }
  };

  const handleFluxNodeStart = async (request: Record<string, unknown>) =>
    vaultActions.handleFluxNodeStart(actionCtx, request);

  const handleVaultXpubAction = async () =>
    vaultActions.handleVaultXpubAction(actionCtx);

  const handleVaultSigningRequestAction = async (status: boolean) => {
    try {
      setActivityStatus(true);
      if (status === true) {
        await handleVaultSignAction();
      } else {
        // reject
        clearVaultSigningState(); // also discards any in-flight sol decode
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

  const handleVaultSignAction = async () =>
    vaultActions.handleVaultSignAction(actionCtx);

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
    // Identity-only pairing (no batch this session): show the ONE unified
    // verification code now. If a batch is/was in flight, its completion drives
    // the code instead (folding in the identity entry), so don't show it here.
    if (!batchStartedRef.current && identityVerifyEntryRef.current) {
      setBatchVerifyWords(
        sessionVerificationWords([identityVerifyEntryRef.current]),
      );
    }
  };

  // The unified verification screen was acknowledged — clear the session's
  // verification state so a later pairing starts clean.
  const handleVerificationClose = () => {
    setBatchVerifyWords([]);
    identityVerifyEntryRef.current = null;
    batchStartedRef.current = false;
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

  const handleSignEVMAction = async () =>
    signingActions.handleSignEVMAction(actionCtx);

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
          <HomeProgress
            submittingTransaction={submittingTransaction}
            preparingChainKeys={preparingChainKeys}
            chainSyncProgress={chainSyncProgress}
          />
          {!submittingTransaction &&
            !preparingChainKeys &&
            !rawTx &&
            !syncReq &&
            !publicNoncesReq &&
            !evmSigningData &&
            !wkSigningData &&
            !vaultXpubData &&
            !vaultSigningData &&
            !fluxNodeStartData &&
            !keyNonceSyncDialogOpen &&
            !chainSyncData &&
            !chainSyncProgress &&
            !recoveryRequest && (
              <HomeIdle
                sspWalletKeyInternalIdentity={sspWalletKeyInternalIdentity}
                sspWalletInternalIdentity={sspWalletInternalIdentity}
                isRefreshing={isRefreshing}
                openReceive={() => setReceiveModalOpen(true)}
                handleRefresh={() => handleRefresh()}
                scanCode={() => scanCode()}
              />
            )}
          <HomeRequests
            submittingTransaction={submittingTransaction}
            rawTx={rawTx}
            xpubWallet={xpubWallet}
            xpubKey={xpubKey}
            activeChain={activeChain}
            txUtxos={txUtxos}
            activityStatus={activityStatus}
            handleTransactionRequestAction={handleTransactionRequestAction}
            syncReq={syncReq}
            handleSynchronisationRequestAction={
              handleSynchronisationRequestAction
            }
            chainSyncData={chainSyncData}
            chainSyncProgress={chainSyncProgress}
            sspWalletKeyInternalIdentity={sspWalletKeyInternalIdentity}
            handleChainSyncRequestAction={handleChainSyncRequestAction}
            publicNoncesReq={publicNoncesReq}
            handlePublicNoncesRequestAction={handlePublicNoncesRequestAction}
            recoveryRequest={recoveryRequest}
            handleRecoveryRequestAction={handleRecoveryRequestAction}
            publicNoncesShared={publicNoncesShared}
            pNonces={pNonces}
            handlePublicNoncesSharedModalAction={
              handlePublicNoncesSharedModalAction
            }
            evmSigningData={evmSigningData}
            handleEvmSigningRequestAction={handleEvmSigningRequestAction}
            evmSigningSignature={evmSigningSignature}
            handleEvmSigningSuccessModalAction={
              handleEvmSigningSuccessModalAction
            }
            wkSigningData={wkSigningData}
            handleWkSigningRequestAction={handleWkSigningRequestAction}
            vaultXpubData={vaultXpubData}
            handleVaultXpubRequestAction={handleVaultXpubRequestAction}
            keyNonceSyncDialogOpen={keyNonceSyncDialogOpen}
            handleKeyNonceSyncAction={handleKeyNonceSyncAction}
            vaultSigningData={vaultSigningData}
            decodedVaultTx={decodedVaultTx}
            solDecodeState={solDecodeState}
            handleVaultSigningRequestAction={handleVaultSigningRequestAction}
            fluxNodeStartData={fluxNodeStartData}
            handleFluxNodeStartAction={handleFluxNodeStartAction}
            txid={txid}
            handleTxSentModalAction={handleTxSentModalAction}
            syncSuccessOpen={syncSuccessOpen}
            handleSyncSuccessModalAction={handleSyncSuccessModalAction}
            batchVerifyWords={batchVerifyWords}
            handleVerificationClose={handleVerificationClose}
          />
          <HomeModals
            addrDetailsOpen={addrDetailsOpen}
            handleAddrDetailsModalAction={handleAddrDetailsModalAction}
            sspKeyDetailsOpen={sspKeyDetailsOpen}
            handleSSPKeyModalAction={handleSSPKeyModalAction}
            settingsMenuOpen={settingsMenuOpen}
            handleSettingsModalAction={handleSettingsModalAction}
            navigation={navigation}
            syncNeededModalOpen={syncNeededModalOpen}
            handleSyncNeededModalAction={handleSyncNeededModalAction}
            authenticationOpen={authenticationOpen}
            handleAuthenticationOpen={handleAuthenticationOpen}
            manualInputModalOpen={manualInputModalOpen}
            handleManualInput={handleManualInput}
            receiveModalOpen={receiveModalOpen}
            handleReceiveModalAction={handleReceiveModalAction}
            isMenuModalOpen={isMenuModalOpen}
            handleMenuModalAction={handleMenuModalAction}
          />
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
