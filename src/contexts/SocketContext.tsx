import React, { createContext, useState, useEffect } from 'react';
import io, { Socket } from 'socket.io-client';
import { useAppSelector } from '../hooks';
import { sspConfig } from '@storage/ssp';
import { AppState } from 'react-native';
import { evmSigningRequest } from '../types';

interface TxRequest {
  rawTx: string;
  chain: string;
  path: string;
  utxos: any[];
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
};

export const SocketContext = createContext<SocketContextType>(defaultValue);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const { sspWalletKeyInternalIdentity: wkIdentity } = useAppSelector(
    (state) => state.ssp,
  );
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
  const [socketIdentiy, setSocketIdentity] = useState('');

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
    });

    newSocket.on('connect_error', (error) => {
      console.error('[Socket] Connection Error', error);
    });

    newSocket.on('disconnect', () => {
      console.log('[Socket] Disconnected from SSP Relay');
    });

    // Leave previous session if identity changed
    if (socketIdentiy) {
      newSocket.emit('leave', { wkIdentity: socketIdentiy });
    }
    setSocketIdentity(wkIdentity);

    // Join new session
    newSocket.emit('join', { wkIdentity });

    // Handle transaction requests
    newSocket.on('tx', (data: any) => {
      console.log('[Socket] Transaction request received:', data);
      setNewTx({
        rawTx: data.payload,
        chain: data.chain,
        path: data.path,
        utxos: data.utxos || [],
      });
    });

    // Handle public nonces requests
    newSocket.on('publicnoncesrequest', () => {
      console.log('[Socket] Public nonces request received');
      setPublicNoncesRequest(true);
    });

    // Handle EVM Signing Request requests from the enhanced action API
    newSocket.on(
      'evmsigningrequest',
      (data: { chain: string; path: string; payload: string }) => {
        console.log(
          '[Socket] EVM Signing request received via action API:',
          data,
        );
        setEvmSigningRequest(JSON.parse(data.payload) as evmSigningRequest);
      },
    );

    setSocket(newSocket);

    return () => {
      console.log('[Socket] Cleaning up socket connection');
      newSocket.close();
    };
  }, [wkIdentity, socketIdentiy]);

  useEffect(() => {
    if (socket) {
      AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          socket.emit('join', {
            wkIdentity,
          });
        } else if (state === 'background') {
          socket?.emit('leave', { wkIdentity });
        }
      });
    }
  }, [socket, wkIdentity]);

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
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
