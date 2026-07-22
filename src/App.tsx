import 'react-native-reanimated';
import 'react-native-gesture-handler';
import 'react-native-quick-crypto';
import './lib/axiosConfig'; // Setup axios interceptors for SSP infrastructure
import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/lib/integration/react';
import { store, persistor } from './store';
import ApplicationNavigator from './navigators/Application';
import './translations';
import { Buffer } from 'buffer';
import 'fastestsmallesttextencoderdecoder';
import { SocketProvider } from './contexts/SocketContext';
import { PrivacyProvider } from './contexts/PrivacyContext';
import { notificationListener, requestUserPermission } from './lib/fcmHelper';
import ToastNotif from './components/Toast/Toast';
import BlurOverlay from './BlurOverlay';

if (!global.Buffer) {
  global.Buffer = Buffer;
}

const App = () => {
  const alreadyMounted = useRef(false); // as of react strict mode, useEffect is triggered twice. This is a hack to prevent that without disabling strict mode
  useEffect(() => {
    if (alreadyMounted.current) {
      return;
    }
    alreadyMounted.current = true;
    requestUserPermission();
    notificationListener();
    // @TODO this still does not prevent modal screenshot, unable to find a solution, notify user that screenshot was taken - unable to find a solution
    // only package that works is rn-screenshot-prevent, but it does not work on modal, enable screenshots on iOS to not cause confusion. Android uses secure FLAG_SECURE
  });

  return (
    // GestureHandlerRootView is required for react-native-gesture-handler v2
    // gesture detectors (SlideToApprove) to receive touches on Android.
    // Renders as a plain View — no visual or behavioral change otherwise.
    <GestureHandlerRootView style={styles.root}>
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
            <PrivacyProvider>
              <ApplicationNavigator />
              <BlurOverlay />
            </PrivacyProvider>
          </SocketProvider>
        </PersistGate>
        <ToastNotif />
      </Provider>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export default App;
