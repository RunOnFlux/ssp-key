module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: [
    './node_modules/react-native-gesture-handler/jestSetup.js',
    '<rootDir>/jest.setup.js',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|@react-native-community|@react-navigation|@scure|@noble|immer)',
  ],
  collectCoverageFrom: [
    // '<rootDir>/src/Components/**/*.jsx',
    // '<rootDir>/src/Components/**/*.tsx',
    // '<rootDir>/src/screens/**/*.jsx',
    // '<rootDir>/src/screens/**/*.tsx',
    // '<rootDir>/src/navigators/**/*.jsx',
    // '<rootDir>/src/navigators/**/*.tsx',
    // '<rootDir>/src/App.jsx',
    // '<rootDir>/src/App.tsx',
    '<rootDir>/src/lib/**/*.ts',
  ],
  coverageReporters: ['html', 'text', 'text-summary', 'cobertura'],
  testMatch: ['**/*.test.ts?(x)', '**/*.test.js?(x)'],
};
