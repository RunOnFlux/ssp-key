import React from 'react';
import { View, TouchableOpacity, Linking, Image } from 'react-native';
// import { useDispatch } from 'react-redux';
// import { changeTheme, ThemeState } from '../../store/theme';
import { useTheme } from '../../hooks';

function PoweredByFlux() {
  const { darkMode: isDark, Images, Layout, NavigationColors } = useTheme();

  const openFlux = () => {
    Linking.openURL('https://runonflux.io');
  };

  // const onChangeTheme = ({ theme, darkMode }: Partial<ThemeState>) => {
  //   dispatch(changeTheme({ theme, darkMode }));
  // };
  // const dispatch = useDispatch();

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
          Layout.absolute,
          Layout.bottom0,
          {
            backgroundColor: NavigationColors.background,
            padding: 8,
            paddingBottom: 12,
            shadowColor: isDark ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 1)',
            shadowOpacity: 0.5,
            shadowRadius: 7,
            shadowOffset: {
              height: 5,
              width: 5,
            },
            elevation: 5,
          },
        ]}
      >
        <TouchableOpacity onPressIn={() => openFlux()}>
          <Image
            testID={'powered-by-flux-img'}
            style={{ height: 18, width: 128 }}
            source={
              isDark ? Images.ssp.poweredByLight : Images.ssp.poweredByDark
            }
          />
        </TouchableOpacity>
      </View>
    </>
  );
}

export default PoweredByFlux;
