import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Modal, PermissionsAndroid, Text } from 'react-native';
import { Camera, CameraType } from 'react-native-camera-kit';


interface QRScannerProps {
  onRead?: (data: string) => void;
  onClose?: () => void;
  visible?: boolean;
  transparent?: boolean;
}

const Scanner: React.FC<QRScannerProps> = ({
  onRead,
  onClose,
  visible,
  transparent = true,
}) => {
  const [hasCameraPermission, setHasCameraPermission] = useState(false);

  useEffect(() => {
    if(visible) {
      (async () => {
        try {
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
        } catch (err) {
          console.warn(err);
          onClose?.();
        }
      })();
    }
  }, [visible]);

  const handleQRRead = (event: any) => {
    console.log(event.nativeEvent.codeStringValue);
    onRead?.(event.nativeEvent.codeStringValue);
    onClose?.();
  };

  return (
    <Modal
      presentationStyle="overFullScreen"
      animationType="fade"
      transparent={transparent}
      visible={visible}
      onDismiss={onClose}
    >
      {visible ? 
        <View style={styles.container}>
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
      : null}
    </Modal>
  );
};

export default Scanner;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
});
