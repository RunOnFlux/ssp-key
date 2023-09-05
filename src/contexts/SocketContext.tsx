import React, { createContext, useState, useEffect } from 'react';
import io, { Socket } from 'socket.io-client';
import { useAppSelector } from 'ssp-key/src/hooks';
import { sspConfig } from '@storage/ssp';
import { AppState } from 'react-native';

interface SocketContextType {
  socket: Socket | null;
  newTx: string;
  clearTx?: () => void;
}

const defaultValue: SocketContextType = {
  socket: null,
  newTx: '',
};

export const SocketContext = createContext<SocketContextType>(defaultValue);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const { sspWalletKeyIdentity: wkIdentity } = useAppSelector(
    (state) => state.flux,
  );
  const [socket, setSocket] = useState<Socket | null>(null);
  const [newTx, setNewTx] = useState('');

  useEffect(() => {
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

    newSocket.emit('join', {
      wkIdentity,
    });

    newSocket.on('tx', ({ tx }) => {
      setNewTx(tx.payload);
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
    setNewTx('');
  };

  return (
    <SocketContext.Provider value={{ socket, newTx: newTx, clearTx }}>
      {children}
    </SocketContext.Provider>
  );
};
