import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Platform,
  StatusBar,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Camera, CameraType } from 'react-native-camera-kit';
import {
  request,
  check,
  PERMISSIONS,
  RESULTS,
  openSettings,
} from 'react-native-permissions';
import Icon from 'react-native-vector-icons/Feather';
import Toast from 'react-native-toast-message';
import { useTheme } from 'ssp-key/src/hooks';

interface QRScannerProps {
  onRead: (data: string) => void;
  onClose: () => void;
}

const Scanner: React.FC<QRScannerProps> = ({ onRead, onClose }) => {
  const { Colors } = useTheme();
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const { t } = useTranslation(['home', 'common']);

  const displayMessage = (type: string, content: string) => {
    Toast.show({
      type,
      text1: content,
    });
  };

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'android') {
          const rationale = {
            title: t('home:scan_camera_permissions'),
            message: t('home:scan_camera_needed'),
            buttonNeutral: t('common:ask_me_later'),
            buttonNegative: t('common:cancel'),
            buttonPositive: t('common:ok'),
          };
          const cameraPermission = await check(PERMISSIONS.ANDROID.CAMERA);
          if (cameraPermission === RESULTS.UNAVAILABLE) {
            displayMessage('error', t('home:err_camera_unavailable'));
            setHasCameraPermission(false);
            onClose?.();
          } else if (cameraPermission === RESULTS.DENIED) {
            const cameraRequest = await request(
              PERMISSIONS.ANDROID.CAMERA,
              rationale,
            );
            if (cameraRequest === (RESULTS.GRANTED || RESULTS.LIMITED)) {
              setHasCameraPermission(true);
            } else {
              displayMessage('error', t('home:err_camera_denied'));
              setHasCameraPermission(false);
              onClose?.();
            }
          } else if (
            cameraPermission === RESULTS.GRANTED ||
            cameraPermission === RESULTS.LIMITED
          ) {
            setHasCameraPermission(true);
          } else if (cameraPermission === RESULTS.BLOCKED) {
            displayMessage('error', t('home:err_camera_forbidden'));
            setTimeout(() => {
              openSettings().catch(() => console.warn('cannot open settings'));
            }, 300);
            onClose?.();
          } else {
            // treat as we need to request permissions
            const cameraRequest = await request(
              PERMISSIONS.ANDROID.CAMERA,
              rationale,
            );
            if (cameraRequest === (RESULTS.GRANTED || RESULTS.LIMITED)) {
              setHasCameraPermission(true);
            } else {
              displayMessage('error', t('home:err_camera_denied'));
              setHasCameraPermission(false);
              onClose?.();
            }
          }
        } else if (Platform.OS === 'ios') {
          const cameraPermission = await check(PERMISSIONS.IOS.CAMERA);
          if (cameraPermission === RESULTS.UNAVAILABLE) {
            displayMessage('error', t('home:err_camera_unavailable'));
            setHasCameraPermission(false);
            onClose?.();
          } else if (cameraPermission === RESULTS.DENIED) {
            const cameraRequest = await request(PERMISSIONS.IOS.CAMERA);
            if (cameraRequest === (RESULTS.GRANTED || RESULTS.LIMITED)) {
              setHasCameraPermission(true);
            } else {
              displayMessage('error', t('home:err_camera_denied'));
              setHasCameraPermission(false);
              onClose?.();
            }
          } else if (
            cameraPermission === RESULTS.GRANTED ||
            cameraPermission === RESULTS.LIMITED
          ) {
            setHasCameraPermission(true);
          } else if (cameraPermission === RESULTS.BLOCKED) {
            displayMessage('error', t('home:err_camera_forbidden'));
            setTimeout(() => {
              openSettings().catch(() => console.warn('cannot open settings'));
            }, 300);
            onClose?.();
          } else {
            // treat as we need to request permissions
            const cameraRequest = await request(PERMISSIONS.IOS.CAMERA);
            if (cameraRequest === (RESULTS.GRANTED || RESULTS.LIMITED)) {
              setHasCameraPermission(true);
            } else {
              displayMessage('error', t('home:err_camera_denied'));
              setHasCameraPermission(false);
              onClose?.();
            }
          }
        }
      } catch (err) {
        console.warn(err);
        onClose?.();
      }
    })();
  }, []);

  const handleQRRead = (event: any) => {
    console.log(event.nativeEvent.codeStringValue);
    onRead?.(event.nativeEvent.codeStringValue);
    onClose?.();
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <TouchableOpacity style={styles.backButton} onPress={onClose}>
        <Icon name="chevron-left" size={32} color={Colors.white} />
      </TouchableOpacity>
      {hasCameraPermission ? (
        <Camera
          style={styles.camera}
          cameraType={CameraType.Back}
          flashMode="auto"
          scanBarcode={true}
          onReadCode={handleQRRead}
          showFrame={true}
          laserColor="green"
          frameColor="white"
        />
      ) : (
        <View style={styles.camera}>
          <Text>{t('home:scan_camra_permission_not_granted')}</Text>
        </View>
      )}
    </View>
  );
};

export default Scanner;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    zIndex: 1000,
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
  },
  camera: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 10,
    width: 40,
    height: 40,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
