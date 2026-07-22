import React from 'react';
import { View, Image, TouchableOpacity, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

type Props = {
  headerText: string;
  backNavigation: string;
  navigation: any;
};

const Headerbar = ({ headerText, backNavigation, navigation }: Props) => {
  const { t } = useTranslation(['common']);
  const { darkMode, Gutters, Layout, Images, Fonts } = useTheme();
  return (
    <>
      <View
        style={[
          Layout.row,
          Layout.fullWidth,
          Gutters.smallHPadding,
          Gutters.tinyTMargin,
        ]}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('common:back')}
          onPress={() => navigation.navigate(backNavigation)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Image
            style={{ width: 35, height: 35 }}
            source={darkMode ? Images.ssp.logoWhite : Images.ssp.logoBlack}
            resizeMode={'contain'}
          />
        </TouchableOpacity>
        <View
          style={[Layout.justifyContentCenter, Layout.colCenter, Layout.fill]}
        >
          <Text style={[Fonts.titleTiny, Fonts.textCenter]}>{headerText}</Text>
        </View>
        <View style={{ width: 35, height: 35 }} />
      </View>
    </>
  );
};

export default Headerbar;
