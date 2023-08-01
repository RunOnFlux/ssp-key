import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/AntDesign';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

import { generateMnemonic } from '../../lib/wallet';

import { setSeedPhrase } from '../../store/ssp';

import { useAppSelector, useAppDispatch } from '../../hooks';

type Props = {
  navigation: any;
};

function Welcome({ navigation }: Props) {
  const dispatch = useAppDispatch();
  const { t } = useTranslation(['create', 'common']);
  const { Common, Fonts, Gutters, Layout, Images, Colors } = useTheme();

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
          Layout.row,
          Layout.justifyContentBetween,
          Layout.fullWidth,
          Gutters.smallTMargin,
          Gutters.smallHPadding,
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate('Welcome')}
          style={[Layout.row]}
        >
          <Icon name="left" size={20} color={Colors.bluePrimary} />
          <Text
            style={[
              Fonts.textSmall,
              Fonts.textBluePrimary,
              Gutters.tinyLPadding,
            ]}
          >
            {t('common:back')}
          </Text>
        </TouchableOpacity>
      </View>
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
          style={{ width: 80, height: 160 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
        <Text style={[Fonts.titleSmall, Gutters.tinyBMargin]}>
          {t('create:secure_key')}
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
            {t('create:setup_key')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => Alert.alert('TODO navigate to restore page')}
        >
          <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
            {t('create:restore_key')}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default Welcome;
