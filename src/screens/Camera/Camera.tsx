import React, { useState, useEffect } from 'react';
import {
  Camera,
  useCameraDevices,
  CameraPermissionStatus,
} from 'react-native-vision-camera';

async function Scanning() {
  const [cameraPermission, setCameraPermission] =
    useState<CameraPermissionStatus>();

  useEffect(() => {
    Camera.getCameraPermissionStatus().then(setCameraPermission);
  }, []);

  console.log(`Re-rendering Navigator. Camera: ${cameraPermission}`);

  const newCameraPermission = await Camera.requestCameraPermission();
  const devices = useCameraDevices();
  const device = devices.back;

  return <Camera device={device} isActive={true} />;
}

export default Scanning;
