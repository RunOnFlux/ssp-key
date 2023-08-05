import 'react-native-reanimated';
import 'react-native-get-random-values';
import 'react-native-gesture-handler';
import React from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/lib/integration/react';
import { store, persistor } from './store';
import ApplicationNavigator from './navigators/Application';
import './translations';

import { decode, encode } from 'base-64';
import { Buffer } from 'buffer';
import 'fastestsmallesttextencoderdecoder';
import PolyfillCrypto from 'react-native-webview-crypto';

if (!global.btoa) {
  global.btoa = encode;
}

if (!global.atob) {
  global.atob = decode;
}

if (!global.Buffer) {
  global.Buffer = Buffer;
}

const App = () => (
  <Provider store={store}>
    <PolyfillCrypto debug={true} />
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
  </Provider>
);

export default App;
