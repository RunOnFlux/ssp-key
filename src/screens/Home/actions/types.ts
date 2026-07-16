import type React from 'react';
import type { TFunction } from 'i18next';
import type { AppDispatch } from '../../../store';
import type {
  cryptos,
  utxo,
  evmSigningRequest,
  wkSigningRequest,
  vaultXpubRequest,
  vaultSigningRequest,
} from '../../../types';
import type { VaultSolDecodeState } from '../../../lib/vaultSolanaDecode';
import type { VerifyEntry } from '../../../lib/pairingVerification';
import type { ParsedChainSyncRequest } from '../../../lib/chainSyncRequest';
import type { RecoveryRequestPayload } from '../../../lib/recoveryHandler';
import type { ChainSyncProgressState } from '../components/HomeProgress';

export type DisplayMessageFn = (
  type: string,
  content: string,
  visibilityTime?: number,
) => void;

export type PostActionFn = (
  action: string,
  payload: string,
  chain: string,
  path: string,
  wkIdentity: string,
) => Promise<unknown>;

/**
 * Everything the extracted Home action functions previously captured from
 * the Home component's render scope. Home builds this object once per
 * render and its thin wrapper handlers pass it to the action modules —
 * preserving the exact per-render closure-capture semantics the original
 * inline handlers had. Property names match the original Home.tsx
 * identifiers so the relocated bodies read identically.
 */
export interface HomeActionContext {
  // redux/session state
  seedPhrase: string;
  identityChain: keyof cryptos;
  identityChainState: {
    xpubWallet?: string;
    xpubKey?: string;
    xprivKey?: string;
  };
  sspWalletKeyInternalIdentity: string;
  sspWalletKeyInternalIdentityPubKey: string;
  sspWalletInternalIdentity: string;
  sspKeyInternalIdentity: string;
  publicNonces: string;
  enterprisePublicNonces: string;
  // active-chain encrypted key material (state[activeChain])
  xpubWallet: string;
  xpubKey: string;
  xprivKey: string;
  dispatch: AppDispatch;
  t: TFunction<['home', 'common']>;
  displayMessage: DisplayMessageFn;
  postAction: PostActionFn;
  // pending-request state + setters (from usePendingRequests / Home state)
  activeChain: keyof cryptos;
  setActiveChain: React.Dispatch<React.SetStateAction<keyof cryptos>>;
  setRawTx: React.Dispatch<React.SetStateAction<string>>;
  setTxPath: React.Dispatch<React.SetStateAction<string>>;
  setTxUtxos: React.Dispatch<React.SetStateAction<utxo[]>>;
  setSyncReq: React.Dispatch<React.SetStateAction<string>>;
  setPublicNoncesReq: React.Dispatch<React.SetStateAction<string>>;
  evmSigningData: evmSigningRequest | null;
  setEvmSigningData: React.Dispatch<
    React.SetStateAction<evmSigningRequest | null>
  >;
  wkSigningData: wkSigningRequest | null;
  setWkSigningData: React.Dispatch<
    React.SetStateAction<wkSigningRequest | null>
  >;
  vaultXpubData: vaultXpubRequest | null;
  setVaultXpubData: React.Dispatch<
    React.SetStateAction<vaultXpubRequest | null>
  >;
  vaultSigningData: vaultSigningRequest | null;
  solDecodeState: VaultSolDecodeState | null;
  clearVaultSigningState: () => void;
  // Home-local UI state setters
  setSubmittingTransaction: React.Dispatch<React.SetStateAction<boolean>>;
  setTxid: React.Dispatch<React.SetStateAction<string>>;
  setPNonces: React.Dispatch<React.SetStateAction<string>>;
  setPublicNoncesShared: React.Dispatch<React.SetStateAction<boolean>>;
  setSyncSuccessOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEvmSigningSignature: React.Dispatch<React.SetStateAction<string | null>>;
  setActivityStatus: React.Dispatch<React.SetStateAction<boolean>>;
  chainSyncData: ParsedChainSyncRequest | null;
  setChainSyncData: React.Dispatch<
    React.SetStateAction<ParsedChainSyncRequest | null>
  >;
  setChainSyncProgress: React.Dispatch<
    React.SetStateAction<ChainSyncProgressState | null>
  >;
  setBatchVerifyWords: React.Dispatch<React.SetStateAction<string[]>>;
  // refs
  identityVerifyEntryRef: React.MutableRefObject<VerifyEntry | null>;
  nonceReplenishInProgressRef: React.MutableRefObject<boolean>;
  // socket values / clear callbacks
  evmSigningRequest: evmSigningRequest | null;
  clearEvmSigningRequest?: () => void;
  clearWkSigningRequest?: () => void;
  clearVaultXpubRequest?: () => void;
  clearVaultSigningRequest?: () => void;
  recoveryRequest: RecoveryRequestPayload | null;
  clearRecoveryRequest?: () => void;
}
