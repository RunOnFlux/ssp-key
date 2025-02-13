const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
    minifierPath: 'metro-minify-obfuscator', // <- add this
    minifierConfig: {
      defaultMinifierPath: require('metro-minify-uglify'), // required if filter/includeNodeModules options is set, can be metro-minify-uglify or metro-minify-terser dependes on RN version / available installed minifier
      filter: () => true, // return true to obfuscate
      includeNodeModules: true, // set false to ignore node_modules from obfuscation
      trace: false, // show output log
      obfuscatorOptions: {
        stringArray: false,
        compact: true,
        controlFlowFlattening: true,
        controlFlowFlatteningThreshold: 0.75,
        identifierNamesGenerator: 'hexadecimal',
        numbersToExpressions: true,
        splitStrings: true,
        splitStringsChunkLength: 3,
        transformObjectKeys: true,
        simplify: true,
        disableConsoleOutput: true,
        log: false,
        selfDefending: true, // prevent tempering, debugging
        unicodeEscapeSequence: true,
      },
    },
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
