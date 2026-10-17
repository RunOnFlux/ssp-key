import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import FluxNodeStartRequest from '../../src/components/FluxNodeStartRequest/FluxNodeStartRequest';
import {
  clearVaultVerdict,
  publishVaultVerdict,
  resetAllVaultPins,
} from '../../src/lib/vaultPins';
import {
  consumeVaultRejectionCode,
  fluxNodeFingerprint,
  type VaultDescriptorVerdict,
} from '../../src/lib/vaultDescriptorGate';
import type { VaultDescriptor } from '../../src/lib/vaultDescriptor';

/**
 * Flux node start approval screen (VD-3 / VD-4): approval needs the vault
 * descriptor verdict published for exactly this request; a refused descriptor
 * (or a collateral that is not the vault address) blocks it; a first-sight
 * vault shows the pin confirmation first; refusals carry a machine-readable
 * rejection code.
 */

jest.mock(
  'lucide-react-native',
  () => new Proxy({}, { get: () => () => null }),
);

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
    useAppSelector: (
      select: (state: { ssp: Record<string, string> }) => unknown,
    ) => select({ ssp: { sspWalletKeyInternalIdentity: 'bc1qown' } }),
  };
});

jest.mock('../../src/components/ui', () => {
  const { Text, View } = require('react-native');
  const ReactLib = require('react');
  return {
    Card: (props: { children?: React.ReactNode }) =>
      ReactLib.createElement(View, null, props.children),
    PrimaryButton: (props: { label: string; onPress: () => void }) =>
      ReactLib.createElement(
        Text,
        { testID: 'pin-confirm', onPress: props.onPress },
        props.label,
      ),
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
          onPress: () => {
            if (!props.disabled) props.onComplete();
          },
        },
        'slide',
      ),
  };
});

const DESCRIPTOR = (
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'fixtures', 'vd-vectors.json'),
      'utf8',
    ),
  ) as { vectors: Array<{ descriptor: VaultDescriptor }> }
).vectors[1].descriptor;

const FIELDS = {
  chain: 'flux',
  nodeName: 'node-1',
  collateralAmount: '100000000000',
  collateralAddress: 't3WhztxBDuzSbiaoXPWxuk6ojJ4akY8v3Ed',
  collateralTxid: 'aa'.repeat(32),
  collateralVout: 0,
  delegates: [] as string[],
};
const KEY = fluxNodeFingerprint(FIELDS);
const PIN_KEY = `${DESCRIPTOR.orgId}:${DESCRIPTOR.vaultId}`;

const renderScreen = (actionStatus = jest.fn()) => {
  render(
    <FluxNodeStartRequest
      activityStatus={false}
      actionStatus={actionStatus}
      {...FIELDS}
    />,
  );
  return actionStatus;
};
const isSliderDisabled = () =>
  screen.getByTestId('slider').props.accessibilityState.disabled === true;

beforeEach(() => {
  clearVaultVerdict('fluxnode');
  resetAllVaultPins();
  consumeVaultRejectionCode();
});

it('blocks approval without a verdict for this request', () => {
  publishVaultVerdict('fluxnode', 'another-request', {
    kind: 'ok',
    descriptor: DESCRIPTOR,
    hash: 'a'.repeat(64),
    pinKey: PIN_KEY,
    persisted: true,
  } satisfies VaultDescriptorVerdict);
  renderScreen();
  expect(isSliderDisabled()).toBe(true);
});

it('approves a request for a pinned vault', async () => {
  publishVaultVerdict('fluxnode', KEY, {
    kind: 'ok',
    descriptor: DESCRIPTOR,
    hash: 'a'.repeat(64),
    pinKey: PIN_KEY,
    persisted: true,
  } satisfies VaultDescriptorVerdict);
  const actionStatus = renderScreen();
  expect(isSliderDisabled()).toBe(false);
  await act(async () => {
    screen.getByTestId('slider').props.onPress();
    await Promise.resolve();
  });
  await act(async () => {
    screen.getByTestId('authentication').props.onPress();
    await Promise.resolve();
  });
  expect(actionStatus).toHaveBeenCalledWith(true);
});

it('blocks a collateral that is not the vault address and rejects with a code', () => {
  publishVaultVerdict('fluxnode', KEY, {
    kind: 'refused',
    code: 'invalid',
    reason: 'the collateral script is not this vault address',
  } satisfies VaultDescriptorVerdict);
  const actionStatus = renderScreen();
  expect(isSliderDisabled()).toBe(true);
  expect(
    screen.getByText('the collateral script is not this vault address'),
  ).toBeTruthy();
  fireEvent.press(screen.getByText('home:reject'));
  expect(actionStatus).toHaveBeenCalledWith(false);
  expect(consumeVaultRejectionCode()).toBe('VAULT_DESCRIPTOR_INVALID');
});

it('first sight: confirm the pin first; declining rejects with VAULT_PIN_REFUSED', () => {
  publishVaultVerdict('fluxnode', KEY, {
    kind: 'needs_pin',
    descriptor: DESCRIPTOR,
    hash: 'b'.repeat(64),
    pinKey: PIN_KEY,
  } satisfies VaultDescriptorVerdict);
  const actionStatus = renderScreen();
  expect(screen.queryByTestId('slider')).toBeNull();
  fireEvent.press(screen.getByText('home:vault_pin_cancel'));
  expect(actionStatus).toHaveBeenCalledWith(false);
  expect(consumeVaultRejectionCode()).toBe('VAULT_PIN_REFUSED');
});

it('first sight: after the confirmation the start can be approved', () => {
  publishVaultVerdict('fluxnode', KEY, {
    kind: 'needs_pin',
    descriptor: DESCRIPTOR,
    hash: 'c'.repeat(64),
    pinKey: PIN_KEY,
  } satisfies VaultDescriptorVerdict);
  renderScreen();
  act(() => {
    screen.getByTestId('pin-confirm').props.onPress();
  });
  expect(isSliderDisabled()).toBe(false);
});
