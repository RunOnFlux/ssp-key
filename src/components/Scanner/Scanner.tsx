import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Platform,
  StatusBar,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
} from 'react-native-vision-camera';
import {
  request,
  check,
  PERMISSIONS,
  RESULTS,
  openSettings,
} from 'react-native-permissions';
import Icon from 'react-native-vector-icons/Feather';
import Toast from 'react-native-toast-message';
import { useTheme } from '../../hooks';
import { useDispatch } from 'react-redux';
import { changeTheme } from '../../store/theme';

interface QRScannerProps {
  onRead: (data: string) => void;
  onClose: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SCAN_AREA_SIZE = SCREEN_WIDTH * 0.7;

const Scanner: React.FC<QRScannerProps> = ({ onRead, onClose }) => {
  const { Colors } = useTheme();
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const { t } = useTranslation(['home', 'common']);
  const dispatch = useDispatch();
  const device = useCameraDevice('back');
  const isScanned = useRef(false);
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  setTimeout(() => {
    dispatch(changeTheme({ theme: 'default', darkMode: true }));
  }, 0);

  // Animate scan line
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(scanLineAnim, {
          toValue: 0,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [scanLineAnim]);

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

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: useCallback(
      (codes) => {
        if (isScanned.current) return;
        const value = codes[0]?.value;
        if (value) {
          isScanned.current = true;
          console.log(value);
          onRead?.(value);
          onClose?.();
        }
      },
      [onRead, onClose],
    ),
  });

  const scanLineTranslateY = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCAN_AREA_SIZE - 4],
  });

  const renderScanOverlay = () => (
    <View style={styles.overlay}>
      {/* Top overlay */}
      <View style={styles.overlayTop} />

      {/* Middle row */}
      <View style={styles.overlayMiddle}>
        {/* Left overlay */}
        <View style={styles.overlaySide} />

        {/* Scan area */}
        <View style={styles.scanArea}>
          {/* Corner markers */}
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />

          {/* Animated scan line */}
          <Animated.View
            style={[
              styles.scanLine,
              {
                transform: [{ translateY: scanLineTranslateY }],
              },
            ]}
          />
        </View>

        {/* Right overlay */}
        <View style={styles.overlaySide} />
      </View>

      {/* Bottom overlay with text */}
      <View style={styles.overlayBottom}>
        <Text style={styles.scanText}>{t('home:scan_code')}</Text>
      </View>
    </View>
  );

  if (!device) {
    return (
      <View style={styles.container}>
        <StatusBar hidden />
        <TouchableOpacity style={styles.backButton} onPressIn={onClose}>
          <Icon name="chevron-left" size={32} color={Colors.white} />
        </TouchableOpacity>
        <View style={styles.camera}>
          <Text style={{ color: Colors.white }}>
            {t('home:err_camera_unavailable')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden />
      <TouchableOpacity style={styles.backButton} onPressIn={onClose}>
        <Icon name="chevron-left" size={32} color={Colors.white} />
      </TouchableOpacity>
      {hasCameraPermission ? (
        <>
          <Camera
            style={styles.camera}
            device={device}
            isActive={true}
            codeScanner={codeScanner}
            enableZoomGesture={true}
          />
          {renderScanOverlay()}
        </>
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
    height: '100%',
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
    width: '100%',
    height: '100%',
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
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
  },
  overlayTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayMiddle: {
    flexDirection: 'row',
  },
  overlaySide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  scanArea: {
    width: SCAN_AREA_SIZE,
    height: SCAN_AREA_SIZE,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    paddingTop: 30,
  },
  scanText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderColor: '#00ff00',
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 4,
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 4,
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 4,
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 4,
  },
  scanLine: {
    width: '100%',
    height: 2,
    backgroundColor: '#00ff00',
    shadowColor: '#00ff00',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
});
