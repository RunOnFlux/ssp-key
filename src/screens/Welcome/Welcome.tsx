import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

type Props = {
  navigation: any;
};

function Welcome({ navigation }: Props) {
  const { t } = useTranslation(['welcome']);
  const { Common, Fonts, Gutters, Layout, Images } = useTheme();

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
          onPress={() => navigation.navigate('Create')}
        >
          <Text style={[Fonts.textRegular, Fonts.textWhite]}>
            {t('welcome:synchronise_key')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Restore')}>
          <Text style={[Fonts.textSmall, Fonts.textBluePrimary]}>
            {t('welcome:restore_key')}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default Welcome;
