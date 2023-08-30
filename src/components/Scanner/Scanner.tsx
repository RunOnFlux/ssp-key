import React, { useState, useEffect } from 'react';
import { View, StyleSheet, PermissionsAndroid, Text, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { Camera, CameraType } from 'react-native-camera-kit';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from 'ssp-key/src/hooks';

interface QRScannerProps {
  onRead?: (data: string) => void;
  onClose?: () => void;
}

const Scanner: React.FC<QRScannerProps> = ({
  onRead,
  onClose,
}) => {
  StatusBar.setHidden(true);
  const { Colors } = useTheme();
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  
  useEffect(() => {
      (async () => {
        try {
          if (Platform.OS === 'android') {
            const granted = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.CAMERA,
              {
                title: 'Camera Permission',
                message:
                  'This app needs access to your camera ' +
                  'so you can scan QR codes.',
                buttonNeutral: 'Ask Me Later',
                buttonNegative: 'Cancel',
                buttonPositive: 'OK',
              },
            );
            if (granted === PermissionsAndroid.RESULTS.GRANTED) {
              setHasCameraPermission(true);
            } else {
              console.log('Camera permission denied');
              onClose?.();
            }
          } else if (Platform.OS === 'ios') {
            const status = await Camera.checkDeviceCameraAuthorizationStatus();
            if (status === true) {
              setHasCameraPermission(true);
            } else if (status === false) {
              const newStatus = await Camera.requestDeviceCameraAuthorization();
              setHasCameraPermission(newStatus === true);
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
          <Text>
            camera permission is not granted
          </Text>
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
    position: "absolute", 
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
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
});
