import React from 'react';
import { View, StyleSheet, Modal } from 'react-native';
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
    >
      <View style={styles.container}>
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
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rectangle: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: 'white',
    backgroundColor: 'transparent',
  },
});

export default Scanner;
