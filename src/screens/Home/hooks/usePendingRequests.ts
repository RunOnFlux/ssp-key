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
import type { RecoveryRequestPayload } from '../../../lib/recoveryHandler';

/**
 * True when `chain` is a chain this build actually registers. The redux
 * store creates exactly one slice per key of `blockchains`, so an unknown
 * chain id makes `state[chain]` undefined — and Home (plus EvmSigningRequest,
 * SyncSuccess, ...) destructure that slice straight in the render body, which
 * throws and, with no ErrorBoundary in the app, takes the screen down for as
 * long as the request state lives. Every chain that arrives from the relay
 * MUST pass this before it is written to state.
 */
export const isSupportedChain = (chain: unknown): chain is keyof cryptos =>
  typeof chain === 'string' &&
  Object.prototype.hasOwnProperty.call(blockchains, chain);

/** The pending-request kinds that carry a chain from the relay. */
export type PendingRequestKind = 'tx' | 'publicnonces' | 'evmsigning' | 'sync';

/** One action as delivered by the relay (socket event or GET /v1/action). */
export interface RelayActionEnvelope {
  action?: unknown;
  payload?: unknown;
  chain?: unknown;
  path?: unknown;
  utxos?: unknown;
}

/**
 * Every Key-directed relay action, in the order routeRelayAction handles
 * them. SocketContext listens for exactly this set — tests/lib/
 * relayActionRouting.test.ts asserts the two cannot drift apart again.
 */
export const KEY_RELAY_ACTIONS = [
  'tx',
  'publicnoncesrequest',
  'evmsigningrequest',
  'wksigningrequest',
  'enterprisevaultsign',
  'enterprisevaultxpub',
  'enterprisefluxnodestart',
  'enterprisekeynoncesync',
  'recoveryrequest',
  'chainsyncrequest',
] as const;

export type KeyRelayAction = (typeof KEY_RELAY_ACTIONS)[number];

/**
 * What a routed relay action is handed to. Home wires these to the
 * pending-request setters; tests wire them to spies.
 */
export interface RelayActionHandlers {
  onTx: (payload: string, chain: string, path: string, utxos: utxo[]) => void;
  onPublicNoncesRequest: (chain: string) => void;
  onEvmSigningRequest: (data: evmSigningRequest) => void;
  onWkSigningRequest: (data: wkSigningRequest) => void;
  onVaultSigningRequest: (data: vaultSigningRequest) => void;
  onVaultXpubRequest: (data: vaultXpubRequest) => void;
  onFluxNodeStartRequest: (data: Record<string, unknown>) => void;
  onKeyNonceSyncRequest: () => void;
  onRecoveryRequest: (data: RecoveryRequestPayload) => void;
  onChainSyncRequest: (payload: string) => void;
  onInvalidPayload: () => void;
}

const parseActionPayload = <T>(payload: unknown): T | null => {
  if (typeof payload !== 'string' || !payload) {
    return null;
  }
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
};

const asActionString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/**
 * Validates a recoveryrequest payload exactly the way SocketContext does, so the
 * socket and poll transports agree on what a well-formed request is.
 *
 * `recoveryIndex` is required: it tells this device which key of the recovery
 * account the requester's envelope is sealed to. A request without it is asking
 * for something this build does not produce, so it is dropped here rather than
 * put in front of the user — approving it could only end in a failure on the
 * requesting side.
 */
export const parseRecoveryRequestPayload = (
  payload: unknown,
): RecoveryRequestPayload | null => {
  const parsed = parseActionPayload<RecoveryRequestPayload>(payload);
  if (
    !parsed ||
    typeof parsed.pkEph !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    typeof parsed.timestamp !== 'number' ||
    typeof parsed.recoveryIndex !== 'number'
  ) {
    return null;
  }
  return parsed;
};

/**
 * Routes ONE relay action envelope to the matching handler. Home's
 * `GET /v1/action` poll (handleRefresh, also the notification-open handler)
 * goes through here so it answers every action the socket transport does —
 * it used to silently drop `recoveryrequest` and `enterprisefluxnodestart`,
 * which left a tapped push notification opening an idle Home screen.
 *
 * Returns false when the action is not one this screen answers, so the
 * caller can log it instead of idling.
 */
export const routeRelayAction = (
  envelope: RelayActionEnvelope,
  handlers: RelayActionHandlers,
): boolean => {
  const { action, payload } = envelope;
  switch (action) {
    case 'tx': {
      if (typeof payload !== 'string' || !payload) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onTx(
        payload,
        asActionString(envelope.chain),
        asActionString(envelope.path),
        // relay-supplied; shape is validated downstream when the tx is signed
        Array.isArray(envelope.utxos) ? (envelope.utxos as utxo[]) : [],
      );
      return true;
    }
    case 'publicnoncesrequest': {
      handlers.onPublicNoncesRequest(asActionString(envelope.chain));
      return true;
    }
    case 'evmsigningrequest': {
      const data = parseActionPayload<evmSigningRequest>(payload);
      if (!data) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onEvmSigningRequest(data);
      return true;
    }
    case 'wksigningrequest': {
      const data = parseActionPayload<wkSigningRequest>(payload);
      if (!data) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onWkSigningRequest(data);
      return true;
    }
    case 'enterprisevaultsign': {
      const data = parseActionPayload<vaultSigningRequest>(payload);
      if (!data) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onVaultSigningRequest(data);
      return true;
    }
    case 'enterprisevaultxpub': {
      const data = parseActionPayload<vaultXpubRequest>(payload);
      if (!data) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onVaultXpubRequest(data);
      return true;
    }
    case 'enterprisefluxnodestart': {
      const data = parseActionPayload<Record<string, unknown>>(payload);
      if (!data || typeof data !== 'object') {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onFluxNodeStartRequest(data);
      return true;
    }
    case 'enterprisekeynoncesync': {
      handlers.onKeyNonceSyncRequest();
      return true;
    }
    case 'recoveryrequest': {
      const data = parseRecoveryRequestPayload(payload);
      if (!data) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onRecoveryRequest(data);
      return true;
    }
    case 'chainsyncrequest': {
      if (typeof payload !== 'string' || !payload) {
        handlers.onInvalidPayload();
        return true;
      }
      handlers.onChainSyncRequest(payload);
      return true;
    }
    default:
      return false;
  }
};

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
 *
 * @param onUnsupportedChain called when a request names a chain this build
 *   does not register. The request is already dropped by then; Home uses this
 *   to post the matching `*rejected` action so SSP Wallet is not left waiting
 *   for its timeout (posting needs relay auth, which lives in Home).
 */
export function usePendingRequests(
  identityChain: keyof cryptos,
  onUnsupportedChain?: (kind: PendingRequestKind, chain: string) => void,
) {
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
  // Recovery requests that arrived over the GET /v1/action poll. The socket
  // transport keeps its own copy in SocketContext (which exposes no setter),
  // so Home merges the two sources.
  const [recoveryRequestData, setRecoveryRequestData] =
    useState<RecoveryRequestPayload | null>(null);

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

  // An unknown chain is dropped BEFORE it reaches state — activeChain indexes
  // the store and every consumer destructures that slice. `chain` is typed as
  // a plain string on the ingestion functions on purpose: it arrives from the
  // relay / a scanned QR, so it is not a keyof cryptos until checked here.
  const rejectUnsupportedChain = (kind: PendingRequestKind, chain: unknown) => {
    const chainName = asActionString(chain);
    console.log(
      '[Pending Requests] Unsupported chain, dropping request:',
      kind,
      chainName,
    );
    displayMessage('error', t('home:err_invalid_request'), 5000);
    onUnsupportedChain?.(kind, chainName);
  };

  const handleTxRequest = (
    rawTransaction: string,
    chain: string,
    path: string,
    utxos: utxo[] = [],
  ) => {
    if (!isSupportedChain(chain)) {
      rejectUnsupportedChain('tx', chain);
      return;
    }
    setActiveChain(chain);
    if (utxos) {
      setTxUtxos(utxos);
    }
    setRawTx(rawTransaction);
    setTxPath(path);
  };
  const handlePublicNoncesRequest = (chain: string) => {
    console.log(chain);
    if (!isSupportedChain(chain)) {
      rejectUnsupportedChain('publicnonces', chain);
      return;
    }
    setActiveChain(chain);
    setPublicNoncesReq(chain);
  };
  const handleEvmSigningRequest = (data: evmSigningRequest) => {
    // never log the request body — it carries the wallet's partial signature
    console.log('[EVM Signing] request received:', data.chain);
    if (!isSupportedChain(data.chain)) {
      rejectUnsupportedChain('evmsigning', data.chain);
      return;
    }
    setActiveChain(data.chain);
    setEvmSigningData(data);
  };
  const handleWkSigningRequest = (data: wkSigningRequest) => {
    console.log('[WK Sign] request received');
    setWkSigningData(data);
  };
  const handleSyncRequest = (xpubw: string, chain: string) => {
    if (!isSupportedChain(chain)) {
      rejectUnsupportedChain('sync', chain);
      return;
    }
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
    if (evmSigningRequest) {
      // Routed through handleEvmSigningRequest so the socket path gets the
      // same chain validation as the poll path (and so the request body,
      // which carries the wallet's partial signature, is not logged).
      handleEvmSigningRequest(evmSigningRequest);
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
    recoveryRequestData,
    setRecoveryRequestData,
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
