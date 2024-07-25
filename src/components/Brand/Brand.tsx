import React from 'react';
import { View, Image, DimensionValue } from 'react-native';
import { useTheme } from '../../hooks';

type Props = {
  height?: DimensionValue;
  width?: DimensionValue;
  mode?: 'contain' | 'cover' | 'stretch' | 'repeat' | 'center';
};

const Brand = ({ mode = 'contain' }: Props) => {
  const { darkMode, Layout, Images, Gutters } = useTheme();

  return (
    <View
      testID={'brand-img-wrapper'}
      style={[Layout.colCenter, Gutters.regularTMargin]}
    >
      <Image
        testID={'brand-img'}
        style={{ width: 140 }}
        source={darkMode ? Images.ssp.logoTextWhite : Images.ssp.logoTextBlack}
        resizeMode={mode}
      />
    </View>
  );
};

export default Brand;
