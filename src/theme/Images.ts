import { ThemeVariables } from '../../@types/theme';

export default function ({}: ThemeVariables) {
  return {
    ssp: {
      logoBlack: require('../assets/ssp-logo-black.png'),
      logoWhite: require('../assets/ssp-logo-white.png'),
      logoTextBlack: require('../assets/ssp-logo-text-black.png'),
      logoTextWhite: require('../assets/ssp-logo-text-white.png'),
      poweredByDark: require('../assets/powered_by_dark.png'),
      poweredByLight: require('../assets/powered_by_light.png'),
    },
  };
}
