import { ThemeVariables } from '../../@types/theme';

export default function ({}: ThemeVariables) {
  return {
    ssp: {
      logo: require('../assets/ssp-logo.png'),
    },
    logo: require('../assets/ssp-logo.png'),
    sparkles: {
      topLeft: require('./assets/images/sparkles-top-left.png'),
      top: require('./assets/images/sparkles-top.png'),
      topRight: require('./assets/images/sparkles-top-right.png'),
      right: require('./assets/images/sparkles-right.png'),
      bottomRight: require('./assets/images/sparkles-bottom-right.png'),
      bottom: require('./assets/images/sparkles-bottom.png'),
      bottomLeft: require('./assets/images/sparkles-bottom-left.png'),
    },
    icons: {
      colors: require('./assets/images/colorswatch.png'),
      send: require('./assets/images/send.png'),
      translate: require('./assets/images/translate.png'),
    },
  };
}
