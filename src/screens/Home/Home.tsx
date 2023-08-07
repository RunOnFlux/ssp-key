import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';
import Icon from 'react-native-vector-icons/Feather';

import { useAppSelector } from '../../hooks';

type Props = {
  navigation: any;
};

function Home({ navigation }: Props) {
  const { t } = useTranslation(['welcome', 'common']);
  const { Fonts, Gutters, Layout, Images, Colors } = useTheme();

  const { seedPhrase } = useAppSelector((state) => state.ssp);
  console.log('seedPhrase', seedPhrase);
  // if seedPhrse does not exist, navigate to Welcome page
  if (!seedPhrase) {
    navigation.navigate('Welcome');
    return <></>;
  }
  // refresh for pending actions needed
  // on click refresh pending actions
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
          onPress={() => navigation.navigate('Restore')}
          style={[Layout.row]}
        >
          <Icon name="chevron-left" size={20} color={Colors.bluePrimary} />
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
          style={{ width: 120, height: 200 }}
          source={Images.ssp.logo}
          resizeMode={'contain'}
        />
      </View>
    </ScrollView>
  );
}

export default Home;
