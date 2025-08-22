import { restore, stub } from 'sinon';
import { Platform } from 'react-native';

// Mock notifee module
const mockNotifee = {
  onBackgroundEvent: jest.fn(),
  requestPermission: jest.fn(),
  createChannel: jest.fn(),
  displayNotification: jest.fn(),
};
jest.mock('@notifee/react-native', () => mockNotifee);

// Mock keychain module
const mockKeychain = {
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'AESGCMNoAuth' },
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WhenUnlockedThisDeviceOnly' },
};
jest.mock('react-native-keychain', () => mockKeychain);

// Mock Firebase messaging module
const mockMessagingInstance = {};

const mockMessaging = {
  getMessaging: jest.fn().mockReturnValue(mockMessagingInstance),
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
};

jest.mock('@react-native-firebase/messaging', () => mockMessaging);

import {
  requestUserPermission,
  notificationListener,
  onBackgroundMessageHandler,
  getFCMToken,
  refreshFCMToken,
} from '../../src/lib/fcmHelper';

describe('FCM Helper Lib', () => {
  describe('Verifies helper', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      restore();
    });

    test('should return success data when requestUserPermission', async () => {
      mockMessaging.requestPermission.mockResolvedValue(1);
      stub(Platform, 'OS').value('android');
      mockMessaging.registerDeviceForRemoteMessages.mockResolvedValue(
        undefined,
      );
      mockNotifee.requestPermission.mockResolvedValue(undefined);

      await requestUserPermission();

      expect(mockMessaging.getMessaging).toHaveBeenCalled();
      expect(mockMessaging.requestPermission).toHaveBeenCalledWith(mockMessagingInstance);
      expect(mockMessaging.registerDeviceForRemoteMessages).toHaveBeenCalledWith(mockMessagingInstance);
      expect(mockNotifee.requestPermission).toHaveBeenCalled();
    });

    test('should return success data when notificationListener', () => {
      mockMessaging.onNotificationOpenedApp.mockImplementation(() => {});
      mockMessaging.getInitialNotification.mockResolvedValue({
        notification: 'Sample Notification',
      });
      mockMessaging.onMessage.mockImplementation(() => {});
      mockNotifee.onBackgroundEvent.mockImplementation(() => {});

      notificationListener();

      expect(mockMessaging.getMessaging).toHaveBeenCalled();
      expect(mockMessaging.onNotificationOpenedApp).toHaveBeenCalledWith(mockMessagingInstance, expect.any(Function));
      expect(mockMessaging.getInitialNotification).toHaveBeenCalledWith(mockMessagingInstance);
      expect(mockMessaging.onMessage).toHaveBeenCalledWith(mockMessagingInstance, expect.any(Function));
      expect(mockNotifee.onBackgroundEvent).toHaveBeenCalled();
    });

    test('should return success data when onBackgroundMessageHandler', () => {
      mockMessaging.setBackgroundMessageHandler.mockImplementation(() => {});

      onBackgroundMessageHandler();

      expect(mockMessaging.getMessaging).toHaveBeenCalled();
      expect(mockMessaging.setBackgroundMessageHandler).toHaveBeenCalledWith(mockMessagingInstance, expect.any(Function));
    });

    test('should return success data when getFCMToken with existing token', async () => {
      mockKeychain.getGenericPassword.mockResolvedValue({
        password: 'existing-token',
      });

      const res = await getFCMToken();

      expect(res).toBe('existing-token');
    });

    test('should return success data when getFCMToken with new token', async () => {
      mockKeychain.getGenericPassword.mockResolvedValue(false);
      mockMessaging.getToken.mockResolvedValue('new-token');
      mockKeychain.setGenericPassword.mockResolvedValue(true);

      const res = await getFCMToken();

      expect(res).toBe('new-token');
      expect(mockMessaging.getMessaging).toHaveBeenCalled();
      expect(mockMessaging.getToken).toHaveBeenCalledWith(mockMessagingInstance);
    });

    test('should return null when getFCMToken fails', async () => {
      mockKeychain.getGenericPassword.mockRejectedValue(
        new Error('Keychain error'),
      );

      const res = await getFCMToken();

      expect(res).toBe(null);
    });

    test('should return success data when refreshFCMToken with token', async () => {
      mockMessaging.getToken.mockResolvedValue('refresh-token');
      mockKeychain.setGenericPassword.mockResolvedValue(true);

      await refreshFCMToken();

      expect(mockMessaging.getMessaging).toHaveBeenCalled();
      expect(mockMessaging.getToken).toHaveBeenCalledWith(mockMessagingInstance);
    });

    test('should handle refreshFCMToken when no token', async () => {
      mockMessaging.getToken.mockResolvedValue(undefined);

      await refreshFCMToken();

      expect(mockMessaging.getMessaging).toHaveBeenCalled();
      expect(mockMessaging.getToken).toHaveBeenCalledWith(mockMessagingInstance);
    });
  });
});
