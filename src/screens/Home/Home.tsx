import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { fluxnode } from '@runonflux/flux-sdk';
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
import { buildRecoveryResponse } from '../../lib/recoveryHandler';
import RecoveryRequest from '../../components/RecoveryRequest/RecoveryRequest';

import {
  getMasterXpriv,
  getMasterXpub,
  generateMultisigAddress,
  generateInternalIdentityAddress,
  generateAddressKeypair,
  generatePublicNonce,
  generateSolanaPubkeyArray,
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
  cosignAndBroadcastSOLTransaction,
} from '../../lib/constructTx';

import {
  continueSigningSchnorrMultisig,
  continueVaultSigningSchnorrMultisig,
} from '../../lib/evmSigning';
import {
  decodeVaultTransaction,
  type VaultDecodedTx,
} from '../../lib/transactions';
import { parseProposalSimulation } from '../../lib/vaultSimulation';
import {
  applyVaultSolDecode,
  VaultSolDecodeState,
} from '../../lib/vaultSolanaDecode';
import { signMessage } from '../../lib/relayAuth';
import { recordSignAction } from '../../lib/signHistory';

import {
  setXpubKey,
  setXprivKey,
  setXpubWallet,
  setXpubWalletIdentity,
  store,
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
import {
  getFCMToken,
  refreshFCMToken,
  setNotificationOpenHandler,
} from '../../lib/fcmHelper';
import { changeTheme } from '../../store/theme';
import EvmSigningRequest from '../../components/EvmSigningRequest/EvmSigningRequest';
import EvmSigningSuccess from '../../components/EvmSigningSuccess/EvmSigningSuccess';
import WkSigningRequest from '../../components/WkSigningRequest/WkSigningRequest';
import VaultXpubRequest from '../../components/VaultXpubRequest/VaultXpubRequest';
import VaultSignRequest from '../../components/VaultSignRequest/VaultSignRequest';
import KeyNonceSyncRequest from '../../components/KeyNonceSyncRequest/KeyNonceSyncRequest';
import FluxNodeStartRequest from '../../components/FluxNodeStartRequest/FluxNodeStartRequest';
import ChainSyncRequest from '../../components/ChainSyncRequest/ChainSyncRequest';
import VerificationCode from '../../components/VerificationCode/VerificationCode';
import {
  sessionVerificationWords,
  type VerifyEntry,
} from '../../lib/pairingVerification';
import {
  parseChainSyncRequest,
  buildChainSyncRejectionPayload,
  CHAIN_SYNC_POST_SPACING_MS,
  type ParsedChainSyncRequest,
} from '../../lib/chainSyncRequest';
import { MainScreenProps } from '../../../@types/navigation';

type Props = MainScreenProps<'Home'>;

const xpubRegex = /^([a-zA-Z]{2}ub[1-9A-HJ-NP-Za-km-z]{79,140})$/; // xpub start is the most usual, but can also be Ltub

// Solana repurposes the "xpub" field as a JSON-stringified array of 20
// base58-encoded Ed25519 leaf pubkeys. Accept that format too in sync
// QR / manual input. Each HD slot derives a distinct leaf so the array
// must have 20 unique entries — duplicates indicate a malformed input.
function isSolanaPubkeyArrayString(input: string): boolean {
  try {
    const arr = JSON.parse(input.trim());
    if (!Array.isArray(arr) || arr.length !== 20) return false;
    const base58Pk = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const seen = new Set<string>();
    for (const pk of arr) {
      if (typeof pk !== 'string' || !base58Pk.test(pk)) return false;
      if (seen.has(pk)) return false;
      seen.add(pk);
    }
    return true;
  } catch {
    return false;
  }
}

function looksLikeXpub(input: string): boolean {
  return xpubRegex.test(input) || isSolanaPubkeyArrayString(input);
}

function Home({ navigation }: Props) {
  // focusability of inputs
  const alreadyMounted = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  // Holds the latest handleRefresh so the notification deep-link handler always
  // invokes the current closure without re-registering on every render.
  const handleRefreshRef = useRef<() => void>(() => {});
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
  const [solDecodeState, setSolDecodeState] =
    useState<VaultSolDecodeState | null>(null);
  // Monotonic token guarding the async sol decode — a decode started for an
  // older vault payload must never overwrite the verdict of a newer one
  // (bumped on every new request and on reject/completion cleanup).
  const solDecodeSeqRef = useRef(0);
  const [fluxNodeStartData, setFluxNodeStartData] = useState<Record<
    string,
    unknown
  > | null>(null);
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
    fluxNodeStartRequest: socketFluxNodeStartRequest,
    clearFluxNodeStartRequest,
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
    if (socketChainSyncRequest) {
      console.log('[Chain Sync] Received batch chain sync request');
      handleChainSyncRequestPayload(socketChainSyncRequest);
      clearChainSyncRequest?.();
    }
  }, [socketChainSyncRequest]);

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
        // Every incoming request must start from a clean decode state — never
        // render a stale sol verdict or stale decoded values from a previous
        // request. The seq token discards any still-in-flight async sol
        // decode started for an older payload.
        solDecodeSeqRef.current += 1;
        const decodeSeq = solDecodeSeqRef.current;
        setDecodedVaultTx(null);
        setSolDecodeState(null);
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
          } else if (chainConf?.chainType === 'sol') {
            // Solana: trustlessly decode the raw base64 bundle bytes and
            // compare against the relay-supplied payload (shared helper —
            // also used by the pull-to-refresh path). A create-kind decode
            // that contradicts the payload hard-blocks approval in
            // VaultSignRequest. Setters are seq-guarded so a decode that
            // resolves after a newer request arrived is discarded.
            void applyVaultSolDecode(
              data,
              (tx) => {
                if (solDecodeSeqRef.current === decodeSeq) {
                  setDecodedVaultTx(tx);
                }
              },
              (state) => {
                if (solDecodeSeqRef.current === decodeSeq) {
                  setSolDecodeState(state);
                }
              },
            );
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

  // Handle Enterprise Flux Node Start request
  useEffect(() => {
    if (socketFluxNodeStartRequest) {
      console.log('[Enterprise Flux Node] Start request received');
      setFluxNodeStartData(socketFluxNodeStartRequest);
      clearFluxNodeStartRequest?.();
    }
  }, [socketFluxNodeStartRequest]);

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

  // Shared per-chain sync core: decrypts the key xpub for the chain, runs the
  // Solana on-the-fly migration when needed, generates + verifies the first
  // multisig address, stores the wallet xpub, and posts the standard
  // syncSSPRelay payload to POST /v1/sync. Used by the single-chain sync flow
  // (generateAddressesForActiveChain) and looped over by the batch chain sync
  // (processChainSyncBatch) — same crypto calls, same sync POST, unchanged
  // endpoint so old wallets keep working.
  const syncChainToRelay = async (
    chain: keyof cryptos,
    suppliedXpubWallet: string,
    pwForEncryption: string,
    xpubKeyEncrypted: string,
    xprivKeyEncrypted: string,
  ) => {
    const xpk = CryptoJS.AES.decrypt(xpubKeyEncrypted, pwForEncryption);
    let xpubKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
    // For Solana chains, "xpub" is actually a JSON-stringified array of
    // 20 base58 Ed25519 leaf pubkeys (Ed25519 has no non-hardened
    // public-key derivation). If the stored xpubKey for this chain is
    // still in regular xpub form (e.g., chain was set up before Solana
    // support), derive the 20-pubkey array on the fly from xprivKey.
    if (
      blockchains[chain].chainType === 'sol' &&
      !xpubKeyDecrypted.startsWith('[')
    ) {
      const xprk = CryptoJS.AES.decrypt(xprivKeyEncrypted, pwForEncryption);
      const xprivKeyDecrypted = xprk.toString(CryptoJS.enc.Utf8);
      // Consumer wallet on-the-fly migration: derive at typeIndex=0
      // (receiving slot). Enterprise vaults take a different code path
      // (handleVaultXpubAction) which passes vault.vaultIndex.
      const keyPubkeys = generateSolanaPubkeyArray(xprivKeyDecrypted, chain, 0);
      xpubKeyDecrypted = JSON.stringify(keyPubkeys);
      // Persist the JSON-encoded form back to encrypted storage so
      // subsequent calls don't need to re-derive.
      const reEncryptedXpubKey = CryptoJS.AES.encrypt(
        xpubKeyDecrypted,
        pwForEncryption,
      ).toString();
      setXpubKey(chain, reEncryptedXpubKey);
    }
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
    // Return this device's decrypted view of the pair so the batch flow can
    // derive the out-of-band verification code. Display-only — never logged.
    return {
      chain,
      walletXpub: suppliedXpubWallet,
      keyXpub: xpubKeyDecrypted,
    };
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
        await syncChainToRelay(
          chain,
          suppliedXpubWallet,
          pwForEncryption,
          xpubKey,
          xprivKey,
        );
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
  };

  const handleChainSyncRequestAction = (status: boolean) => {
    if (status === true) {
      void processChainSyncBatch();
    } else {
      // reject — notify wallet so it can offer per-chain QR sync right away
      setChainSyncData(null);
      postAction(
        'chainsyncrejected',
        buildChainSyncRejectionPayload('declined'),
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      ).catch((error) => console.log(error));
    }
  };

  const processChainSyncBatch = async () => {
    const request = chainSyncData;
    if (!request) {
      return;
    }
    setActivityStatus(true);
    let mnemonicPhrase = '';
    try {
      const idData = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });
      if (!passwordData || !idData) {
        throw new Error('Unable to decrypt stored data');
      }
      const password = CryptoJS.AES.decrypt(
        passwordData.password,
        idData.password,
      );
      const passwordDecrypted = password.toString(CryptoJS.enc.Utf8);
      const pwForEncryption = idData.password + passwordDecrypted;
      const total = request.chains.length;
      let failedChains = 0;
      const verifyEntries: {
        chain: string;
        walletXpub: string;
        keyXpub: string;
      }[] = [];
      for (let i = 0; i < total; i += 1) {
        const entry = request.chains[i];
        setChainSyncProgress({
          current: i + 1,
          total,
          chain: entry.chain,
        });
        // let the progress UI paint before the synchronous ~3s derivation
        await new Promise((resolve) => setTimeout(resolve, 50));
        try {
          let { xpubKey: chainXpubKey, xprivKey: chainXprivKey } =
            store.getState()[entry.chain];
          if (!chainXpubKey || !chainXprivKey) {
            // chain keys were never prepared on this device — derive them
            // now, exactly as checkXpubXpriv does for the active chain
            if (!mnemonicPhrase) {
              const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
              mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);
            }
            const chainConfig = blockchains[entry.chain];
            const xpriv = getMasterXpriv(
              mnemonicPhrase,
              48,
              chainConfig.slip,
              0,
              chainConfig.scriptType,
              entry.chain,
            ); // takes ~3 secs
            const xpub = getMasterXpub(
              mnemonicPhrase,
              48,
              chainConfig.slip,
              0,
              chainConfig.scriptType,
              entry.chain,
            ); // takes ~3 secs
            chainXprivKey = CryptoJS.AES.encrypt(
              xpriv,
              pwForEncryption,
            ).toString();
            chainXpubKey = CryptoJS.AES.encrypt(
              xpub,
              pwForEncryption,
            ).toString();
            setXprivKey(entry.chain, chainXprivKey);
            setXpubKey(entry.chain, chainXpubKey);
          }
          const synced = await syncChainToRelay(
            entry.chain,
            entry.xpubWallet,
            pwForEncryption,
            chainXpubKey,
            chainXprivKey,
          );
          verifyEntries.push(synced);
        } catch (error) {
          failedChains += 1;
          console.log('[Chain Sync] Failed for chain', entry.chain, error);
        }
        if (i < total - 1) {
          // spacing so the wallet's 1s sync poll catches every chain
          // (relay sync doc is last-write-wins per walletIdentity)
          await new Promise((resolve) =>
            setTimeout(resolve, CHAIN_SYNC_POST_SPACING_MS),
          );
        }
      }
      if (failedChains > 0) {
        displayMessage('error', t('home:err_sync_failed'));
      } else {
        displayMessage('success', t('home:chainsync_success'));
      }
      // Show the ONE unified verification code covering every chain synced this
      // session so the user can confirm it matches SSP Wallet. The identity
      // chain (if paired this session) is folded in as just another entry — a
      // relay swap on ANY chain changes the code.
      const sessionEntries: VerifyEntry[] = [];
      if (identityVerifyEntryRef.current) {
        sessionEntries.push(identityVerifyEntryRef.current);
      }
      sessionEntries.push(...verifyEntries);
      if (sessionEntries.length > 0) {
        setBatchVerifyWords(sessionVerificationWords(sessionEntries));
      }
    } catch (error) {
      console.log(error);
      displayMessage('error', t('home:err_sync_failed'));
    } finally {
      mnemonicPhrase = '';
      setChainSyncData(null);
      setChainSyncProgress(null);
      setActivityStatus(false);
    }
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
        // Capture the identity chain's verification entry so it can be folded
        // into the ONE unified session code (with any batch chains). The words
        // themselves are derived on demand from this device's own key view.
        identityVerifyEntryRef.current = {
          chain: identityChain,
          walletXpub: suppliedXpubWallet,
          keyXpub: xpubKeyDecrypted,
        };
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
  /**
   * Respond to a wallet-issued randomParams recovery request. Derives
   * sk_r from the identity seed on demand, wraps it with ECDH+AES-GCM
   * using the wallet's ephemeral pubkey from the request, and posts the
   * response back through the relay.
   */
  const approveRecoveryRequest = async () => {
    if (!recoveryRequest) return;
    try {
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
      const pwForEncryption =
        encryptionKey.password + passwordDecrypted.toString(CryptoJS.enc.Utf8);
      const xprivEncrypted = identityChainState?.xprivKey;
      if (!xprivEncrypted || typeof xprivEncrypted !== 'string') {
        throw new Error('Identity xpriv not available');
      }
      const xprivDecrypted = CryptoJS.AES.decrypt(
        xprivEncrypted,
        pwForEncryption,
      ).toString(CryptoJS.enc.Utf8);
      if (!xprivDecrypted) {
        throw new Error('Failed to decrypt identity xpriv');
      }
      const response = buildRecoveryResponse({
        xprivKeyIdentity: xprivDecrypted,
        request: recoveryRequest,
        identityChain,
      });
      await postAction(
        'recoveryresponse',
        JSON.stringify(response),
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      );
      clearRecoveryRequest?.();
    } catch (error) {
      console.log('[recovery] approve failed', error);
      displayMessage('error', (error as Error)?.message ?? 'Recovery failed');
      clearRecoveryRequest?.();
    }
  };

  const denyRecoveryRequest = async () => {
    if (!recoveryRequest) return;
    try {
      await postAction(
        'recoverydenied',
        JSON.stringify({
          nonce: recoveryRequest.nonce,
          timestamp: recoveryRequest.timestamp,
        }),
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      );
    } catch (error) {
      console.log('[recovery] deny post failed', error);
    } finally {
      clearRecoveryRequest?.();
    }
  };

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
      } else if (blockchains[chain].chainType === 'sol') {
        // Wallet pre-signed the outer tx with its leaf. Key adds its own
        // leaf sig + broadcasts directly. The tx may include a permissionless
        // initialize_multisig ix at the head for first-send-per-vault — Key
        // doesn't need to know; it just signs and broadcasts.
        // SPL sends arrive JSON-wrapped (`{ unsignedTxBase64, tokenMint, ...}`)
        // so the approval screen can show the real token symbol; unwrap
        // here so we sign the raw proposal bytes, not the JSON string.
        let serializedTxBase64 = rawTransaction;
        try {
          const parsed = JSON.parse(rawTransaction) as {
            unsignedTxBase64?: string;
          };
          if (parsed && typeof parsed.unsignedTxBase64 === 'string') {
            serializedTxBase64 = parsed.unsignedTxBase64;
          }
        } catch {
          // Not JSON — bare base64 from older wallet, use as-is.
        }
        ttxid = await cosignAndBroadcastSOLTransaction({
          chain,
          serializedTxBase64,
          keyPubkeyBase58: keyPair.pubKey,
          keyPrivKeyHex: keyPair.privKey,
          relayHost: sspConfig().relay,
        });
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
      await postAction(
        'txid',
        ttxid,
        chain,
        derivationPath,
        sspWalletKeyInternalIdentity,
      );
      setTxid(ttxid);
    } catch (error) {
      const txErrMsg =
        error instanceof Error ? error.message : t('home:err_tx_failed');
      displayMessage('error', txErrMsg);
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
            // Every incoming request must start from a clean decode state —
            // never render a stale sol verdict or stale decoded values from
            // a previous request. The seq token discards any still-in-flight
            // async sol decode started for an older payload.
            solDecodeSeqRef.current += 1;
            const decodeSeq = solDecodeSeqRef.current;
            setDecodedVaultTx(null);
            setSolDecodeState(null);
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
              } else if (chainConf?.chainType === 'sol') {
                // Solana: trustlessly decode the raw base64 bundle bytes and
                // compare against the relay-supplied payload (shared helper —
                // same path as the socket effect above). Setters are
                // seq-guarded so a decode that resolves after a newer
                // request arrived is discarded.
                void applyVaultSolDecode(
                  vaultSignData,
                  (tx) => {
                    if (solDecodeSeqRef.current === decodeSeq) {
                      setDecodedVaultTx(tx);
                    }
                  },
                  (state) => {
                    if (solDecodeSeqRef.current === decodeSeq) {
                      setSolDecodeState(state);
                    }
                  },
                );
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

  const handleFluxNodeStart = async (request: Record<string, unknown>) => {
    let collateralPrivKey = '';
    let pwForEncryption = '';
    let mnemonicPhrase = '';
    let vaultXpriv = '';

    const requestId = (request.requestId as string) || '';
    const nodeChain = (request.chain as string) || '';

    try {
      const nodeOrgIndex = request.orgIndex as number;
      const nodeVaultIndex = request.vaultIndex as number;
      const nodeAddressIndex = (request.addressIndex as number) || 0;
      const identityPubKey = request.identityPubKey as string;
      const collateralTxid = request.collateralTxid as string;
      const nodeCollateralVout = request.collateralVout as number;
      const nodeRedeemScript = request.redeemScript as string;
      const nodeDelegates = (request.delegates as string[]) || [];

      if (
        !nodeChain ||
        !collateralTxid ||
        !identityPubKey ||
        !nodeRedeemScript
      ) {
        console.error('[Enterprise Flux Node] Missing required parameters');
        displayMessage('error', t('home:err_flux_node_missing_params'));
        await postAction(
          'enterprisefluxnodestarted',
          JSON.stringify({
            requestId,
            error: 'Missing required parameters',
          }),
          nodeChain || identityChain,
          '',
          sspWalletKeyInternalIdentity,
        );
        return;
      }

      // Derive Key's vault keypair — following same pattern as handleVaultSignAction
      const encryptionKey = await Keychain.getGenericPassword({
        service: 'enc_key',
      });
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });

      if (!passwordData || !encryptionKey) {
        throw new Error(t('home:err_flux_node_decrypt'));
      }

      const passwordDecrypted = CryptoJS.AES.decrypt(
        passwordData.password,
        encryptionKey.password,
      );
      const passwordDecryptedString = passwordDecrypted.toString(
        CryptoJS.enc.Utf8,
      );
      pwForEncryption = encryptionKey.password + passwordDecryptedString;

      const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
      mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);

      if (!mnemonicPhrase) {
        throw new Error(t('home:err_flux_node_mnemonic'));
      }

      const vaultChain = nodeChain as keyof cryptos;
      const blockchainConfig = blockchains[vaultChain];
      if (!blockchainConfig) {
        throw new Error(t('home:err_flux_node_unsupported_chain'));
      }

      // Derive xpriv at m/48'/coin'/orgIndex'/scriptType'
      vaultXpriv = getMasterXpriv(
        mnemonicPhrase,
        48,
        blockchainConfig.slip,
        nodeOrgIndex,
        blockchainConfig.scriptType,
        vaultChain,
      );

      // Clear mnemonic immediately
      mnemonicPhrase = '';
      pwForEncryption = '';

      // Derive keypair at vaultIndex/addressIndex
      const keypair = generateAddressKeypair(
        vaultXpriv,
        nodeVaultIndex,
        nodeAddressIndex,
        vaultChain,
      );
      collateralPrivKey = keypair.privKey;
      vaultXpriv = '';

      const timestamp = Math.floor(Date.now() / 1000).toString();

      // Build delegate data
      let delegateData;
      if (nodeDelegates.length > 0) {
        delegateData = {
          version: 1,
          type: 1,
          delegatePublicKeys: nodeDelegates,
        };
      }

      // Call startFluxNodev6WithPubKey — uses identity public key directly (no private key needed)
      const signedTxHex = fluxnode.startFluxNodev6WithPubKey(
        collateralTxid,
        nodeCollateralVout,
        collateralPrivKey,
        identityPubKey,
        timestamp,
        true,
        nodeRedeemScript,
        delegateData,
      );

      // Clear sensitive data
      collateralPrivKey = '';

      // Send response back to Wallet
      await postAction(
        'enterprisefluxnodestarted',
        JSON.stringify({ requestId, signedTxHex }),
        nodeChain,
        '',
        sspWalletKeyInternalIdentity,
      );

      displayMessage('success', t('home:flux_node_start_success'));
      console.log('[Enterprise Flux Node] Start signed and sent back');
    } catch (err) {
      collateralPrivKey = '';
      vaultXpriv = '';
      mnemonicPhrase = '';
      pwForEncryption = '';
      console.error('[Enterprise Flux Node] Error:', err);
      await postAction(
        'enterprisefluxnodestarted',
        JSON.stringify({
          requestId,
          error:
            err instanceof Error ? err.message : t('home:err_flux_node_failed'),
        }),
        nodeChain || identityChain,
        '',
        sspWalletKeyInternalIdentity,
      );
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

      // For UTXO/EVM: BIP32 xpub at m/48'/coin'/orgIndex'/scriptType'. Backend
      // derives child pubkeys per addressIndex on demand.
      // For Solana: pre-derive 20 ed25519 pubkeys at /[vaultIndex]/0..19 from
      // the master xpriv and send as JSON array. vaultIndex (from the wallet's
      // relay payload) provides per-vault key separation — mirrors EVM/UTXO
      // behavior where vault.vaultIndex shifts the HD derivation.
      let vaultXpub: string;
      if (
        typeof vaultXpubData.vaultIndex !== 'number' ||
        !Number.isInteger(vaultXpubData.vaultIndex) ||
        vaultXpubData.vaultIndex < 0
      ) {
        throw new Error(
          'vaultXpub request missing valid vaultIndex (wallet must send a non-negative integer)',
        );
      }
      const solVaultTypeIndex = vaultXpubData.vaultIndex;
      if (blockchainConfig.chainType === 'sol') {
        const solVaultXpriv = getMasterXpriv(
          mnemonicPhrase,
          48,
          blockchainConfig.slip,
          vaultXpubData.orgIndex,
          blockchainConfig.scriptType,
          vaultChain,
        );
        const pubkeys = generateSolanaPubkeyArray(
          solVaultXpriv,
          vaultChain,
          solVaultTypeIndex,
        );
        vaultXpub = JSON.stringify(pubkeys);
      } else {
        vaultXpub = getMasterXpub(
          mnemonicPhrase,
          48,
          blockchainConfig.slip,
          vaultXpubData.orgIndex,
          blockchainConfig.scriptType,
          vaultChain,
        );
      }

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
        solDecodeSeqRef.current += 1; // discard any in-flight sol decode
        setVaultSigningData(null);
        setDecodedVaultTx(null);
        setSolDecodeState(null);
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

    // Sign-time fail-closed recheck for Solana: the Approve button's
    // disabled prop is evaluated at press time, but the byte-decode verdict
    // can land while biometric auth is open (or the press can race the
    // async decode). NEVER partial-sign while the trustless decode is still
    // pending or after it flagged a mismatch. Keeps the request open — the
    // user sees the banner/disabled state instead of a silent dismissal.
    if (
      blockchains[vaultSigningData.chain as keyof cryptos]?.chainType === 'sol'
    ) {
      if (!solDecodeState) {
        // Decode still pending — Approve is disabled while pending, so this
        // is defensive-only; refuse to sign without a verdict.
        return;
      }
      if (solDecodeState.mismatch) {
        displayMessage('error', t('home:vault_sign_sol_decode_mismatch'), 8000);
        return;
      }
    }

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

      // Solana enterprise: ed25519 partial-sign of the bundled tx.
      // No nonces, no Schnorr, no UTXO progressive — just one 64-byte sig
      // for Key's slot.
      if (blockchainConfig.chainType === 'sol') {
        // Read addressIndex from the synthesized inputDetails[0] entry the
        // wallet/enterprise-app forwards. Must match the index used to
        // derive the on-chain multisig PDA; otherwise the derived pubkey
        // wouldn't be a member and approve_transaction would reject.
        // Defensive: vaultSigningData.inputDetails may arrive as either a
        // JSON string (relay payload) or already-parsed Array — match the
        // existing UTXO path's accommodation.
        let solInputDetailsParsed: Array<{ addressIndex?: number }> = [];
        const rawInputDetails = vaultSigningData.inputDetails;
        if (typeof rawInputDetails === 'string') {
          try {
            solInputDetailsParsed = JSON.parse(rawInputDetails) as Array<{
              addressIndex?: number;
            }>;
          } catch {
            solInputDetailsParsed = [];
          }
        } else if (Array.isArray(rawInputDetails)) {
          solInputDetailsParsed = rawInputDetails;
        }
        const solAddressIndex =
          typeof solInputDetailsParsed[0]?.addressIndex === 'number'
            ? solInputDetailsParsed[0].addressIndex
            : 0;
        // Sign at HD path [vaultIndex][addressIndex]. Mirrors the per-vault
        // xpub flow (generateSolanaPubkeyArray now also derives at
        // typeIndex=vault.vaultIndex), so the wallet's signing pubkey
        // matches the multisig slot pubkey computed from the stored xpub
        // array. Identical to EVM/UTXO per-vault key separation.
        const signingKeypair = generateAddressKeypair(
          vaultXpriv,
          vaultSigningData.vaultIndex,
          solAddressIndex,
          vaultChain,
        );
        keyPubKey = signingKeypair.pubKey;

        const { Transaction: SolTransaction, Keypair: SolKeypair } =
          await import('@solana/web3.js');
        const secretKey = new Uint8Array(
          Buffer.from(signingKeypair.privKey, 'hex'),
        );
        const keyKeypair = SolKeypair.fromSecretKey(secretKey);
        let keySigBase64: string;
        try {
          // rawUnsignedTx carries the base64 bundled tx from the backend
          // (nonceAdvance + create + approve×threshold + execute + close).
          const tx = SolTransaction.from(
            Buffer.from(vaultSigningData.rawUnsignedTx, 'base64'),
          );
          tx.partialSign(keyKeypair);
          const sigEntry = tx.signatures.find((s) =>
            s.publicKey.equals(keyKeypair.publicKey),
          );
          if (!sigEntry?.signature) {
            throw new Error(
              'Solana partial-sign produced no signature at key slot',
            );
          }
          keySigBase64 = Buffer.from(sigEntry.signature).toString('base64');
        } finally {
          // Zero the raw 64-byte ed25519 secret-key buffer whether signing
          // succeeded or failed. Mirrors the wallet-side cleanup; without
          // this the Uint8Array can linger in V8/Hermes memory long after
          // the hex-string clear at signingKeypair.privKey below.
          secretKey.fill(0);
        }

        // Clear sensitive material
        signingKeypair.privKey = '';
        vaultXpriv = '';
        pwForEncryption = '';

        const responsePayload: Record<string, unknown> = {
          // Reuse signedHex convention for shipping the base64 sig back —
          // wallet-side EnterpriseVaultSignTx receiver doesn't care about
          // the field name; it forwards to the enterprise sign endpoint.
          keySignatureBase64: keySigBase64,
          keyPubKey,
          requestId: vaultSigningData.requestId,
        };

        await postAction(
          'enterprisevaultsigned',
          JSON.stringify(responsePayload),
          vaultSigningData.chain,
          '',
          sspWalletKeyInternalIdentity,
        );

        displayMessage('success', t('home:vault_sign_success'));
        return;
      }

      // EVM vault signing: use enterprise nonce for Schnorr partial signature
      const isEvmChain = blockchainConfig.chainType === 'evm';
      let usedEnterpriseNonce: publicPrivateNonce | null = null;

      // Wallet-only mode: Key's nonce is empty placeholder — skip nonce lookup
      const keyNonceIsPlaceholder =
        vaultSigningData.reservedNonce &&
        !vaultSigningData.reservedNonce.kPublic;

      if (
        isEvmChain &&
        vaultSigningData.reservedNonce &&
        !keyNonceIsPlaceholder
      ) {
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
            ? (JSON.parse(vaultSigningData.allSignerKeys) as string[])
            : vaultSigningData.allSignerKeys;
      }
      if (vaultSigningData.allSignerNonces) {
        parsedAllSignerNonces =
          typeof vaultSigningData.allSignerNonces === 'string'
            ? (JSON.parse(vaultSigningData.allSignerNonces) as Array<{
                kPublic: string;
                kTwoPublic: string;
              }>)
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
        (usedEnterpriseNonce || keyNonceIsPlaceholder) &&
        vaultSigningData.sigOne != null &&
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

        let vaultSchnorrResult: {
          signerContribution: string;
          challenge: string;
        };

        if (vaultSigningData.signingMode === 'wallet_only') {
          // Wallet-only mode: Key doesn't participate in Schnorr signing.
          // Pass through wallet's contribution unchanged.
          console.log(
            '[Vault Signing] Wallet-only EVM mode — skipping Key Schnorr signing',
          );
          vaultSchnorrResult = {
            signerContribution: vaultSigningData.sigOne,
            challenge: '',
          };
        } else {
          // Dual or key_only: Key participates in Schnorr signing.
          // usedEnterpriseNonce is always set here (nonce lookup runs for non-placeholder nonces).
          if (!usedEnterpriseNonce) {
            throw new Error('Enterprise nonce required for EVM vault signing');
          }

          vaultSchnorrResult = continueVaultSigningSchnorrMultisig(
            vaultSigningData.rawUnsignedTx,
            signingKeypair,
            usedEnterpriseNonce,
            parsedAllSignerKeys,
            parsedAllSignerNonces,
            vaultSigningData.sigOne,
          );
        }

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
        if (!usedEnterpriseNonce && !keyNonceIsPlaceholder)
          missing.push('nonce');
        if (vaultSigningData.sigOne == null) missing.push('sigOne');
        if (!parsedAllSignerKeys) missing.push('signerKeys');
        if (!parsedAllSignerNonces) missing.push('signerNonces');
        throw new Error(`Missing Schnorr signing data: ${missing.join(', ')}`);
      } else if (vaultSigningData.signingMode === 'wallet_only') {
        // UTXO wallet-only: Key doesn't sign, pass through walletSignedHex unchanged
        const walletSignedHex = vaultSigningData.walletSignedHex;
        if (!walletSignedHex) {
          throw new Error(
            'Missing wallet-signed TX hex for UTXO vault signing',
          );
        }

        console.log(
          '[Vault Signing] Wallet-only UTXO mode — skipping Key signing',
        );

        // Derive pubkey for response (no signing needed)
        const firstAddrIdx = parsedInputDetails[0]?.addressIndex ?? 0;
        const pubKeypair = generateAddressKeypair(
          vaultXpriv,
          vaultSigningData.vaultIndex,
          firstAddrIdx,
          vaultChain,
        );
        keyPubKey = pubKeypair.pubKey;
        pubKeypair.privKey = '';

        // Clear sensitive key material
        vaultXpriv = '';
        pwForEncryption = '';

        // Pass through wallet-signed hex unchanged
        const utxoResponsePayload: Record<string, unknown> = {
          signedHex: walletSignedHex,
          keyPubKey,
          requestId: vaultSigningData.requestId,
        };

        await postAction(
          'enterprisevaultsigned',
          JSON.stringify(utxoResponsePayload),
          vaultSigningData.chain,
          '',
          sspWalletKeyInternalIdentity,
        );

        displayMessage('success', t('home:vault_sign_success'));
        return;
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
      solDecodeSeqRef.current += 1; // discard any in-flight sol decode
      setVaultSigningData(null);
      setDecodedVaultTx(null);
      setSolDecodeState(null);
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
      displayMessage('error', t('home:err_invalid_request'));
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
            !preparingChainKeys &&
            chainSyncProgress && (
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
                    Fonts.textCenter,
                    Fonts.textRegular,
                    Gutters.smallMargin,
                  ]}
                >
                  {t('home:preparing_chain_keys_progress', {
                    symbol:
                      blockchains[chainSyncProgress.chain]?.symbol ??
                      String(chainSyncProgress.chain),
                    current: chainSyncProgress.current,
                    total: chainSyncProgress.total,
                  })}
                </Text>
                <ActivityIndicator
                  size={'large'}
                  style={[Layout.row, Gutters.regularVMargin, { height: 30 }]}
                />
              </View>
            )}
          {!submittingTransaction && preparingChainKeys && (
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
                  Fonts.textCenter,
                  Fonts.textRegular,
                  Gutters.smallMargin,
                ]}
              >
                {t('home:preparing_chain_keys')}
              </Text>
              <ActivityIndicator
                size={'large'}
                style={[Layout.row, Gutters.regularVMargin, { height: 30 }]}
              />
            </View>
          )}
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
              <>
                <TouchableOpacity
                  onPress={() => setReceiveModalOpen(true)}
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
                        onPress={() =>
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
                      onPress={() => handleRefresh()}
                      style={[
                        Layout.row,
                        Gutters.regularVMargin,
                        { height: 30 },
                      ]}
                    >
                      <IconB
                        name="gesture-tap"
                        size={30}
                        color={Colors.primary}
                      />
                      <Text
                        style={[
                          Fonts.textSmall,
                          Fonts.textBold,
                          Fonts.textPrimary,
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
                    onPress={() => scanCode()}
                  >
                    <Text
                      style={[
                        Fonts.textSmall,
                        Fonts.textPrimary,
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
          {chainSyncData && !chainSyncProgress && (
            <ChainSyncRequest
              chains={chainSyncData.chains.map((entry) => entry.chain)}
              identity={sspWalletKeyInternalIdentity}
              activityStatus={activityStatus}
              actionStatus={handleChainSyncRequestAction}
            />
          )}
          {publicNoncesReq && (
            <PublicNoncesRequest
              activityStatus={activityStatus}
              actionStatus={handlePublicNoncesRequestAction}
            />
          )}
          {recoveryRequest && (
            <RecoveryRequest
              activityStatus={activityStatus}
              actionStatus={handleRecoveryRequestAction}
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
              simulation={parseProposalSimulation(vaultSigningData.simulation)}
              solDecodeMismatch={solDecodeState?.mismatch ?? false}
              solDecodeKind={solDecodeState?.kind}
              solMismatchReasons={solDecodeState?.mismatchReasons}
              solDecodePending={
                blockchains[vaultSigningData.chain as keyof cryptos]
                  ?.chainType === 'sol' && solDecodeState === null
              }
              signMessage={vaultSigningData.signMessage}
              dappOrigin={vaultSigningData.dappOrigin}
            />
          )}
          {fluxNodeStartData && (
            <FluxNodeStartRequest
              activityStatus={activityStatus}
              chain={(fluxNodeStartData.chain as string) || ''}
              nodeName={(fluxNodeStartData.nodeName as string) || ''}
              collateralAmount={
                (fluxNodeStartData.collateralAmount as string) || ''
              }
              collateralAddress={
                (fluxNodeStartData.collateralAddress as string) || undefined
              }
              collateralTxid={
                (fluxNodeStartData.collateralTxid as string) || undefined
              }
              collateralVout={
                typeof fluxNodeStartData.collateralVout === 'number'
                  ? fluxNodeStartData.collateralVout
                  : undefined
              }
              delegates={(fluxNodeStartData.delegates as string[]) || []}
              actionStatus={(status: boolean) => {
                void handleFluxNodeStartAction(status);
              }}
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
          {batchVerifyWords.length > 0 && (
            <VerificationCode
              words={batchVerifyWords}
              actionStatus={handleVerificationClose}
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
