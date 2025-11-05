import 'whatwg-fetch';
import 'react-native-gesture-handler/jestSetup';
import '@testing-library/jest-native/extend-expect';

jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock'),
);

jest.mock('react-native-mmkv', () => {
  const storage = new Map();
  return {
    MMKV: jest.fn().mockImplementation(() => ({
      set: (key, value) => storage.set(key, value),
      getString: (key) => storage.get(key),
      getNumber: (key) => storage.get(key),
      getBoolean: (key) => storage.get(key),
      delete: (key) => storage.delete(key),
      getAllKeys: () => Array.from(storage.keys()),
      clearAll: () => storage.clear(),
    })),
    createMMKV: jest.fn().mockImplementation(() => ({
      set: (key, value) => storage.set(key, value),
      getString: (key) => storage.get(key),
      getNumber: (key) => storage.get(key),
      getBoolean: (key) => storage.get(key),
      delete: (key) => storage.delete(key),
      getAllKeys: () => Array.from(storage.keys()),
      clearAll: () => storage.clear(),
    })),
  };
});

jest.mock('redux-persist', () => {
  const real = jest.requireActual('redux-persist');
  return {
    ...real,
    persistReducer: jest
      .fn()
      .mockImplementation((config, reducers) => reducers),
  };
});

// Silence the warning: Animated: `useNativeDriver` is not supported because the native animated module is missing
// jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

jest.mock('react-i18next', () => ({
  // this mock makes sure any components using the translation hook can use it without a warning being shown
  useTranslation: () => {
    return {
      t: (str) => str,
      i18n: {
        changeLanguage: () => new Promise(() => {}),
      },
    };
  },
  initReactI18next: {
    type: '3rdParty',
    init: jest.fn(),
  },
}));
