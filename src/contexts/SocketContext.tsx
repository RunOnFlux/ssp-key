import React, { createContext, useState, useEffect, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { useAppSelector } from '../hooks';
import { useRelayAuth } from '../hooks';
import { sspConfig } from '@storage/ssp';
import { AppState, NativeEventSubscription } from 'react-native';
import { evmSigningRequest, wkSigningRequest, utxo } from '../types';

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
        console.log('[Socket] Emitting unauthenticated join (auth not available)');
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

    setSocket(newSocket);

    return () => {
      console.log('[Socket] Cleaning up socket connection');
      newSocket.close();
    };
  }, [wkIdentity]);

  useEffect(() => {
    let subscription: NativeEventSubscription | null = null;

    if (socket && wkIdentity) {
      subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          emitAuthenticatedJoin(socket, wkIdentity);
        } else if (state === 'background') {
          socket.emit('leave', { wkIdentity });
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
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
