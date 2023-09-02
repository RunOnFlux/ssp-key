import React, { createContext, useState, useEffect } from 'react';
import io, { Socket } from 'socket.io-client';
import { useAppSelector } from 'ssp-key/src/hooks';
import { sspConfig } from '@storage/ssp';
import { Vibration } from 'react-native';
import notifee from '@notifee/react-native';

interface SocketContextType {
  socket: Socket | null;
  newTx: string;
  clearTx?:() => void;
}

const defaultValue: SocketContextType = {
  socket: null,
  newTx:''
};

export const SocketContext = createContext<SocketContextType>(defaultValue);

export const SocketProvider = ({ children }: { children: React.ReactNode }) => {
  const { sspWalletKeyIdentity } = useAppSelector((state) => state.flux);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [newTx, setNewTx] = useState('');

  useEffect(() => {
    if (!sspWalletKeyIdentity) {
      return;
    }

    const newSocket = io(
      `https://${sspConfig().relay}`,
      {
        reconnectionAttempts: 3,
        timeout: 10000,
      },
    );

    newSocket.on('connect_error', (error) => {
      console.error('Connection Error', error);
    });

    newSocket.emit("join", {
      id: sspWalletKeyIdentity
    });

    newSocket.on("tx", ({tx}) => {
      setNewTx(tx.payload);   
      Vibration.vibrate();
      displayNotification();
    });

    setSocket(newSocket);
    return () => {
      newSocket.close();
    };
  }, [sspWalletKeyIdentity]);

  const clearTx = () => {
    setNewTx('');
  }

  async function displayNotification() {
    await notifee.requestPermission();
    // Create a channel (required for Android)
    const channelId = await notifee.createChannel({
      id: 'default',
      name: 'Default Channel',
    });

    // Display a notification
    await notifee.displayNotification({
      title: 'New transaction received',
      body: 'Please confirm or reject if not initiated by you',
      android: {
        channelId,
        // pressAction is needed if you want the notification to open the app when pressed
        pressAction: {
          id: 'default',
        },
      },
    });
  }


  return (
    <SocketContext.Provider value={{ socket, newTx: newTx, clearTx }}>
      {children}
    </SocketContext.Provider>
  );
};


