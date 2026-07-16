import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';
import {
  cryptos,
  utxo,
  evmSigningRequest,
  wkSigningRequest,
  vaultXpubRequest,
  vaultSigningRequest,
} from '../../../types';
import { blockchains } from '@storage/blockchains';
import {
  decodeVaultTransaction,
  type VaultDecodedTx,
} from '../../../lib/transactions';
import {
  applyVaultSolDecode,
  VaultSolDecodeState,
} from '../../../lib/vaultSolanaDecode';
import { useSocket } from '../../../hooks/useSocket';

/**
 * Owns the pending-request state of the Home screen and the socket ->
 * pending-request state mapping effects. This is a MECHANICAL relocation
 * from Home.tsx — state variable names, types, setter semantics and effect
 * bodies are kept exactly as they were in Home. The socket subscription
 * itself stays untouched in SocketContext; this hook only consumes the
 * same context values Home consumed before (useSocket is a plain
 * useContext read, so reading it here and in Home yields identical
 * values).
 *
 * Deliberately NOT moved here (left in Home, see refactor notes):
 * - the chainsyncrequest socket effect + handleChainSyncRequestPayload
 *   (entangled with postAction/relay auth and the pairing-verification
 *   session refs which live in Home),
 * - handleRefresh (HTTP-poll counterpart; it ingests requests through the
 *   functions this hook returns).
 */
export function usePendingRequests(identityChain: keyof cryptos) {
  const { t } = useTranslation(['home', 'common']);
  const [rawTx, setRawTx] = useState('');
  const [activeChain, setActiveChain] = useState<keyof cryptos>(identityChain);
  const [txPath, setTxPath] = useState('');
  const [txUtxos, setTxUtxos] = useState<utxo[]>([]);
  const [syncReq, setSyncReq] = useState('');
  const [publicNoncesReq, setPublicNoncesReq] = useState('');
  const [evmSigningData, setEvmSigningData] =
    useState<evmSigningRequest | null>(null);
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

  const {
    newTx,
    clearTx,
    publicNoncesRequest,
    evmSigningRequest,
    clearPublicNoncesRequest,
    wkSigningRequest: socketWkSigningRequest,
    vaultXpubRequest: socketVaultXpubRequest,
    vaultSigningRequest: socketVaultSigningRequest,
    keyNonceSyncRequest: socketKeyNonceSyncRequest,
    fluxNodeStartRequest: socketFluxNodeStartRequest,
    clearFluxNodeStartRequest,
  } = useSocket();

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

  // Shared vault-signing-request ingestion used by BOTH the socket effect
  // below and Home's handleRefresh poll path. The two former copies in Home
  // were verbatim-identical apart from the recipients console.log label
  // (kept as a parameter) — consolidation verified by textual diff during
  // the refactor.
  const ingestVaultSigningRequest = (
    incoming: vaultSigningRequest,
    recipientsLogLabel: string,
  ) => {
    // Defensively parse fields that may arrive as JSON strings
    // (matching the refresh/action path parsing at handleRefresh)
    const data = { ...incoming };
    console.log(
      recipientsLogLabel,
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
            decodeVaultTransaction(decodableJson, data.chain as keyof cryptos),
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
        // used by the socket effect and the pull-to-refresh path). A
        // create-kind decode that contradicts the payload hard-blocks
        // approval in VaultSignRequest. Setters are seq-guarded so a
        // decode that resolves after a newer request arrived is discarded.
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
  };

  // Clears the vault-signing pending state. Exact statement sequence the
  // reject path and the sign-completion finally block in Home used inline.
  const clearVaultSigningState = () => {
    solDecodeSeqRef.current += 1; // discard any in-flight sol decode
    setVaultSigningData(null);
    setDecodedVaultTx(null);
    setSolDecodeState(null);
  };

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
        ingestVaultSigningRequest(
          socketVaultSigningRequest,
          '[Vault Signing] Recipients type:',
        );
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

  return {
    // pending-request state (names identical to the former Home.tsx state)
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
    // request ingestion helpers (same bodies as the former Home.tsx ones)
    handleTxRequest,
    handlePublicNoncesRequest,
    handleEvmSigningRequest,
    handleWkSigningRequest,
    handleSyncRequest,
    ingestVaultSigningRequest,
    clearVaultSigningState,
  };
}
