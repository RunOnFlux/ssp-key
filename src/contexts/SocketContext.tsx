import React, { createContext, useState, useEffect } from 'react';
import io, { Socket } from 'socket.io-client';
import { useAppSelector } from 'ssp-key/src/hooks';
import { sspConfig } from '@storage/ssp';
import { AppState } from 'react-native';

interface SocketContextType {
  socket: Socket | null;
  newTx: adjustedServeResponseTx;
  clearTx?: () => void;
}

interface serverResponse {
  payload: string;
  action: string;
  wkIdentity: string;
  chain: string;
  path: string;
}

interface adjustedServeResponseTx {
  rawTx: string;
  chain: string;
  path: string;
}

const defaultValue: SocketContextType = {
  socket: null,
  newTx: {} as adjustedServeResponseTx,
};

export const SocketContext = createContext<SocketContextType>(defaultValue);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const { sspWalletKeyIdentity: wkIdentity } = useAppSelector(
    (state) => state.flux,
  );
  const [socket, setSocket] = useState<Socket | null>(null);
  const [newTx, setNewTx] = useState({} as adjustedServeResponseTx);
  const [socketIdentiy, setSocketIdentity] = useState('');

  useEffect(() => {
    console.log('socket init');
    if (!wkIdentity) {
      return;
    }

    const newSocket = io(`https://${sspConfig().relay}`, {
      path: '/v1/socket/key',
      reconnectionAttempts: 100,
      timeout: 10000,
    });

    newSocket.on('connect_error', (error) => {
      console.error('Connection Error', error);
    });

    // leave if identity changed
    if (socketIdentiy) {
      newSocket.emit('leave', { wkIdentity: socketIdentiy });
    }
    setSocketIdentity(wkIdentity);

    newSocket.emit('join', {
      wkIdentity,
    });

    newSocket.on('tx', (tx: serverResponse) => {
      console.log('incoming tx');
      console.log(tx);
      const adjustedTx = {
        chain: tx.chain,
        path: tx.path,
        rawTx: tx.payload,
      };
      setNewTx(adjustedTx);
    });

    setSocket(newSocket);
    return () => {
      newSocket.close();
    };
  }, [wkIdentity]);

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
    setNewTx({} as adjustedServeResponseTx);
  };

  return (
    <SocketContext.Provider value={{ socket, newTx: newTx, clearTx }}>
      {children}
    </SocketContext.Provider>
  );
};
