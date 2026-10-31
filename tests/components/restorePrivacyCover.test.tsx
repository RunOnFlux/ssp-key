/**
 * KEY-9: the seed phrase typed into Restore must not be on screen while the
 * app is inactive / in the background (app-switcher snapshot). The input is
 * swapped for an empty placeholder while covered; the typed value is kept and
 * comes back on return.
 */
import React from 'react';
import { TextInput } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

let mockCovered = false;
jest.mock('../../src/BlurOverlay', () => ({
  __esModule: true,
  default: () => null,
  useAppPrivacyCover: () => mockCovered,
}));

jest.mock('../../src/hooks', () => {
  const anyStyle = new Proxy({}, { get: () => ({}) });
  const anyColor = new Proxy({}, { get: () => '#000000' });
  return {
    useTheme: () => ({
      Fonts: anyStyle,
      Gutters: anyStyle,
      Layout: anyStyle,
      Images: new Proxy({}, { get: () => 1 }),
      Common: new Proxy(
        {},
        { get: (_t, key) => (key === 'button' ? anyStyle : {}) },
      ),
      Colors: anyColor,
      darkMode: false,
    }),
    useAppSelector: (selector: (state: unknown) => unknown) =>
      selector({ ssp: { seedPhrase: '', identityChain: 'btc' } }),
    useAppDispatch: () => jest.fn(),
  };
});

jest.mock('../../src/hooks/keyboardVisible', () => ({
  useKeyboardVisible: () => false,
}));

jest.mock('lucide-react-native', () => {
  const ReactLib = require('react');
  const { Text } = require('react-native');
  const icon = (name: string) => () => ReactLib.createElement(Text, null, name);
  return {
    ChevronLeft: icon('ChevronLeft'),
    Eye: icon('Eye'),
    EyeOff: icon('EyeOff'),
  };
});

jest.mock('react-native-keyboard-aware-scroll-view', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    KeyboardAwareScrollView: (props: { children?: React.ReactNode }) =>
      ReactLib.createElement(View, null, props.children),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: (props: { children?: React.ReactNode }) =>
      ReactLib.createElement(View, null, props.children),
  };
});

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));
jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: { setItem: jest.fn(), getItem: jest.fn() },
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
jest.mock('../../src/components/Toast/Toast', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../src/components/PoweredByFlux/PoweredByFlux', () => ({
  __esModule: true,
  default: () => null,
  POWERED_BY_FLUX_HEIGHT: 0,
}));
jest.mock('../../src/components/CreationSteps/CreationSteps', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../src/components/WeakPassword/WeakPassword', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../src/components/SeedPhraseBackup/SeedPhraseBackup', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../src/components/ui', () => ({
  PrimaryButton: () => null,
}));
jest.mock('../../src/contexts/BackupCheckupContext', () => ({
  markBackupVerifyNow: jest.fn(),
}));
jest.mock('../../src/lib/wallet', () => ({
  getMasterXpriv: jest.fn(),
  getMasterXpub: jest.fn(),
  validateMnemonic: jest.fn(() => true),
}));
jest.mock('../../src/lib/recoveryAccount', () => ({
  deriveRecoveryAccount: jest.fn(),
}));
jest.mock('../../src/store/ssp', () => ({
  setSeedPhrase: jest.fn(),
  setSSPInitialState: jest.fn(),
  setSspKeyRecoveryKeys: jest.fn(),
}));
jest.mock('../../src/store', () => ({
  storage: { getString: () => undefined, set: jest.fn() },
  setXpubKeyIdentity: jest.fn(),
  setXprivKeyIdentity: jest.fn(),
  setInitialStateForAllChains: jest.fn(),
}));

import Restore from '../../src/screens/Restore/Restore';

const SEED = 'abandon ability able about above absent absorb abstract';

const seedInput = () =>
  screen
    .UNSAFE_queryAllByType(TextInput)
    .find((node) => node.props.placeholder === 'cr:input_mnemonic');

beforeEach(() => {
  mockCovered = false;
});

describe('Restore seed input under the privacy cover', () => {
  it('removes the typed seed from the screen while covered and restores it on return', () => {
    const navigation = { navigate: jest.fn() };
    const ui = () => <Restore navigation={navigation} />;
    const { rerender } = render(ui());
    const input = seedInput();
    expect(input).toBeTruthy();
    fireEvent.changeText(input!, SEED);
    expect(seedInput()!.props.value).toBe(SEED);

    mockCovered = true;
    rerender(ui());
    expect(seedInput()).toBeUndefined();
    expect(screen.getByTestId('seed-input-covered')).toBeTruthy();
    expect(screen.queryByDisplayValue(SEED)).toBeNull();

    mockCovered = false;
    rerender(ui());
    expect(screen.queryByTestId('seed-input-covered')).toBeNull();
    expect(seedInput()!.props.value).toBe(SEED);
  });
});
