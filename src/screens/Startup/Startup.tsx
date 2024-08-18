import React, { useEffect } from 'react';
import { ActivityIndicator, View, NativeModules, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import { Brand } from '../../components';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux';
import { setDefaultTheme } from '../../store/theme';
import { ApplicationScreenProps } from '../../../@types/navigation';

// do we need this page? todo reevaluate to move to app and go straight to MainNavigator
const Startup = ({ navigation }: ApplicationScreenProps) => {
  const { i18n } = useTranslation();
  const { Layout, Gutters } = useTheme();

  const init = async () => {
    const deviceLanguage =
      Platform.OS === 'ios'
        ? NativeModules.SettingsManager.settings.AppleLocale ||
          NativeModules.SettingsManager.settings.AppleLanguages[0] // iOS 13
        : NativeModules.I18nManager.localeIdentifier;

    console.log(deviceLanguage); // en_US
    await i18n.changeLanguage(deviceLanguage.split('_')[0].split('-')[0]); // use system language
    await new Promise((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, 500),
    );
    setDefaultTheme({ theme: 'default', darkMode: null });
    navigation.reset({
      index: 0,
      routes: [{ name: 'Main' }],
    });
  };

  useEffect(() => {
    init();
  }, []);

  return (
    <View style={[Layout.fill, Layout.colCenter, Gutters.largeTMargin]}>
      <Brand />
      <ActivityIndicator size={'large'} style={[Gutters.largeVMargin]} />
      <PoweredByFlux isClickeable={true} />
    </View>
  );
};

export default Startup;
