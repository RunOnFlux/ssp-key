import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

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
        <Text style={[Fonts.textBold, Fonts.textRegular, Gutters.smallBMargin]}>
          {t('welcome:subtitle')}
        </Text>
        <Text style={[Fonts.textSmall, Gutters.largeBMargin]}>
          {t('welcome:description')}
        </Text>
        <TouchableOpacity
          style={[
            Common.button.rounded,
            Common.button.bluePrimary,
            Gutters.regularBMargin,
          ]}
          onPress={() => Alert.alert('TODO navigate to create page')}
        >
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            Synchronise Key!
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Alert.alert('TODO navigate to restore page')}
        >
          <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
            Restore Key
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default Welcome;
