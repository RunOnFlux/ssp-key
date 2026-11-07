import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import VaultXpubRequest from '../../src/components/VaultXpubRequest/VaultXpubRequest';

/**
 * Review round 1, Key item 6: the vault xpub request's swap guard left out
 * the organisation and vault indices — which pick the key account that is
 * exported — and neither was displayed.
 */

jest.mock('lucide-react-native', () => ({
  Lock: () => null,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

jest.mock('../../src/hooks', () => {
  const anyStyle = new Proxy({}, { get: () => ({}) });
  const anyColor = new Proxy({}, { get: () => '#000000' });
  return {
    useTheme: () => ({
      Fonts: anyStyle,
      Gutters: anyStyle,
      Layout: anyStyle,
      Common: anyStyle,
      Colors: anyColor,
    }),
  };
});

let mockAuthResult: ((status: boolean) => void) | null = null;
jest.mock('../../src/components/Authentication/Authentication', () => ({
  __esModule: true,
  default: (props: { actionStatus: (status: boolean) => void }) => {
    mockAuthResult = props.actionStatus;
    return null;
  },
}));

jest.mock('../../src/components/request', () => {
  const { Text } = require('react-native');
  const ReactLib = require('react');
  return {
    SlideToApprove: (props: { onComplete: () => void }) =>
      ReactLib.createElement(
        Text,
        { testID: 'slider', onPress: props.onComplete },
        'slide',
      ),
  };
});

const props = (overrides: Record<string, unknown> = {}) => ({
  activityStatus: false,
  vaultName: 'Treasury',
  orgName: 'Acme',
  chain: 'btc',
  orgIndex: 1337,
  vaultIndex: 3,
  actionStatus: jest.fn(),
  ...overrides,
});

beforeEach(() => {
  mockAuthResult = null;
});

describe('VaultXpubRequest (item 6)', () => {
  it('shows the organisation and vault index of the exported key account', () => {
    render(<VaultXpubRequest {...props()} />);
    expect(
      screen.getByText(
        'home:vault_xpub_key_account_value {"orgIndex":"1337","vaultIndex":"3"}',
      ),
    ).toBeTruthy();
  });

  it('approves the request on screen', () => {
    const p = props();
    render(<VaultXpubRequest {...p} />);
    fireEvent.press(screen.getByTestId('slider'));
    act(() => mockAuthResult?.(true));
    expect(p.actionStatus).toHaveBeenCalledWith(true);
  });

  it.each([
    ['vault index', { vaultIndex: 4 }],
    ['organisation index', { orgIndex: 1338 }],
  ])(
    'never approves a request whose %s changed while authenticating',
    (_label, change) => {
      const p = props();
      const view = render(<VaultXpubRequest {...p} />);
      fireEvent.press(screen.getByTestId('slider'));
      const authCallback = mockAuthResult;
      view.rerender(<VaultXpubRequest {...p} {...change} />);
      act(() => authCallback?.(true));
      expect(p.actionStatus).not.toHaveBeenCalledWith(true);
    },
  );
});
