import {
  FirebaseMessagingTypes,
  getMessaging,
  requestPermission,
  registerDeviceForRemoteMessages,
  onNotificationOpenedApp,
  getInitialNotification,
  onMessage,
  setBackgroundMessageHandler,
  getToken,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import * as Keychain from 'react-native-keychain';
import notifee, { EventType } from '@notifee/react-native';
import { AppState, Platform } from 'react-native';

/**
 * Deep-link handler registry.
 *
 * The screen that renders pending signing requests (Home) registers a handler
 * here. When a signing-request notification is opened — whether the app was in
 * the foreground, background, or freshly launched from a quit state — we invoke
 * the handler so the app routes to / refreshes the pending request instead of
 * just silently coming to the foreground.
 *
 * A pending open (e.g. the app was launched from a quit-state notification
 * before any screen registered a handler) is buffered and flushed as soon as a
 * handler registers.
 */
type NotificationOpenHandler = () => void;
let notificationOpenHandler: NotificationOpenHandler | null = null;
let pendingNotificationOpen = false;

export function setNotificationOpenHandler(
  handler: NotificationOpenHandler | null,
): void {
  notificationOpenHandler = handler;
  if (handler && pendingNotificationOpen) {
    pendingNotificationOpen = false;
    handler();
  }
}

function handleNotificationOpen(): void {
  if (notificationOpenHandler) {
    notificationOpenHandler();
  } else {
    // No handler yet (e.g. launched from quit state). Buffer it so the handler
    // can pick it up once the screen mounts and registers.
    pendingNotificationOpen = true;
  }
}

export async function requestUserPermission() {
  const messaging = getMessaging();
  const authStatus = await requestPermission(messaging);
  const enabled =
    authStatus === AuthorizationStatus.AUTHORIZED ||
    authStatus === AuthorizationStatus.PROVISIONAL;

  if (enabled) {
    console.log('Authorization status:', authStatus);
  }
  if (Platform.OS === 'android') {
    // on ios already autoregistered
    await registerDeviceForRemoteMessages(messaging);
  }
  await notifee.requestPermission();
}

/**
 * Register Notifee's background event handler.
 *
 * MUST be called from `index.js` (top level, before AppRegistry.registerComponent)
 * per Notifee's docs. Without this, tapping a Notifee-displayed notification
 * while the app is in the background does not resume the application —
 * Notifee drops the press event because no handler is attached to the
 * headless JS task that runs for background events.
 *
 * `pressAction: { id: 'default' }` on the displayed notification handles
 * bringing the app to foreground; this listener just has to exist so the
 * native side will actually dispatch the press.
 */
// eslint-disable-next-line @typescript-eslint/require-await
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.PRESS) {
    // Opening the app is the default action, handled by the native side
    // (pressAction id 'default'). We additionally buffer a deep-link so the
    // Home screen routes to the pending request once it mounts.
    console.log(
      '[fcm] background notification pressed:',
      detail.notification?.id,
    );
    handleNotificationOpen();
  }
});

export function notificationListener() {
  const messaging = getMessaging();

  // Foreground tap handler — notifications displayed by Notifee while the
  // app is open don't route through `onNotificationOpenedApp` (that's FCM
  // auto-delivered only). Without this handler, tapping the in-app
  // notification does nothing.
  notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS) {
      console.log(
        '[fcm] foreground notification pressed:',
        detail.notification?.id,
      );
      handleNotificationOpen();
    }
  });

  // FCM-delivered notification tapped while the app was backgrounded.
  // (Notifee-displayed notifications route through onForegroundEvent /
  // onBackgroundEvent instead; this covers OS-rendered notification payloads.)
  onNotificationOpenedApp(messaging, (remoteMessage) => {
    console.log(
      'Notification caused app to open from background state:',
      remoteMessage.notification,
    );
    handleNotificationOpen();
  });

  // App launched from a quit state by tapping a notification — deep-link to the
  // pending request. Buffered until the Home screen registers its handler.
  getInitialNotification(messaging).then((remoteMessage) => {
    if (remoteMessage) {
      console.log(
        'Notification caused app to open from quit state:',
        remoteMessage.notification,
      );
      handleNotificationOpen();
    }
  });

  onMessage(messaging, onMessageReceived);
}

export function onBackgroundMessageHandler() {
  const messaging = getMessaging();
  setBackgroundMessageHandler(messaging, onMessageReceived);
}

async function onMessageReceived(
  message: FirebaseMessagingTypes.RemoteMessage,
) {
  // While the app is in the foreground the OS does NOT render the message's
  // notification payload, so we must present it ourselves via Notifee.
  //
  // While the app is backgrounded or in a quit state, React Native Firebase
  // lets the OS render the notification payload automatically — we must NOT
  // suppress it here (the previous `!== 'background'` early-return swallowed
  // exactly the signing-request push that tells the co-signer to approve).
  // Re-displaying via Notifee in the background would risk a duplicate, so we
  // only display while the app is actively in the foreground.
  if (AppState.currentState === 'active') {
    await displayNotification((message?.notification as any) ?? {});
  }
}

async function displayNotification(message: Record<string, string>) {
  // Create a channel (required for Android)
  const channelId = await notifee.createChannel({
    id: 'default',
    name: 'Default Channel',
    vibration: true,
    vibrationPattern: [300, 500],
  });
  // Display a notification
  await notifee.displayNotification({
    ...message,
    android: {
      channelId,
      // pressAction is needed if you want the notification to open the app when pressed
      pressAction: {
        id: 'default',
      },
      // Reference the name created (Optional, defaults to 'ic_launcher')
      smallIcon: 'ic_stat_name',
      // Set color of icon (Optional, defaults to white)
      color: '#131314',
    },
  });
}

export async function getFCMToken() {
  try {
    const token = await Keychain.getGenericPassword({
      service: 'fcm_key_token',
    });

    // our token may not be valid anymore, on app boot run refresh function
    if (token) {
      return token.password;
    }

    const messaging = getMessaging();
    const newToken = await getToken(messaging);
    await Keychain.setGenericPassword('fcm_key_token', newToken, {
      service: 'fcm_key_token',
      storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    return newToken;
  } catch (error) {
    console.error(error);
    return null;
  }
}

export async function refreshFCMToken() {
  try {
    const messaging = getMessaging();
    const token = await getToken(messaging);
    if (token) {
      await Keychain.setGenericPassword('fcm_key_token', token, {
        service: 'fcm_key_token',
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
  } catch (error) {
    console.error(error);
  }
}
