import React from 'react';
import { View, TouchableOpacity, Linking, Image } from 'react-native';
// import { useDispatch } from 'react-redux';
// import { changeTheme, ThemeState } from '../../store/theme';
import { useTheme } from '../../hooks';

type Props = {
  isClickeable?: boolean;
};

const PoweredByFlux = ({ isClickeable }: Props) => {
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
          Layout.fullWidth,
          Layout.alignItemsCenter,
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
        {isClickeable && (
          <TouchableOpacity onPressIn={() => openFlux()}>
            <Image
              testID={'powered-by-flux-img'}
              style={{ height: 18, width: 130 }}
              source={
                isDark ? Images.ssp.poweredByLight : Images.ssp.poweredByDark
              }
            />
          </TouchableOpacity>
        )}
        {!isClickeable && (
          <Image
            testID={'powered-by-flux-img'}
            style={{ height: 18, width: 130 }}
            source={
              isDark ? Images.ssp.poweredByLight : Images.ssp.poweredByDark
            }
          />
        )}
      </View>
    </>
  );
};

PoweredByFlux.defaultProps = { isClickeable: false };

export default PoweredByFlux;
