const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { lockdownSerializer } = require('@lavamoat/react-native-lockdown');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

// The multisig SDK's `secp256k1` falls back to pure-JS elliptic in React
// Native — ~26 ms per point multiplication on Hermes, which froze vault
// verification and EVM signing. Its imports (and only its) get the
// @noble/curves implementation of the same API: src/lib/secp256k1Noble.js.
const AA_SDK_DIR = `${path.sep}@runonflux${path.sep}aa-schnorr-multisig-sdk${path.sep}`;
const NOBLE_SECP256K1 = path.resolve(__dirname, 'src/lib/secp256k1Noble.js');

// Polyfills needed for React Native
const getPolyfills = () => [...require('@react-native/js-polyfills')()];

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
    resolveRequest: (context, moduleName, platform) => {
      if (
        moduleName === 'secp256k1' &&
        context.originModulePath.includes(AA_SDK_DIR)
      ) {
        return { type: 'sourceFile', filePath: NOBLE_SECP256K1 };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
  serializer: lockdownSerializer({ hermesRuntime: true }, { getPolyfills }),
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
