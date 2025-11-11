const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { lockdownSerializer } = require('@lavamoat/react-native-lockdown');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

// Polyfills needed for React Native
const getPolyfills = () => [
  // eslint-disable-next-line import/no-extraneous-dependencies
  ...require('@react-native/js-polyfills')(),
];

/**
 * Metro configuration with LavaMoat lockdown protection
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg', 'cjs'],
  },
  serializer: lockdownSerializer(
    { hermesRuntime: true },
    { getPolyfills }
  ),
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
