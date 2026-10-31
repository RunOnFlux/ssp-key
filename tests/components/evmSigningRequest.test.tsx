import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import EvmSigningRequest from '../../src/components/EvmSigningRequest/EvmSigningRequest';
import {
  consumeEvmSigningApproval,
  disarmEvmSigningApproval,
} from '../../src/lib/evmSigningApproval';

/**
 * AA-2: the consumer EVM signing screen only offers approval for an EIP-191
 * personal message, and shows the text parsed from the exact preimage.
 */

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('lucide-react-native', () => ({
  SquarePen: () => null,
}));

jest.mock('../../src/hooks', () => {
  const anyStyle = new Proxy({}, { get: () => ({}) });
  const anyColor = new Proxy({}, { get: () => '#000000' });
  const state = new Proxy(
    {},
    { get: () => ({ xpubWallet: 'ENC_W', xpubKey: 'ENC_K' }) },
  );
  return {
    useTheme: () => ({
      Fonts: anyStyle,
      Gutters: anyStyle,
      Layout: anyStyle,
      Common: anyStyle,
      Colors: anyColor,
    }),
    useAppSelector: (selector: (s: unknown) => unknown) => selector(state),
  };
});

// Authentication: the test drives its result through this hook.
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

const renderWith = (
  dataToSign: string,
  requestDigest = 'digest-1',
  actionStatus = jest.fn(),
) =>
  render(
    <EvmSigningRequest
      activityStatus={false}
      dataToSign={dataToSign}
      chain="eth"
      walletInUse="0-0"
      requestDigest={requestDigest}
      actionStatus={actionStatus}
    />,
  );

beforeEach(() => {
  mockAuthResult = null;
  disarmEvmSigningApproval();
});

describe('EvmSigningRequest (AA-2)', () => {
  it('shows the personal message and offers approval', async () => {
    renderWith('\x19Ethereum Signed Message:\n12Sign in here');
    expect(await screen.findByText('Sign in here')).toBeTruthy();
    expect(screen.getByTestId('slider')).toBeTruthy();
    expect(screen.queryByText('home:evm_sign_refused_title')).toBeNull();
  });

  it.each([
    ['a raw eth_sign string', 'hello'],
    ['typed-data JSON', '{"primaryType":"Permit"}'],
    ['an EIP-712 preimage', '\x19\x01' + 'a'.repeat(64)],
  ])('refuses %s with no approve control', async (_label, data) => {
    renderWith(data);
    expect(await screen.findByText('home:evm_sign_refused_title')).toBeTruthy();
    expect(screen.queryByTestId('slider')).toBeNull();
  });
});

describe('EvmSigningRequest approval binding (item 4)', () => {
  const MESSAGE = '\x19Ethereum Signed Message:\n12Sign in here';

  it('arms the approval for exactly the request on screen', async () => {
    const actionStatus = jest.fn();
    renderWith(MESSAGE, 'digest-1', actionStatus);
    fireEvent.press(await screen.findByTestId('slider'));
    expect(mockAuthResult).not.toBeNull();
    act(() => mockAuthResult?.(true));
    expect(actionStatus).toHaveBeenCalledWith(true);
    expect(consumeEvmSigningApproval('digest-1')).toBe(true);
  });

  it('a request swapped in while authenticating is not approved', async () => {
    const actionStatus = jest.fn();
    const view = renderWith(MESSAGE, 'digest-1', actionStatus);
    fireEvent.press(await screen.findByTestId('slider'));
    const authCallback = mockAuthResult;
    // the relay replaces the request while the prompt is open
    view.rerender(
      <EvmSigningRequest
        activityStatus={false}
        dataToSign={'\x19Ethereum Signed Message:\n7swapped'}
        chain="eth"
        walletInUse="0-0"
        requestDigest="digest-2"
        actionStatus={actionStatus}
      />,
    );
    act(() => authCallback?.(true));
    expect(actionStatus).not.toHaveBeenCalledWith(true);
    expect(consumeEvmSigningApproval('digest-2')).toBe(false);
    expect(consumeEvmSigningApproval('digest-1')).toBe(false);
  });
});

describe('EvmSigningRequest typed data (EIP-712)', () => {
  const PERMIT = JSON.stringify({
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: 1,
      verifyingContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: {
      owner: '0x1111111111111111111111111111111111111111',
      spender: '0x2222222222222222222222222222222222222222',
      value: '1000',
    },
  });

  const renderTyped = (chain: 'eth' | 'sepolia', actionStatus = jest.fn()) =>
    render(
      <EvmSigningRequest
        activityStatus={false}
        dataToSign={PERMIT}
        messageType="eip712"
        chain={chain}
        walletInUse="0-0"
        requestDigest="digest-typed"
        actionStatus={actionStatus}
      />,
    );

  it('shows the warning and the decoded fields', async () => {
    renderTyped('eth');
    expect(
      await screen.findByText('home:evm_typed_data_approval_warning'),
    ).toBeTruthy();
    expect(screen.getByText('USD Coin')).toBeTruthy();
    expect(screen.getByText('Permit')).toBeTruthy();
    expect(screen.queryByText('home:evm_sign_refused_title')).toBeNull();
  });

  it('approves only after the user acknowledges the risk', async () => {
    const actionStatus = jest.fn();
    renderTyped('eth', actionStatus);
    fireEvent.press(await screen.findByTestId('slider'));
    expect(mockAuthResult).toBeNull();
    fireEvent(
      screen.getByLabelText('home:evm_typed_data_acknowledge'),
      'valueChange',
      true,
    );
    fireEvent.press(screen.getByTestId('slider'));
    act(() => mockAuthResult?.(true));
    expect(actionStatus).toHaveBeenCalledWith(true);
    expect(consumeEvmSigningApproval('digest-typed')).toBe(true);
  });

  it('refuses typed data for another chain', async () => {
    renderTyped('sepolia');
    expect(await screen.findByText('home:evm_sign_refused_title')).toBeTruthy();
    expect(screen.queryByTestId('slider')).toBeNull();
  });
});
