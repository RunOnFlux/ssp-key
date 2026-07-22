import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import io, { Socket } from 'socket.io-client';
import { useAppSelector } from '../hooks';
import { useRelayAuth } from '../hooks';
import { sspConfig } from '@storage/ssp';
import { AppState, NativeEventSubscription } from 'react-native';
import {
  evmSigningRequest,
  wkSigningRequest,
  vaultXpubRequest,
  vaultSigningRequest,
  utxo,
} from '../types';
import type { RecoveryRequestPayload } from '../lib/recoveryHandler';

interface TxRequest {
  rawTx: string;
  chain: string;
  path: string;
  utxos: utxo[];
}

interface SocketContextType {
  socket: Socket | null;
  newTx: TxRequest;
  clearTx?: () => void;
  publicNoncesRequest: boolean;
  clearPublicNoncesRequest?: () => void;
  evmSigningRequest: evmSigningRequest | null;
  clearEvmSigningRequest?: () => void;
  sendEvmSigningResponse?: (response: {
    requestId: string;
    approved: boolean;
    result?: unknown;
    error?: string;
  }) => void;
  wkSigningRequest: wkSigningRequest | null;
  clearWkSigningRequest?: () => void;
  vaultXpubRequest: vaultXpubRequest | null;
  clearVaultXpubRequest?: () => void;
  vaultSigningRequest: vaultSigningRequest | null;
  clearVaultSigningRequest?: () => void;
  keyNonceSyncRequest: boolean;
  clearKeyNonceSyncRequest?: () => void;
  fluxNodeStartRequest: Record<string, unknown> | null;
  clearFluxNodeStartRequest?: () => void;
  recoveryRequest: RecoveryRequestPayload | null;
  clearRecoveryRequest?: () => void;
  chainSyncRequest: string | null;
  clearChainSyncRequest?: () => void;
}

const defaultValue: SocketContextType = {
  socket: null,
  newTx: {
    rawTx: '',
    chain: '',
    path: '',
    utxos: [],
  },
  publicNoncesRequest: false,
  evmSigningRequest: null,
  wkSigningRequest: null,
  vaultXpubRequest: null,
  vaultSigningRequest: null,
  keyNonceSyncRequest: false,
  fluxNodeStartRequest: null,
  recoveryRequest: null,
  chainSyncRequest: null,
};

export const SocketContext = createContext<SocketContextType>(defaultValue);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const { sspWalletKeyInternalIdentity: wkIdentity } = useAppSelector(
    (state) => state.ssp,
  );
  const { createWkIdentityAuth, isAuthAvailable } = useRelayAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [newTx, setNewTx] = useState<TxRequest>({
    rawTx: '',
    chain: '',
    path: '',
    utxos: [],
  });
  const [publicNoncesRequest, setPublicNoncesRequest] = useState(false);
  const [evmSigningRequest, setEvmSigningRequest] =
    useState<evmSigningRequest | null>(null);
  const [wkSigningRequest, setWkSigningRequest] =
    useState<wkSigningRequest | null>(null);
  const [vaultXpubRequest, setVaultXpubRequest] =
    useState<vaultXpubRequest | null>(null);
  const [vaultSigningRequest, setVaultSigningRequest] =
    useState<vaultSigningRequest | null>(null);
  const [keyNonceSyncRequest, setKeyNonceSyncRequest] = useState(false);
  const [fluxNodeStartRequest, setFluxNodeStartRequest] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [recoveryRequest, setRecoveryRequest] =
    useState<RecoveryRequestPayload | null>(null);
  const [chainSyncRequest, setChainSyncRequest] = useState<string | null>(null);

  /**
   * Emit an authenticated join event.
   */
  const emitAuthenticatedJoin = useCallback(
    async (socketToUse: Socket, identity: string) => {
      try {
        if (isAuthAvailable) {
          // Create join data to hash
          const joinData = { wkIdentity: identity };
          const auth = await createWkIdentityAuth('join', identity, joinData);
          if (auth) {
            console.log('[Socket] Emitting authenticated join');
            socketToUse.emit('join', {
              ...joinData,
              ...auth,
            });
            return;
          }
        }
        // Fallback to unauthenticated join (for backward compatibility during transition)
        console.log(
          '[Socket] Emitting unauthenticated join (auth not available)',
        );
        socketToUse.emit('join', { wkIdentity: identity });
      } catch (error) {
        console.error('[Socket] Error creating auth for join:', error);
        // Fallback to unauthenticated join
        socketToUse.emit('join', { wkIdentity: identity });
      }
    },
    [createWkIdentityAuth, isAuthAvailable],
  );

  useEffect(() => {
    console.log('[Socket] Initializing SSP Key socket connection');
    if (!wkIdentity) {
      // Socket cleanup is handled by the effect's return function when wkIdentity changes
      return;
    }

    const newSocket = io(`https://${sspConfig().relay}`, {
      path: '/v1/socket/key',
      reconnectionAttempts: 100,
      timeout: 10000,
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected to SSP Relay');
      emitAuthenticatedJoin(newSocket, wkIdentity);
    });

    newSocket.on('connect_error', (error) => {
      console.error('[Socket] Connection Error', error);
    });

    newSocket.on('disconnect', () => {
      console.log('[Socket] Disconnected from SSP Relay');
    });

    // Handle transaction requests
    newSocket.on(
      'tx',
      (data: {
        payload: string;
        chain: string;
        path: string;
        utxos?: utxo[];
      }) => {
        console.log(
          '[Socket] Transaction request received for chain:',
          data.chain,
        );
        setNewTx({
          rawTx: data.payload,
          chain: data.chain,
          path: data.path,
          utxos: data.utxos || [],
        });
      },
    );

    // Handle public nonces requests
    newSocket.on('publicnoncesrequest', () => {
      console.log('[Socket] Public nonces request received');
      setPublicNoncesRequest(true);
    });

    // Handle EVM Signing Request requests from the enhanced action API
    newSocket.on(
      'evmsigningrequest',
      (data: { chain: string; path: string; payload: string }) => {
        console.log('[Socket] EVM Signing request received via action API');
        try {
          const parsedPayload = JSON.parse(data.payload) as evmSigningRequest;
          setEvmSigningRequest(parsedPayload);
        } catch {
          console.error('[Socket] Failed to parse EVM signing request payload');
        }
      },
    );

    // Handle WK Signing Request for wk_sign authentication
    newSocket.on(
      'wksigningrequest',
      (data: { chain: string; path: string; payload: string }) => {
        console.log('[Socket] WK Signing request received');
        try {
          const parsedPayload = JSON.parse(data.payload) as wkSigningRequest;
          setWkSigningRequest(parsedPayload);
        } catch {
          console.error('[Socket] Failed to parse WK signing request payload');
        }
      },
    );

    // Handle Enterprise Vault xpub request
    newSocket.on(
      'enterprisevaultxpub',
      (data: { chain: string; path: string; payload: string }) => {
        console.log('[Socket] Enterprise vault xpub request received');
        try {
          const parsedPayload = JSON.parse(data.payload) as vaultXpubRequest;
          setVaultXpubRequest(parsedPayload);
        } catch {
          console.error(
            '[Socket] Failed to parse enterprise vault xpub request payload',
          );
        }
      },
    );

    // Handle Enterprise Vault signing request
    newSocket.on(
      'enterprisevaultsign',
      (data: { chain: string; path: string; payload: string }) => {
        console.log(
          '[Socket] Enterprise vault signing request received, payload type:',
          typeof data.payload,
          'payload length:',
          typeof data.payload === 'string' ? data.payload.length : 'N/A',
        );
        try {
          const parsedPayload = JSON.parse(data.payload) as vaultSigningRequest;
          console.log(
            '[Socket] Parsed vault sign payload - recipients type:',
            typeof parsedPayload.recipients,
            'isArray:',
            Array.isArray(parsedPayload.recipients),
            'length:',
            Array.isArray(parsedPayload.recipients)
              ? parsedPayload.recipients.length
              : 'N/A',
          );
          setVaultSigningRequest(parsedPayload);
        } catch {
          console.error(
            '[Socket] Failed to parse enterprise vault signing request payload',
          );
        }
      },
    );

    // Handle Enterprise Flux Node Start request
    newSocket.on(
      'enterprisefluxnodestart',
      (data: { chain: string; path: string; payload: string }) => {
        console.log('[Socket] Enterprise flux node start request received');
        try {
          const parsedPayload = JSON.parse(data.payload) as Record<
            string,
            unknown
          >;
          setFluxNodeStartRequest(parsedPayload);
        } catch {
          console.error(
            '[Socket] Failed to parse enterprise flux node start payload',
          );
        }
      },
    );

    // Handle Enterprise Key Nonce Sync request
    newSocket.on('enterprisekeynoncesync', () => {
      console.log('[Socket] Enterprise key nonce sync request received');
      setKeyNonceSyncRequest(true);
    });

    // Handle RandomParams recovery request from the wallet. The wallet
    // issues this when its fingerprint drift causes L5 at Login and it
    // falls back to the ssp-key envelope recovery path.
    newSocket.on(
      'recoveryrequest',
      (data: { chain?: string; path?: string; payload: string }) => {
        console.log('[Socket] Recovery request received');
        try {
          const parsed = JSON.parse(data.payload) as RecoveryRequestPayload;
          if (
            typeof parsed.pkEph !== 'string' ||
            typeof parsed.nonce !== 'string' ||
            typeof parsed.timestamp !== 'number'
          ) {
            console.error('[Socket] Malformed recovery request payload');
            return;
          }
          setRecoveryRequest(parsed);
        } catch {
          console.error('[Socket] Failed to parse recovery request payload');
        }
      },
    );

    // Handle batch chain sync request from the wallet (versioned payload,
    // parsed and validated in Home via parseChainSyncRequest)
    newSocket.on(
      'chainsyncrequest',
      (data: { chain?: string; path?: string; payload: string }) => {
        console.log('[Socket] Chain sync request received');
        if (typeof data.payload !== 'string' || !data.payload) {
          console.error('[Socket] Malformed chain sync request payload');
          return;
        }
        setChainSyncRequest(data.payload);
      },
    );

    setSocket(newSocket);

    return () => {
      console.log('[Socket] Cleaning up socket connection');
      // Clear socket state immediately to prevent stale reference usage
      setSocket(null);
      if (newSocket.connected) {
        newSocket.emit('leave', { wkIdentity });
      }
      newSocket.close();
    };
  }, [wkIdentity]);

  // Tracks whether we emitted 'leave' on the way to background. iOS
  // briefly transitions to 'inactive' (not 'background') for system
  // overlays like Face ID, the control center pull-down, or an incoming
  // call banner. The socket stays connected through those, so we must
  // not re-join on the way back — re-joining causes the relay to
  // re-deliver the pending tx request, which surfaces in the UI as a
  // duplicate approval prompt right after a successful broadcast.
  const wasInBackground = useRef(false);

  useEffect(() => {
    let subscription: NativeEventSubscription | null = null;

    if (socket && wkIdentity) {
      subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          if (wasInBackground.current) {
            emitAuthenticatedJoin(socket, wkIdentity);
            wasInBackground.current = false;
          }
        } else if (state === 'background') {
          socket.emit('leave', { wkIdentity });
          wasInBackground.current = true;
        }
      });
    }

    // Cleanup: remove the event listener when component unmounts or dependencies change
    return () => {
      if (subscription) {
        subscription.remove();
      }
    };
  }, [socket, wkIdentity, emitAuthenticatedJoin]);

  const clearTx = () => {
    setNewTx({
      rawTx: '',
      chain: '',
      path: '',
      utxos: [],
    });
  };

  const clearPublicNoncesRequest = () => {
    setPublicNoncesRequest(false);
  };

  const clearEvmSigningRequest = () => {
    setEvmSigningRequest(null);
  };

  const clearWkSigningRequest = () => {
    setWkSigningRequest(null);
  };

  const clearVaultXpubRequest = () => {
    setVaultXpubRequest(null);
  };

  const clearVaultSigningRequest = () => {
    setVaultSigningRequest(null);
  };

  const clearFluxNodeStartRequest = () => {
    setFluxNodeStartRequest(null);
  };

  const clearKeyNonceSyncRequest = () => {
    setKeyNonceSyncRequest(false);
  };

  const clearRecoveryRequest = () => {
    setRecoveryRequest(null);
  };

  const clearChainSyncRequest = () => {
    setChainSyncRequest(null);
  };

  return (
    <SocketContext.Provider
      value={{
        socket,
        newTx,
        clearTx,
        publicNoncesRequest,
        clearPublicNoncesRequest,
        evmSigningRequest,
        clearEvmSigningRequest,
        wkSigningRequest,
        clearWkSigningRequest,
        vaultXpubRequest,
        clearVaultXpubRequest,
        vaultSigningRequest,
        clearVaultSigningRequest,
        keyNonceSyncRequest,
        clearKeyNonceSyncRequest,
        fluxNodeStartRequest,
        clearFluxNodeStartRequest,
        recoveryRequest,
        clearRecoveryRequest,
        chainSyncRequest,
        clearChainSyncRequest,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
