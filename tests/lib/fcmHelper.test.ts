import { restore, stub } from 'sinon';
import { Platform } from 'react-native';

// Mock messaging instance
const mockMessagingInstance = {};

// Mock notifee module
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    onBackgroundEvent: jest.fn(),
    requestPermission: jest.fn(),
    createChannel: jest.fn(),
    displayNotification: jest.fn(),
  },
}));

// Mock keychain module
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'AESGCMNoAuth' },
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' },
}));

// Mock Firebase messaging module
jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  getMessaging: jest.fn(() => mockMessagingInstance),
  requestPermission: jest.fn(),
  registerDeviceForRemoteMessages: jest.fn(),
  onNotificationOpenedApp: jest.fn(),
  getInitialNotification: jest.fn(),
  onMessage: jest.fn(),
  setBackgroundMessageHandler: jest.fn(),
  getToken: jest.fn(),
  AuthorizationStatus: {
    AUTHORIZED: 1,
    PROVISIONAL: 2,
  },
}));

// Import after mocks
import notifee from '@notifee/react-native';
import * as Keychain from 'react-native-keychain';
import * as messaging from '@react-native-firebase/messaging';

import {
  requestUserPermission,
  notificationListener,
  onBackgroundMessageHandler,
  getFCMToken,
  refreshFCMToken,
} from '../../src/lib/fcmHelper';

// Get typed references to the mocked notifee methods
const mockedNotifee = jest.mocked(notifee);

describe('FCM Helper Lib', () => {
  describe('Verifies helper', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      restore();
    });

    test('should return success data when requestUserPermission', async () => {
      (messaging.requestPermission as jest.Mock).mockResolvedValue(1);
      stub(Platform, 'OS').value('android');
      (
        messaging.registerDeviceForRemoteMessages as jest.Mock
      ).mockResolvedValue(undefined);
      mockedNotifee.requestPermission.mockResolvedValue(undefined as never);

      await requestUserPermission();

      expect(messaging.getMessaging).toHaveBeenCalled();
      expect(messaging.requestPermission).toHaveBeenCalledWith(
        mockMessagingInstance,
      );
      expect(messaging.registerDeviceForRemoteMessages).toHaveBeenCalledWith(
        mockMessagingInstance,
      );
      expect(mockedNotifee.requestPermission).toHaveBeenCalled();
    });

    test('should return success data when notificationListener', () => {
      (messaging.onNotificationOpenedApp as jest.Mock).mockImplementation(
        () => {},
      );
      (messaging.getInitialNotification as jest.Mock).mockResolvedValue({
        notification: 'Sample Notification',
      });
      (messaging.onMessage as jest.Mock).mockImplementation(() => {});
      mockedNotifee.onBackgroundEvent.mockImplementation(() => {});

      notificationListener();

      expect(messaging.getMessaging).toHaveBeenCalled();
      expect(messaging.onNotificationOpenedApp).toHaveBeenCalledWith(
        mockMessagingInstance,
        expect.any(Function),
      );
      expect(messaging.getInitialNotification).toHaveBeenCalledWith(
        mockMessagingInstance,
      );
      expect(messaging.onMessage).toHaveBeenCalledWith(
        mockMessagingInstance,
        expect.any(Function),
      );
      expect(mockedNotifee.onBackgroundEvent).toHaveBeenCalled();
    });

    test('should return success data when onBackgroundMessageHandler', () => {
      (messaging.setBackgroundMessageHandler as jest.Mock).mockImplementation(
        () => {},
      );

      onBackgroundMessageHandler();

      expect(messaging.getMessaging).toHaveBeenCalled();
      expect(messaging.setBackgroundMessageHandler).toHaveBeenCalledWith(
        mockMessagingInstance,
        expect.any(Function),
      );
    });

    test('should return success data when getFCMToken with existing token', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue({
        password: 'existing-token',
      });

      const res = await getFCMToken();

      expect(res).toBe('existing-token');
    });

    test('should return success data when getFCMToken with new token', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockResolvedValue(false);
      (messaging.getToken as jest.Mock).mockResolvedValue('new-token');
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      const res = await getFCMToken();

      expect(res).toBe('new-token');
      expect(messaging.getMessaging).toHaveBeenCalled();
      expect(messaging.getToken).toHaveBeenCalledWith(mockMessagingInstance);
    });

    test('should return null when getFCMToken fails', async () => {
      (Keychain.getGenericPassword as jest.Mock).mockRejectedValue(
        new Error('Keychain error'),
      );

      const res = await getFCMToken();

      expect(res).toBe(null);
    });

    test('should return success data when refreshFCMToken with token', async () => {
      (messaging.getToken as jest.Mock).mockResolvedValue('refresh-token');
      (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

      await refreshFCMToken();

      expect(messaging.getMessaging).toHaveBeenCalled();
      expect(messaging.getToken).toHaveBeenCalledWith(mockMessagingInstance);
    });

    test('should handle refreshFCMToken when no token', async () => {
      (messaging.getToken as jest.Mock).mockResolvedValue(undefined);

      await refreshFCMToken();

      expect(messaging.getMessaging).toHaveBeenCalled();
      expect(messaging.getToken).toHaveBeenCalledWith(mockMessagingInstance);
    });
  });
});
