import 'react-native-reanimated';
import 'react-native-gesture-handler';
import 'react-native-quick-crypto';
import React, { useEffect } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/lib/integration/react';
import { store, persistor } from './store';
import ApplicationNavigator from './navigators/Application';
import './translations';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { btoa, atob } from 'react-native-quick-base64';
import { Buffer } from 'buffer';
import 'fastestsmallesttextencoderdecoder';
import Toast from 'react-native-toast-message';
import { SocketProvider } from './contexts/SocketContext';

if (!global.btoa) {
  global.btoa = btoa;
}

if (!global.atob) {
  global.atob = atob;
}

if (!global.Buffer) {
  global.Buffer = Buffer;
}

const App = () => {

  useEffect(() => {
    (async()=>{
      const settings =  await notifee.requestPermission();
      if (settings.authorizationStatus === AuthorizationStatus.DENIED) {
        console.log('User denied permissions request');
      } else if (settings.authorizationStatus === AuthorizationStatus.AUTHORIZED) {
         console.log('User granted permissions request');
      } else if (settings.authorizationStatus === AuthorizationStatus.PROVISIONAL) {
         console.log('User provisionally granted permissions request');
      }
    })();

      notifee.onBackgroundEvent(async ({ type, detail }) => {
        // Handle background events here
        console.log("type ", type);
        console.log("type ", detail);
      });
      
  }, []);


  return (
    <Provider store={store}>
      {/**
       * PersistGate delays the rendering of the app's UI until the persisted state has been retrieved
       * and saved to redux.
       * The `loading` prop can be `null` or any react instance to show during loading (e.g. a splash screen),
       * for example `loading={<SplashScreen />}`.
       * @see https://github.com/rt2zz/redux-persist/blob/master/docs/PersistGate.md
       */}
      <PersistGate loading={null} persistor={persistor}>
        <SocketProvider>
          <ApplicationNavigator />
        </SocketProvider>
      </PersistGate>
      <Toast />
    </Provider>
  );
};

export default App;
