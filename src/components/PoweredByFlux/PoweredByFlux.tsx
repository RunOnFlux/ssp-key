import React from 'react';
import { View, TouchableOpacity, Linking, Image } from 'react-native';
// import { useDispatch } from 'react-redux';
// import { changeTheme, ThemeState } from '../../store/theme';
import { useTheme } from '../../hooks';

/**
 * Height of the pinned footer variant: paddingTop 8 + logo 18 + paddingBottom
 * 12. The footer is absolutely positioned with an OPAQUE background, so every
 * screen that renders it must reserve this much room at the end of its
 * scrollable content. Otherwise the footer covers whatever comes last — and
 * because its background matches the page, the covered control looks absent
 * rather than obscured. Restore's "Import Key" button was hidden exactly this
 * way. Exported so the inset cannot drift from the real height.
 */
export const POWERED_BY_FLUX_HEIGHT = 38;

type Props = {
  isClickeable?: boolean;
  /**
   * Inline variant for the Menu / About block: rendered in normal document
   * flow (no absolute bottom pin, no footer shadow) so it can sit inside a
   * scrolling section. Same logo + click behavior; version caption is owned
   * by the host surface.
   */
  about?: boolean;
};

const PoweredByFlux = ({ isClickeable = false, about = false }: Props) => {
  const { darkMode: isDark, Images, Layout, NavigationColors } = useTheme();

  const openFlux = () => {
    Linking.openURL('https://runonflux.io');
  };

  if (about) {
    return (
      <View style={[Layout.fullWidth, Layout.alignItemsCenter]}>
        {isClickeable ? (
          <TouchableOpacity onPress={() => openFlux()}>
            <Image
              testID={'powered-by-flux-img'}
              style={{ height: 18, width: 130 }}
              source={
                isDark ? Images.ssp.poweredByLight : Images.ssp.poweredByDark
              }
            />
          </TouchableOpacity>
        ) : (
          <Image
            testID={'powered-by-flux-img'}
            style={{ height: 18, width: 130 }}
            source={
              isDark ? Images.ssp.poweredByLight : Images.ssp.poweredByDark
            }
          />
        )}
      </View>
    );
  }

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
          <TouchableOpacity onPress={() => openFlux()}>
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

export default PoweredByFlux;
