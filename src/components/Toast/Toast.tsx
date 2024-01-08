import React from 'react';
import Toast, {
  ErrorToast,
  SuccessToast,
  InfoToast,
  BaseToastProps,
} from 'react-native-toast-message';

const toastConfig = {
  success: (props: React.JSX.IntrinsicAttributes & BaseToastProps) => (
    <SuccessToast {...props} text1NumberOfLines={2} text2NumberOfLines={2} />
  ),
  error: (props: React.JSX.IntrinsicAttributes & BaseToastProps) => (
    <ErrorToast {...props} text1NumberOfLines={2} text2NumberOfLines={2} />
  ),
  info: (props: React.JSX.IntrinsicAttributes & BaseToastProps) => (
    <InfoToast {...props} text1NumberOfLines={2} text2NumberOfLines={2} />
  ),
};

const ToastNotif = () => {
  return (
    <>
      <Toast config={toastConfig} />
    </>
  );
};

export default ToastNotif;
