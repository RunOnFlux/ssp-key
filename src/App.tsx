import 'react-native-reanimated';
import 'react-native-gesture-handler';
import 'react-native-quick-crypto';
import React from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/lib/integration/react';
import { store, persistor } from './store';
import ApplicationNavigator from './navigators/Application';
import './translations';

import { btoa, atob } from 'react-native-quick-base64';
import { Buffer } from 'buffer';
import 'fastestsmallesttextencoderdecoder';
import Toast from 'react-native-toast-message';

if (!global.btoa) {
  global.btoa = btoa;
}

if (!global.atob) {
  global.atob = atob;
}

if (!global.Buffer) {
  global.Buffer = Buffer;
}

const App = () => (
  <Provider store={store}>
    {/**
     * PersistGate delays the rendering of the app's UI until the persisted state has been retrieved
     * and saved to redux.
     * The `loading` prop can be `null` or any react instance to show during loading (e.g. a splash screen),
     * for example `loading={<SplashScreen />}`.
     * @see https://github.com/rt2zz/redux-persist/blob/master/docs/PersistGate.md
     */}
    <PersistGate loading={null} persistor={persistor}>
      <ApplicationNavigator />
    </PersistGate>
    <Toast />
  </Provider>
);

export default App;
