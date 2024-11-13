// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck need to fix
import { restore, stub } from 'sinon';
import messaging from '@react-native-firebase/messaging';
import { Platform } from 'react-native';
import notifee from '@notifee/react-native';
import EncryptedStorage from 'react-native-encrypted-storage';

import {
  requestUserPermission,
  notificationListener,
  onBackgroundMessageHandler,
  getFCMToken,
  refreshFCMToken,
} from '../../src/lib/fcmHelper';

describe('FCM Helper Lib', () => {
  describe('Verifies helper', () => {
    afterEach(() => {
      restore();
    });

    test('should return success data when requestUserPermission', async () => {
      stub(messaging, 'requestPermission').returns(1);
      stub(Platform, 'OS').returns('android');
      await requestUserPermission();
    });

    test('should return success data when notificationListener', () => {
      stub(notifee, 'onBackgroundEvent').returns({
        type: 'type',
        detail: 'detail',
      });
      stub(messaging, 'onNotificationOpenedApp').returns({
        notification: 'Sample Notification',
      });
      stub(messaging, 'getInitialNotification').returns({
        notification: 'Sample Notification',
      });
      notificationListener();
    });

    test('should return success data when onBackgroundMessageHandler', () => {
      onBackgroundMessageHandler();
    });

    test('should return success data when getFCMToken', async () => {
      stub(EncryptedStorage, 'getItem').returns({ fcmkeytoken: 'token' });
      const res = await getFCMToken();
      expect(res).toBe('token');
    });

    test('should return success data when getFCMToken is undefined', async () => {
      stub(EncryptedStorage, 'getItem').returns({
        fcmkeytoken: undefined,
      });
      stub(messaging, 'getToken').returns('token');
      const res = await getFCMToken();
      expect(res).toBe('token');
    });

    test('should return success data when getFCMToken is empty', async () => {
      stub(EncryptedStorage, 'getItem').returns({});
      stub(messaging, 'getToken').returns('token');
      const res = await getFCMToken();
      expect(res).toBe('token');
    });

    test.skip('should return error data when getFCMToken is not avail', async () => {
      stub(EncryptedStorage, 'getItem').returns({});
      stub(messaging, 'getToken').returns('token');
      const res = await getFCMToken();
      expect(res).toBe('Error: ');
    });

    test('should return success data when refreshFCMToken is avail', async () => {
      stub(messaging, 'getToken').returns('token');
      await refreshFCMToken();
    });

    test('should return success data when refreshFCMToken is undefined', async () => {
      stub(messaging, 'getToken').returns(undefined);
      await refreshFCMToken();
    });
  });
});
