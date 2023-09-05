import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';
import EncryptedStorage from 'react-native-encrypted-storage';
import notifee from '@notifee/react-native';

export async function requestUserPermission() {
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;

  if (enabled) {
    console.log('Authorization status:', authStatus);
  }
  await messaging().registerDeviceForRemoteMessages();
  await notifee.requestPermission();
}

export async function notificationListener() {
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    console.log('type ', type);
    console.log('detail ', detail);
  });

  messaging().onNotificationOpenedApp((remoteMessage) => {
    //we can use this event to move particular screen when user click the notification and app is killed state
    console.log(
      'Notification caused app to open from background state:',
      remoteMessage.notification,
    );
  });

  // Check whether an initial notification is available
  messaging()
    .getInitialNotification()
    .then((remoteMessage) => {
      if (remoteMessage) {
        console.log(
          'Notification caused app to open from quit state:',
          remoteMessage.notification,
        );
      }
    });

  messaging().onMessage(onMessageReceived);
}

export async function onBackgroundMessageHandler() {
  messaging().setBackgroundMessageHandler(onMessageReceived);
}

async function onMessageReceived(
  message: FirebaseMessagingTypes.RemoteMessage,
) {
  await displayNotification((message?.notification as any) ?? {});
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
    },
  });
}

export async function getFCMToken() {
  try {
    let token = await EncryptedStorage.getItem('fcmkeytoken');

    if (token) {
      return token;
    }

    token = await messaging().getToken();

    await EncryptedStorage.setItem('fcmkeytoken', token);

    return token;
  } catch (error) {
    console.error(error);
    return null;
  }
}
