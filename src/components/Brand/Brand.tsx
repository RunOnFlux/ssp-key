import React from 'react';
import { View, Image, DimensionValue, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../hooks';

type Props = {
  height?: DimensionValue;
  width?: DimensionValue;
  mode?: 'contain' | 'cover' | 'stretch' | 'repeat' | 'center';
};

const Brand = ({ mode }: Props) => {
  const { Layout, Images, Fonts, Gutters } = useTheme();
  const { t } = useTranslation(['common']);

  return (
    <View
      testID={'brand-img-wrapper'}
      style={[Layout.colCenter, Gutters.regularTMargin]}
    >
      <Image
        testID={'brand-img'}
        style={{ width: 140 }}
        source={Images.logo}
        resizeMode={mode}
      />
      <Text style={[Fonts.textLarge, Fonts.textBold]}>
        {t('common:appName.full')}
      </Text>
    </View>
  );
};

Brand.defaultProps = {
  height: 150,
  width: 150,
  mode: 'contain',
};

export default Brand;
