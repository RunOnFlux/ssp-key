import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import VaultSignRequest from '../../src/components/VaultSignRequest/VaultSignRequest';

/**
 * Kaspa enterprise approval gate: approval is impossible while the own-lookup
 * decode is pending, after it failed, and whenever a blocking kaspa-core
 * warning is present — including through the Authentication callback.
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
  };
});

const decodedTx = {
  sender: 'kaspa:pvault',
  recipients: [{ address: 'kaspa:qrecipient', amount: '100000000' }],
  fee: '30000',
};

const renderKas = (
  props: Partial<React.ComponentProps<typeof VaultSignRequest>> = {},
) => {
  const actionStatus = jest.fn();
  const utils = render(
    <VaultSignRequest
      activityStatus={false}
      recipients={decodedTx.recipients}
      fee="30000"
      chain="kas"
      actionStatus={actionStatus}
      decodedTx={decodedTx}
      {...props}
    />,
  );
  return { actionStatus, ...utils };
};

const sliderDisabled = () =>
  screen.getByTestId('slider').props.accessibilityState.disabled as boolean;

describe('VaultSignRequest (kas)', () => {
  it('allows approval only from an ok verdict', () => {
    const { actionStatus } = renderKas({
      kasDecodeBlocked: false,
      kasDecodePending: false,
      kasWarnings: ['fee-above-threshold'], // advisory warning only
    });
    expect(sliderDisabled()).toBe(false);
    expect(
      screen.getByText('home:kas_warning_fee_above_threshold'),
    ).toBeTruthy();
    fireEvent.press(screen.getByTestId('slider'));
    fireEvent.press(screen.getByTestId('authentication'));
    expect(actionStatus).toHaveBeenCalledWith(true);
  });

  it('blocks while the decode is pending (no failure banner)', () => {
    renderKas({ kasDecodeBlocked: true, kasDecodePending: true });
    expect(sliderDisabled()).toBe(true);
    expect(screen.queryByText('home:vault_sign_kas_decode_failed')).toBeNull();
  });

  it('blocks a failed decode and shows its reasons', () => {
    renderKas({
      kasDecodeBlocked: true,
      kasDecodePending: false,
      kasDecodeReasons: ['recipients differ from the proposal'],
    });
    expect(sliderDisabled()).toBe(true);
    expect(screen.getByText('home:vault_sign_kas_decode_failed')).toBeTruthy();
    expect(
      screen.getByText('recipients differ from the proposal'),
    ).toBeTruthy();
  });

  it.each(['burn-output', 'foreign-input', 'payload', 'covenant-output'])(
    'blocks on the blocking warning %s even with an ok verdict',
    (warning) => {
      renderKas({
        kasDecodeBlocked: false,
        kasDecodePending: false,
        kasWarnings: [warning],
      });
      expect(sliderDisabled()).toBe(true);
    },
  );

  it('never approves through Authentication once the verdict turned blocking', () => {
    const { actionStatus, rerender } = renderKas({
      kasDecodeBlocked: false,
      kasDecodePending: false,
    });
    fireEvent.press(screen.getByTestId('slider')); // opens Authentication
    act(() => {
      rerender(
        <VaultSignRequest
          activityStatus={false}
          recipients={decodedTx.recipients}
          fee="30000"
          chain="kas"
          actionStatus={actionStatus}
          decodedTx={decodedTx}
          kasDecodeBlocked={true}
          kasDecodePending={false}
        />,
      );
    });
    fireEvent.press(screen.getByTestId('authentication'));
    expect(actionStatus).not.toHaveBeenCalledWith(true);
  });
});
