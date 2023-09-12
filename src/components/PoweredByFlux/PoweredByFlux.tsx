import React from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

function PoweredByFlux() {
  const { t } = useTranslation(['common']);
  const { Fonts, Layout } = useTheme();

  const openFlux = () => {
    Linking.openURL('https://runonflux.io');
  };

  return (
    <>
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
          Layout.row,
        ]}
      >
        <Text style={[Fonts.textSmall]}>{t('common:powered_by')} </Text>
        <TouchableOpacity onPressIn={() => openFlux()}>
          <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
            {t('common:flux')}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

export default PoweredByFlux;
