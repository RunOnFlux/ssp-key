import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import VaultSignRequest from '../../src/components/VaultSignRequest/VaultSignRequest';
import type { TronOpView } from '../../src/lib/tron';

/**
 * TRON enterprise approval gate: approval is impossible while the tronOp
 * verification is pending (null verdict), after it failed, and whenever there
 * is no decoded view — including through the Authentication callback. The
 * decoded calls replace the generic recipients / fee cards.
 */

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

jest.mock('lucide-react-native', () => ({ Shield: () => null }));

jest.mock('../../src/components/VaultSignRequest/VaultRiskStrip', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../src/components/ui', () => {
  const { View } = require('react-native');
  const ReactLib = require('react');
  return {
    Card: (props: { children?: React.ReactNode }) =>
      ReactLib.createElement(View, null, props.children),
  };
});

jest.mock('../../src/components/Authentication/Authentication', () => {
  const { Text } = require('react-native');
  const ReactLib = require('react');
  return {
    __esModule: true,
    default: (props: { actionStatus: (status: boolean) => void }) =>
      ReactLib.createElement(
        Text,
        { testID: 'authentication', onPress: () => props.actionStatus(true) },
        'authentication',
      ),
  };
});

jest.mock('../../src/components/request', () => {
  const { Text } = require('react-native');
  const ReactLib = require('react');
  return {
    SlideToApprove: (props: { disabled?: boolean; onComplete: () => void }) =>
      ReactLib.createElement(
        Text,
        {
          testID: 'slider',
          accessibilityState: { disabled: !!props.disabled },
          onPress: () => props.onComplete(),
        },
        'slide',
      ),
    TronOpDetails: (props: { view: TronOpView }) =>
      ReactLib.createElement(
        Text,
        { testID: 'tron-details' },
        props.view.calls.map((c) => `${c.amount} ${c.symbol}`).join(','),
      ),
  };
});

const VIEW: TronOpView = {
  chain: 'tron',
  vault: 'TEpeXgvKdyvuLPL54ZaavjzKUw9o6CTrGC',
  nonce: '3',
  deadline: 1790000000,
  calls: [
    {
      index: 0,
      kind: 'trc20Transfer',
      to: 'TGjtodRV2nm6tQd9hsxiecLNN9QmhhVbbD',
      amount: '1',
      amountBaseUnits: '1000000',
      symbol: 'USDT',
      decimals: 6,
      token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      unknownToken: false,
      toVault: false,
    },
  ],
  fee: {
    kind: 'trx',
    amount: '9',
    amountBaseUnits: '9000000',
    symbol: 'TRX',
    token: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    recipient: 'TFhcYVArFkJW6bPUDid4AFCAjKmh6Ez3vv',
  },
  selfPay: false,
  isCancellation: false,
  warnings: [],
};

const decodedTx = { sender: VIEW.vault, recipients: [], fee: '0' };

const renderTron = (
  props: Partial<React.ComponentProps<typeof VaultSignRequest>> = {},
) => {
  const actionStatus = jest.fn();
  const utils = render(
    <VaultSignRequest
      activityStatus={false}
      recipients={[{ address: 'relay-says', amount: '999' }]}
      fee="0"
      chain="tron"
      actionStatus={actionStatus}
      decodedTx={decodedTx}
      {...props}
    />,
  );
  return { actionStatus, ...utils };
};

const sliderDisabled = () =>
  screen.getByTestId('slider').props.accessibilityState.disabled as boolean;

describe('VaultSignRequest (tron)', () => {
  it('shows the on-device decode and allows approval only from an ok verdict', () => {
    const { actionStatus } = renderTron({
      tronDecodeBlocked: false,
      tronView: VIEW,
    });
    expect(screen.getByTestId('tron-details')).toHaveTextContent('1 USDT');
    // the generic recipient / fee cards are not rendered for TRON
    expect(screen.queryByText('home:vault_sign_recipients')).toBeNull();
    expect(screen.queryByText('home:vault_sign_fee')).toBeNull();
    expect(sliderDisabled()).toBe(false);
    fireEvent.press(screen.getByTestId('slider'));
    fireEvent.press(screen.getByTestId('authentication'));
    expect(actionStatus).toHaveBeenCalledWith(true);
  });

  it('blocks while the verdict is pending (no failure banner)', () => {
    renderTron({ tronDecodeBlocked: true });
    expect(sliderDisabled()).toBe(true);
    expect(screen.queryByText('home:vault_sign_tron_decode_failed')).toBeNull();
  });

  it('blocks a failed verdict and shows its reasons', () => {
    renderTron({
      tronDecodeBlocked: true,
      tronDecodeReasons: ['TRON proposal digest does not match its operation'],
    });
    expect(sliderDisabled()).toBe(true);
    expect(screen.getByText('home:vault_sign_tron_decode_failed')).toBeTruthy();
    expect(
      screen.getByText('TRON proposal digest does not match its operation'),
    ).toBeTruthy();
  });

  it('blocks an ok verdict that carries no decoded view (fail closed)', () => {
    renderTron({ tronDecodeBlocked: false, tronView: undefined });
    expect(sliderDisabled()).toBe(true);
  });

  it('never approves through Authentication once the verdict turned blocking', () => {
    const { actionStatus, rerender } = renderTron({
      tronDecodeBlocked: false,
      tronView: VIEW,
    });
    fireEvent.press(screen.getByTestId('slider')); // opens Authentication
    act(() => {
      rerender(
        <VaultSignRequest
          activityStatus={false}
          recipients={[]}
          fee="0"
          chain="tron"
          actionStatus={actionStatus}
          decodedTx={decodedTx}
          tronDecodeBlocked={true}
          tronView={VIEW}
        />,
      );
    });
    fireEvent.press(screen.getByTestId('authentication'));
    expect(actionStatus).not.toHaveBeenCalledWith(true);
  });
});
