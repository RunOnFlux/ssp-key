/**
 * KEY-9: screens that reveal secrets (seed words, xpriv, address private key,
 * the backup word challenge, the seed phrase being typed on Restore) must not
 * render them while the app is inactive / in the background, so an
 * app-switcher snapshot never contains them even if the opaque privacy cover
 * commits late. `useAppPrivacyCover` is mocked so each test flips it directly.
 */
import React from 'react';
import { Text } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import * as CryptoJS from 'crypto-js';

let mockCovered = false;
jest.mock('../../src/BlurOverlay', () => ({
  __esModule: true,
  default: () => null,
  useAppPrivacyCover: () => mockCovered,
}));

// Encrypted fixtures, built exactly the way the app stores them.
const ENC_KEY = 'enc-key-secret';
const PASSWORD = 'user-password';
const PW_FOR_ENCRYPTION = ENC_KEY + PASSWORD;
const MNEMONIC =
  'abandon ability able about above absent absorb abstract absurd abuse access accident';
const XPRIV = 'xprvSECRETMASTERKEY0123456789abcdefghijklmnopqrstuvwxyz';
const XPUB = 'xpubPUBLICMASTERKEY0123456789';
const ADDRESS_PRIVKEY = 'L1SECRETADDRESSPRIVATEKEYwif0123456789';
const enc = (plain: string) =>
  CryptoJS.AES.encrypt(plain, PW_FOR_ENCRYPTION).toString();
const mockState = {
  ssp: { identityChain: 'btc', seedPhrase: enc(MNEMONIC) },
  btc: { xprivKey: enc(XPRIV), xpubKey: enc(XPUB), xpubWallet: enc(XPUB) },
};
const mockPasswordBlob = CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString();

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(({ service }: { service: string }) =>
    Promise.resolve(
      service === 'enc_key'
        ? { password: 'enc-key-secret' }
        : { password: mockPasswordBlob },
    ),
  ),
}));

jest.mock('../../src/hooks', () => {
  const anyStyle = new Proxy({}, { get: () => ({}) });
  const anyColor = new Proxy({}, { get: () => '#000000' });
  return {
    useTheme: () => ({
      Fonts: anyStyle,
      Gutters: anyStyle,
      Layout: anyStyle,
      Common: new Proxy(
        {},
        { get: (_t, key) => (key === 'button' ? anyStyle : {}) },
      ),
      Colors: anyColor,
      darkMode: false,
    }),
    useAppSelector: (selector: (state: unknown) => unknown) =>
      selector(mockState),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactLib = require('react');
  const { Text: RNText } = require('react-native');
  const icon = (name: string) => () =>
    ReactLib.createElement(RNText, null, name);
  return { Eye: icon('Eye'), EyeOff: icon('EyeOff') };
});

jest.mock('react-native-qrcode-svg', () => {
  const ReactLib = require('react');
  const { Text: RNText } = require('react-native');
  return {
    __esModule: true,
    default: (props: { value: string }) =>
      ReactLib.createElement(RNText, { testID: 'qr' }, props.value),
  };
});

jest.mock('@react-native-picker/picker', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  const Picker = (props: { children?: React.ReactNode }) =>
    ReactLib.createElement(View, null, props.children);
  const PickerItem = () => null;
  Picker.Item = PickerItem;
  return { Picker };
});

jest.mock('../../src/lib/wallet', () => ({
  getMasterXpriv: jest.fn(() => 'derived-xpriv'),
  getMasterXpub: jest.fn(() => 'derived-xpub'),
  generateAddressKeypair: jest.fn(() => ({
    privKey: 'L1SECRETADDRESSPRIVATEKEYwif0123456789',
    pubKey: '02aa',
  })),
  generateMultisigAddress: jest.fn(() => ({
    address: 'bc1qaddress',
    redeemScript: '',
    witnessScript: '5221aa',
  })),
}));

jest.mock('../../src/components/Authentication/Authentication', () => {
  const ReactLib = require('react');
  const { Text: RNText } = require('react-native');
  return {
    __esModule: true,
    default: (props: { actionStatus: (status: boolean) => void }) =>
      ReactLib.createElement(
        RNText,
        { testID: 'authentication', onPress: () => props.actionStatus(true) },
        'authentication',
      ),
  };
});

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

import { SeedPhraseGrid } from '../../src/components/SeedPhraseBackup/SeedPhraseBackup';
import ConfirmSeedWords from '../../src/components/ConfirmSeedWords/ConfirmSeedWords';
import SSPKeyDetails from '../../src/components/SSPKeyDetails/SSKeyDetails';
import AddressDetails from '../../src/components/AddressDetails/AddressDetails';
import VerifyBackupModal from '../../src/components/VerifyBackup/VerifyBackupModal';

const WORDS = MNEMONIC.split(' ');

/** Every rendered string, for "is the secret anywhere on screen" checks. */
const renderedText = () =>
  screen
    .UNSAFE_queryAllByType(Text)
    .map((node) => {
      const children = ([] as unknown[]).concat(node.props.children);
      return children
        .filter((c) => typeof c === 'string' || typeof c === 'number')
        .join('');
    })
    .join('\n');

const anySeedWordShown = () =>
  WORDS.some((word) => screen.queryAllByText(word).length > 0);

beforeEach(() => {
  mockCovered = false;
});

describe('SeedPhraseGrid under the privacy cover', () => {
  it('shows revealed words while active', () => {
    render(<SeedPhraseGrid phrase={MNEMONIC} visible={true} />);
    expect(screen.getByText('abandon')).toBeTruthy();
  });

  it('masks revealed words while covered and restores them on return', () => {
    const { rerender } = render(
      <SeedPhraseGrid phrase={MNEMONIC} visible={true} />,
    );
    mockCovered = true;
    rerender(<SeedPhraseGrid phrase={MNEMONIC} visible={true} />);
    expect(anySeedWordShown()).toBe(false);
    expect(screen.getAllByText('•••••')).toHaveLength(WORDS.length);
    mockCovered = false;
    rerender(<SeedPhraseGrid phrase={MNEMONIC} visible={true} />);
    expect(screen.getByText('abandon')).toBeTruthy();
  });

  it('never renders words when mounted while already covered', () => {
    mockCovered = true;
    render(<SeedPhraseGrid phrase={MNEMONIC} visible={true} />);
    expect(anySeedWordShown()).toBe(false);
  });
});

describe('ConfirmSeedWords under the privacy cover', () => {
  it('masks the word options (one is a real seed word) and ignores taps', () => {
    const onVerified = jest.fn();
    const onBack = jest.fn();
    // A fresh element per render: React skips re-rendering an identical one.
    const ui = () => (
      <ConfirmSeedWords
        phrase={MNEMONIC}
        onVerified={onVerified}
        onBack={onBack}
      />
    );
    const { rerender } = render(ui());
    expect(anySeedWordShown()).toBe(true);

    mockCovered = true;
    rerender(ui());
    expect(anySeedWordShown()).toBe(false);
    const masked = screen.getAllByText('•••••');
    expect(masked.length).toBeGreaterThan(0);
    fireEvent.press(masked[0]);
    expect(onVerified).not.toHaveBeenCalled();

    mockCovered = false;
    rerender(ui());
    expect(anySeedWordShown()).toBe(true);
  });
});

describe('SSPKeyDetails under the privacy cover', () => {
  it('stops rendering the revealed xpriv, xpub and mnemonic while covered', async () => {
    const actionStatus = jest.fn();
    const ui = () => <SSPKeyDetails actionStatus={actionStatus} />;
    const { rerender } = render(ui());
    // Wait for the keychain decrypt to land, then reveal everything.
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(screen.getByLabelText('common:show home:chain_xpub'));
    fireEvent.press(screen.getByLabelText('common:show home:chain_xpriv'));
    fireEvent.press(screen.getByLabelText('common:show home:ssp_key_mnemonic'));
    await waitFor(() => expect(renderedText()).toContain(XPUB));
    const half = Math.floor(XPRIV.length / 2);
    expect(renderedText()).toContain(XPRIV.slice(0, half));
    expect(renderedText()).toContain(XPRIV.slice(half));
    expect(anySeedWordShown()).toBe(true);
    expect(screen.queryByTestId('qr')).toBeTruthy();

    mockCovered = true;
    rerender(ui());
    const covered = renderedText();
    expect(covered).not.toContain(XPRIV.slice(0, half));
    expect(covered).not.toContain(XPRIV.slice(half));
    expect(covered).not.toContain(XPUB);
    expect(anySeedWordShown()).toBe(false);
    expect(screen.queryByTestId('qr')).toBeNull();

    mockCovered = false;
    rerender(ui());
    expect(renderedText()).toContain(XPRIV.slice(0, half));
    expect(anySeedWordShown()).toBe(true);
  });
});

describe('AddressDetails under the privacy cover', () => {
  it('stops rendering the revealed private key while covered', async () => {
    const actionStatus = jest.fn();
    const ui = () => <AddressDetails actionStatus={actionStatus} />;
    const { rerender } = render(ui());
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.press(
      screen.getByLabelText('common:show home:wallet_private_key'),
    );
    const half = Math.floor(ADDRESS_PRIVKEY.length / 2);
    await waitFor(() =>
      expect(renderedText()).toContain(ADDRESS_PRIVKEY.slice(0, half)),
    );

    mockCovered = true;
    rerender(ui());
    const covered = renderedText();
    expect(covered).not.toContain(ADDRESS_PRIVKEY.slice(0, half));
    expect(covered).not.toContain(ADDRESS_PRIVKEY.slice(half));

    mockCovered = false;
    rerender(ui());
    expect(renderedText()).toContain(ADDRESS_PRIVKEY.slice(half));
  });
});

describe('VerifyBackupModal under the privacy cover', () => {
  it('masks the decrypted seed word challenge while covered', async () => {
    const onClose = jest.fn();
    const ui = () => <VerifyBackupModal open={true} onClose={onClose} />;
    const { rerender } = render(ui());
    fireEvent.press(screen.getByTestId('authentication'));
    await waitFor(() => expect(anySeedWordShown()).toBe(true));

    mockCovered = true;
    rerender(ui());
    expect(anySeedWordShown()).toBe(false);
  });
});
