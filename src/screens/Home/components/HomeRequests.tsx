import React from 'react';
import TransactionRequest from '../../../components/TransactionRequest/TransactionRequest';
import SyncRequest from '../../../components/SyncRequest/SyncRequest';
import ChainSyncRequest from '../../../components/ChainSyncRequest/ChainSyncRequest';
import PublicNoncesRequest from '../../../components/PublicNoncesRequest/PublicNoncesRequest';
import RecoveryRequest from '../../../components/RecoveryRequest/RecoveryRequest';
import PublicNoncesSuccess from '../../../components/PublicNoncesSuccess/PublicNoncesSuccess';
import EvmSigningRequest from '../../../components/EvmSigningRequest/EvmSigningRequest';
import EvmSigningSuccess from '../../../components/EvmSigningSuccess/EvmSigningSuccess';
import WkSigningRequest from '../../../components/WkSigningRequest/WkSigningRequest';
import VaultXpubRequest from '../../../components/VaultXpubRequest/VaultXpubRequest';
import KeyNonceSyncRequest from '../../../components/KeyNonceSyncRequest/KeyNonceSyncRequest';
import VaultSignRequest from '../../../components/VaultSignRequest/VaultSignRequest';
import FluxNodeStartRequest from '../../../components/FluxNodeStartRequest/FluxNodeStartRequest';
import TxSent from '../../../components/TxSent/TxSent';
import SyncSuccess from '../../../components/SyncSuccess/SyncSuccess';
import VerificationCode from '../../../components/VerificationCode/VerificationCode';
import { blockchains } from '@storage/blockchains';
import {
  cryptos,
  utxo,
  evmSigningRequest,
  wkSigningRequest,
  vaultXpubRequest,
  vaultSigningRequest,
} from '../../../types';
import { type VaultDecodedTx } from '../../../lib/transactions';
import { type VaultSolDecodeState } from '../../../lib/vaultSolanaDecode';
import { parseProposalSimulation } from '../../../lib/vaultSimulation';
import { type ParsedChainSyncRequest } from '../../../lib/chainSyncRequest';
import { type RecoveryRequestPayload } from '../../../lib/recoveryHandler';
import { type ChainSyncProgressState } from './HomeProgress';

/**
 * The request-routing section of the Home screen: conditionally mounts the
 * pending-request components (transaction, sync, batch chain-sync, public
 * nonces, recovery, EVM/WK signing, vault xpub/sign, key-nonce sync, flux
 * node start) and their success/outcome screens (public nonces shared, EVM
 * signature, tx sent, sync success, pairing verification code).
 *
 * JSX relocated verbatim from Home.tsx. Home remains the single stateful
 * orchestrator — every piece of state and every handler arrives via props
 * under its original Home.tsx name. Mount conditions and mount ORDER are
 * unchanged from Home.tsx (order keeps sibling reconciliation stable).
 */
const HomeRequests = (props: {
  submittingTransaction: boolean;
  rawTx: string;
  xpubWallet: string;
  xpubKey: string;
  activeChain: keyof cryptos;
  txUtxos: utxo[];
  activityStatus: boolean;
  handleTransactionRequestAction: (status: boolean) => Promise<void>;
  syncReq: string;
  handleSynchronisationRequestAction: (status: boolean) => void;
  chainSyncData: ParsedChainSyncRequest | null;
  chainSyncProgress: ChainSyncProgressState | null;
  sspWalletKeyInternalIdentity: string;
  handleChainSyncRequestAction: (status: boolean) => void;
  publicNoncesReq: string;
  handlePublicNoncesRequestAction: (status: boolean) => Promise<void>;
  recoveryRequest: RecoveryRequestPayload | null;
  handleRecoveryRequestAction: (status: boolean) => Promise<void>;
  publicNoncesShared: boolean;
  pNonces: string;
  handlePublicNoncesSharedModalAction: () => void;
  evmSigningData: evmSigningRequest | null;
  handleEvmSigningRequestAction: (status: boolean) => Promise<void>;
  evmSigningSignature: string | null;
  handleEvmSigningSuccessModalAction: () => void;
  wkSigningData: wkSigningRequest | null;
  handleWkSigningRequestAction: (status: boolean) => Promise<void>;
  vaultXpubData: vaultXpubRequest | null;
  handleVaultXpubRequestAction: (status: boolean) => Promise<void>;
  keyNonceSyncDialogOpen: boolean;
  handleKeyNonceSyncAction: (approved: boolean) => Promise<void>;
  vaultSigningData: vaultSigningRequest | null;
  decodedVaultTx: VaultDecodedTx | null;
  solDecodeState: VaultSolDecodeState | null;
  handleVaultSigningRequestAction: (status: boolean) => Promise<void>;
  fluxNodeStartData: Record<string, unknown> | null;
  handleFluxNodeStartAction: (status: boolean) => Promise<void>;
  txid: string;
  handleTxSentModalAction: () => void;
  syncSuccessOpen: boolean;
  handleSyncSuccessModalAction: () => void;
  batchVerifyWords: string[];
  handleVerificationClose: () => void;
}) => {
  const {
    submittingTransaction,
    rawTx,
    xpubWallet,
    xpubKey,
    activeChain,
    txUtxos,
    activityStatus,
    handleTransactionRequestAction,
    syncReq,
    handleSynchronisationRequestAction,
    chainSyncData,
    chainSyncProgress,
    sspWalletKeyInternalIdentity,
    handleChainSyncRequestAction,
    publicNoncesReq,
    handlePublicNoncesRequestAction,
    recoveryRequest,
    handleRecoveryRequestAction,
    publicNoncesShared,
    pNonces,
    handlePublicNoncesSharedModalAction,
    evmSigningData,
    handleEvmSigningRequestAction,
    evmSigningSignature,
    handleEvmSigningSuccessModalAction,
    wkSigningData,
    handleWkSigningRequestAction,
    vaultXpubData,
    handleVaultXpubRequestAction,
    keyNonceSyncDialogOpen,
    handleKeyNonceSyncAction,
    vaultSigningData,
    decodedVaultTx,
    solDecodeState,
    handleVaultSigningRequestAction,
    fluxNodeStartData,
    handleFluxNodeStartAction,
    txid,
    handleTxSentModalAction,
    syncSuccessOpen,
    handleSyncSuccessModalAction,
    batchVerifyWords,
    handleVerificationClose,
  } = props;

  return (
    <>
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
            blockchains[vaultSigningData.chain as keyof cryptos]?.chainType ===
              'sol' && solDecodeState === null
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
    </>
  );
};

export default HomeRequests;
