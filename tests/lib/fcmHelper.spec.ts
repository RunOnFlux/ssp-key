// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import { restore, stub } from 'sinon';
import { describe, it } from 'mocha';

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

const { assert } = chai;

describe('FCM Helper Lib', () => {
  describe('Verifies helper', () => {
    afterEach(function () {
      restore();
    });

    it('should return success data when requestUserPermission', async () => {
      await stub(messaging, 'requestPermission').returns(1);
      await stub(Platform, 'OS').returns('android');
      await requestUserPermission();
    });

    it('should return success data when notificationListener', async () => {
      await stub(notifee, 'onBackgroundEvent').returns({
        type: 'type',
        detail: 'detail',
      });
      await stub(messaging, 'onNotificationOpenedApp').returns({
        notification: 'Sample Notification',
      });
      await stub(messaging, 'getInitialNotification').returns({
        notification: 'Sample Notification',
      });
      await notificationListener();
    });

    it('should return success data when onBackgroundMessageHandler', async () => {
      await onBackgroundMessageHandler();
    });

    it('should return success data when getFCMToken', async () => {
      await stub(EncryptedStorage, 'getItem').returns({ fcmkeytoken: 'token' });
      const res = await getFCMToken();
      assert.equal(res, 'token');
    });

    it('should return success data when getFCMToken is undefined', async () => {
      await stub(EncryptedStorage, 'getItem').returns({
        fcmkeytoken: undefined,
      });
      await sinon.stub(messaging, 'getToken').returns('token');
      const res = await getFCMToken();
      assert.equal(res, 'token');
    });

    it('should return success data when getFCMToken is empty', async () => {
      await stub(EncryptedStorage, 'getItem').returns({});
      await stub(messaging, 'getToken').returns('token');
      const res = await getFCMToken();
      assert.equal(res, 'token');
    });

    it.skip('should return error data when getFCMToken is not avail', async () => {
      await stub(EncryptedStorage, 'getItem').returns({});
      await stub(messaging, 'getToken').returns('token');
      const res = await getFCMToken();
      assert.equal(res, 'Error: ');
    });

    it('should return success data when refreshFCMToken is avail', async () => {
      await stub(messaging, 'getToken').returns('token');
      await refreshFCMToken();
    });

    it('should return success data when refreshFCMToken is undefined', async () => {
      await stub(messaging, 'getToken').returns(undefined);
      await refreshFCMToken();
    });
  });
});
