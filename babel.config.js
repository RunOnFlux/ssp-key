/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./src'],
        extensions: ['.js', '.json'],
        alias: {
          '@': './src',
          types: './@types',
          crypto: 'react-native-quick-crypto',
          '@storage': './src/storage',
        },
      },
    ],
    'inline-dotenv',
    'react-native-reanimated/plugin',
  ],
};
