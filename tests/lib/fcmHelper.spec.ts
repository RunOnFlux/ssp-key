/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import sinon from 'sinon';
import httpMocks from 'node-mocks-http';
import axios from 'axios';
import utxolib from '@runonflux/utxo-lib';

import messaging, {
  FirebaseMessagingTypes,
} from '@react-native-firebase/messaging';

import { AppState, Platform } from 'react-native';
import notifee from '@notifee/react-native';
import EncryptedStorage from 'react-native-encrypted-storage';

import { 
    requestUserPermission,
    notificationListener,
    onBackgroundMessageHandler,
    getFCMToken,
    refreshFCMToken
} from '../../src/lib/fcmHelper';

const { expect, assert } = chai;

describe('FCM Helper Lib', () => {
  describe('Verifies helper', () => {
    afterEach(function() {
      sinon.restore();
    });

    it('should return success data when requestUserPermission', async () => {
      await sinon.stub(messaging, "requestPermission").returns(1);
      await sinon.stub(Platform, "OS").returns('android');
      await requestUserPermission();
    });

    it('should return success data when notificationListener', async () => {
      await sinon.stub(notifee, "onBackgroundEvent").returns({type:"type", detail:"detail"});
      await sinon.stub(messaging, "onNotificationOpenedApp").returns({notification:"Sample Notification"});
      await sinon.stub(messaging, "getInitialNotification").returns({notification:"Sample Notification"});
      await notificationListener();
    });

    it('should return success data when onBackgroundMessageHandler', async () => {
      await onBackgroundMessageHandler();
    });

    it('should return success data when getFCMToken', async () => {
      await sinon.stub(EncryptedStorage, "getItem").returns({fcmkeytoken:"token"});
      const res = await getFCMToken();
      assert.equal(res, "token");
    });

    it('should return success data when getFCMToken is undefined', async () => {
      await sinon.stub(EncryptedStorage, "getItem").returns({fcmkeytoken:undefined});
      await sinon.stub(messaging, "getToken").returns("token");
      const res = await getFCMToken();
      assert.equal(res, "token");
    });

    it('should return success data when getFCMToken is empty', async () => {
      await sinon.stub(EncryptedStorage, "getItem").returns({});
      await sinon.stub(messaging, "getToken").returns("token");
      const res = await getFCMToken();
      assert.equal(res, "token");
    });

    it.skip('should return error data when getFCMToken is not avail', async () => {
      await sinon.stub(EncryptedStorage, "getItem").returns({});
      await sinon.stub(messaging, "getToken").returns("token");
      const res = await getFCMToken();
      assert.equal(res, "Error: ");
    });

    it('should return success data when refreshFCMToken is avail', async () => {
      await sinon.stub(messaging, "getToken").returns("token");
      await refreshFCMToken();
    });

    it('should return success data when refreshFCMToken is undefined', async () => {
      await sinon.stub(messaging, "getToken").returns(undefined);
      await refreshFCMToken();
    });
  });
});