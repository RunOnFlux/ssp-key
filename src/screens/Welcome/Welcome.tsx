import React, { useEffect, useState } from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Brand } from '../../components';
import { useTheme } from '../../hooks';
import { useLazyFetchOneQuery } from '../../services/modules/users';
import { changeTheme, ThemeState } from '../../store/theme';
import i18next from 'i18next';

import { getUniqueId } from 'react-native-device-info';

import { generateMnemonic } from '../../lib/wallet';

import { setSeedPhrase } from '../../store/ssp';

import { useAppSelector, useAppDispatch } from '../../hooks';

function Welcome() {
  const dispatch = useAppDispatch();
  const { t } = useTranslation(['example', 'welcome']);
  const { Common, Fonts, Gutters, Layout, Images } = useTheme();

  const generateMnemonicPhrase = (entValue: 128 | 256) => {
    const generatedMnemonic = generateMnemonic(entValue);
    dispatch(setSeedPhrase(generatedMnemonic));
  };

  const { seedPhrase } = useAppSelector((state) => state.ssp);
  // if seedPhrse exist, navigate to Home page

  if (!seedPhrase) {
    generateMnemonicPhrase(256);
  }
  return (
    <ScrollView
      style={Layout.fill}
      contentContainerStyle={[
        Layout.fullSize,
        Layout.fill,
        Layout.colCenter,
        Layout.scrollSpaceBetween,
      ]}
    >
      <View
        style={[
          Layout.fill,
          Layout.relative,
          Layout.fullWidth,
          Layout.justifyContentCenter,
          Layout.alignItemsCenter,
        ]}
      >
        <Image
          style={{ width: 120, height: 200 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <Text style={[Fonts.titleRegular, Gutters.tinyBMargin]}>
          {t('welcome:title')}
        </Text>
        <Text
          style={[Fonts.textBold, Fonts.textRegular, Gutters.regularBMargin]}
        >
          {t('welcome:subtitle')}
        </Text>
        <Text style={[Fonts.textSmall, Gutters.smallBMargin]}>
          {t('welcome:description')}
        </Text>
        <Text style={[Fonts.textSmall]}>Get Started!</Text>
        <Text style={[Fonts.textSmall]}>Restore</Text>
      </View>
    </ScrollView>
  );
}

export default Welcome;
