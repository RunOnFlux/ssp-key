/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        extensions: ['.js', '.json'],
        alias: {
          '@': './src',
          types: './@types',
        },
      },
      ['babel-plugin-rewrite-require', {
        'aliases': {
          stream: 'stream-browserify',
          crypto: 'crypto-browserify',
          process: 'process/browser',
        }
      }]
    ],
    'inline-dotenv',
    'react-native-reanimated/plugin', // needs to be last
  ],
};
