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
import notifee from '@notifee/react-native';
import { AppState, Platform } from 'react-native';

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

export function notificationListener() {
  const messaging = getMessaging();

  // eslint-disable-next-line @typescript-eslint/require-await
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    console.log('type ', type);
    console.log('detail ', detail);
  });

  onNotificationOpenedApp(messaging, (remoteMessage) => {
    //we can use this event to move particular screen when user click the notification and app is killed state
    console.log(
      'Notification caused app to open from background state:',
      remoteMessage.notification,
    );
  });

  // Check whether an initial notification is available
  getInitialNotification(messaging).then((remoteMessage) => {
    if (remoteMessage) {
      console.log(
        'Notification caused app to open from quit state:',
        remoteMessage.notification,
      );
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
  if (AppState.currentState !== 'background') {
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
