import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import PoweredByFlux from '../../components/PoweredByFlux/PoweredByFlux';

type Props = {
  navigation: any;
};

function Welcome({ navigation }: Props) {
  const { t } = useTranslation(['welcome']);
  const { darkMode, Common, Fonts, Gutters, Layout, Images } = useTheme();

  return (
    <ScrollView
      keyboardShouldPersistTaps="always"
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
          Gutters.largeBMargin,
        ]}
      >
        <Image
          style={{ width: 120, height: 200 }}
          source={darkMode ? Images.ssp.logoWhite : Images.ssp.logoBlack}
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
          onPressIn={() => navigation.navigate('Create')}
        >
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            {t('welcome:synchronise_key')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPressIn={() => navigation.navigate('Restore')}>
          <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
            {t('welcome:restore_key')}
          </Text>
        </TouchableOpacity>
      </View>
      <PoweredByFlux isClickeable={true} />
    </ScrollView>
  );
}

export default Welcome;
