import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import VaultSignRequest from '../../src/components/VaultSignRequest/VaultSignRequest';
import type { VaultDecodedTx } from '../../src/lib/transactions';
import {
  bindDecodedToRequest,
  consumeVaultApproval,
  disarmVaultApproval,
} from '../../src/lib/vaultApprovalBinding';
import {
  clearVaultVerdict,
  publishVaultVerdict,
  resetAllVaultPins,
} from '../../src/lib/vaultPins';
import {
  consumeVaultRejectionCode,
  type VaultDescriptorVerdict,
} from '../../src/lib/vaultDescriptorGate';
import type { VaultDescriptor } from '../../src/lib/vaultDescriptor';

/**
 * Vault approval screen regressions:
 *
 * - CHN-5: a request swapped in while authentication is open must close
 *   authentication and never be approved unseen; the approval arms the digest
 *   of the request that was on screen.
 * - H-14 / EVM-7: amounts are never labelled with the relay's tokenSymbol /
 *   tokenDecimals; an unknown token shows raw base units, its contract and an
 *   "unverified token" banner.
 * - SOL-4: undecodable Solana bytes block approval.
 * - VD-3: no descriptor verdict, a refused descriptor, or a first-sight vault
 *   that was not confirmed on the pin screen blocks approval.
 */

// lucide ships ESM only; the icons are irrelevant here.
jest.mock(
  'lucide-react-native',
  () => new Proxy({}, { get: () => () => null }),
);

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
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
    useAppSelector: (
      select: (state: { ssp: Record<string, string> }) => unknown,
    ) => select({ ssp: { sspWalletKeyInternalIdentity: 'bc1qown' } }),
  };
});

jest.mock('../../src/components/ui', () => {
  const { View } = require('react-native');
  const ReactLib = require('react');
  const { Text } = require('react-native');
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
        {
          testID: 'authentication',
          onPress: () => props.actionStatus(true),
        },
        'authentication',
      ),
  };
});

jest.mock('../../src/components/request', () => {
  const { Text } = require('react-native');
  const ReactLib = require('react');
  return {
    RiskBanner: (props: { title: string }) =>
      ReactLib.createElement(Text, { testID: 'risk' }, props.title),
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

const TOKEN = '0x3333333333333333333333333333333333333333';
const RECIPIENT = '0x4444444444444444444444444444444444444444';

const DESCRIPTOR = (
  JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'fixtures', 'vd-vectors.json'),
      'utf8',
    ),
  ) as { vectors: Array<{ descriptor: VaultDescriptor }> }
).vectors[2].descriptor;

const OK_VERDICT: VaultDescriptorVerdict = {
  kind: 'ok',
  descriptor: DESCRIPTOR,
  hash: 'a'.repeat(64),
  pinKey: `${DESCRIPTOR.orgId}:${DESCRIPTOR.vaultId}`,
  persisted: true,
};

/**
 * A decoded view bound to a request, with that request's descriptor
 * verdict published the way ingestion does (default: a pinned vault).
 */
const decoded = (
  overrides: Partial<VaultDecodedTx> = {},
  digest: string | null = 'digest-A',
  verdict: VaultDescriptorVerdict = OK_VERDICT,
): VaultDecodedTx => {
  const tx: VaultDecodedTx = {
    sender: '0x1111111111111111111111111111111111111111',
    recipients: [{ address: RECIPIENT, amount: '1000000' }],
    fee: '0',
    ...overrides,
  };
  if (!digest) {
    return tx;
  }
  publishVaultVerdict('vaultsign', digest, verdict);
  return bindDecodedToRequest(tx, digest);
};

type Props = React.ComponentProps<typeof VaultSignRequest>;
const baseProps = ({
  decodedTx,
  ...overrides
}: Partial<Props> = {}): Props => ({
  activityStatus: false,
  recipients: [],
  fee: '0',
  chain: 'eth',
  actionStatus: jest.fn(),
  decodedTx: decodedTx === undefined ? decoded() : decodedTx,
  ...overrides,
});

const isSliderDisabled = () =>
  screen.getByTestId('slider').props.accessibilityState.disabled === true;

const press = async (testID: string) => {
  await act(async () => {
    screen.getByTestId(testID).props.onPress();
    await Promise.resolve();
  });
};

beforeEach(() => {
  disarmVaultApproval();
  clearVaultVerdict('vaultsign');
  resetAllVaultPins();
});

describe('VaultSignRequest token display (H-14)', () => {
  it('never uses the relay symbol/decimals for an unknown token', () => {
    render(
      <VaultSignRequest
        {...baseProps({
          tokenContract: TOKEN,
          tokenSymbol: 'USDC',
          tokenDecimals: 6,
          decodedTx: decoded({ tokenContract: TOKEN }),
        })}
      />,
    );
    expect(screen.queryByText(/USDC/)).toBeNull();
    expect(screen.getByText('1000000 home:vault_sign_base_units')).toBeTruthy();
    expect(screen.getByText('home:vault_sign_unverified_token')).toBeTruthy();
    expect(screen.getByText(TOKEN)).toBeTruthy();
    // an unverified token warns but stays approvable
    expect(isSliderDisabled()).toBe(false);
  });

  it("labels a token from this device's own list and still shows its contract", () => {
    render(
      <VaultSignRequest
        {...baseProps({
          tokenSymbol: 'SCAM',
          tokenDecimals: 18,
          decodedTx: decoded({
            tokenContract: TOKEN,
            tokenSymbol: 'USDC',
            tokenDecimals: 6,
          }),
        })}
      />,
    );
    expect(screen.getByText('1 USDC')).toBeTruthy();
    expect(screen.queryByText('home:vault_sign_unverified_token')).toBeNull();
    expect(screen.getByText(TOKEN)).toBeTruthy();
  });

  it('shows native amounts with the chain decimals', () => {
    render(
      <VaultSignRequest
        {...baseProps({
          decodedTx: decoded({
            recipients: [{ address: RECIPIENT, amount: '1500000000000000000' }],
          }),
        })}
      />,
    );
    expect(screen.getByText('1.5 ETH')).toBeTruthy();
  });
});

describe('VaultSignRequest approval gates', () => {
  it('blocks a decoded view that is not bound to a request', () => {
    render(
      <VaultSignRequest {...baseProps({ decodedTx: decoded({}, null) })} />,
    );
    expect(isSliderDisabled()).toBe(true);
  });

  it('SOL-4: blocks undecodable Solana bytes', () => {
    render(
      <VaultSignRequest
        {...baseProps({
          chain: 'solMainnet',
          solDecodeKind: 'undecodable',
          decodedTx: decoded({
            recipients: [],
            error: 'multiple create_transaction instructions',
          }),
        })}
      />,
    );
    expect(isSliderDisabled()).toBe(true);
    expect(screen.getByText('home:vault_sign_sol_undecodable')).toBeTruthy();
  });

  it('CHN-5: blocks message signing on a non-EVM chain', () => {
    render(
      <VaultSignRequest
        {...baseProps({
          chain: 'solMainnet',
          signMessage: 'Sign in',
          decodedTx: decoded({ recipients: [] }),
        })}
      />,
    );
    expect(isSliderDisabled()).toBe(true);
    expect(
      screen.getByText('home:vault_sign_message_unsupported'),
    ).toBeTruthy();
  });

  it('CHN-5: a request swapped in during authentication closes it and is not approved', async () => {
    const actionStatus = jest.fn();
    const view = render(<VaultSignRequest {...baseProps({ actionStatus })} />);
    await press('slider');
    expect(screen.getByTestId('authentication')).toBeTruthy();

    // the relay replaces the request while the prompt is open
    view.rerender(
      <VaultSignRequest
        {...baseProps({
          actionStatus,
          decodedTx: decoded(
            { recipients: [{ address: TOKEN, amount: '999' }] },
            'digest-B',
          ),
        })}
      />,
    );
    expect(screen.queryByTestId('authentication')).toBeNull();
    expect(actionStatus).not.toHaveBeenCalled();
    expect(consumeVaultApproval('digest-B')).toBe(false);

    // approving the request now on screen arms exactly that request
    await press('slider');
    await press('authentication');
    expect(actionStatus).toHaveBeenCalledWith(true);
    expect(consumeVaultApproval('digest-B')).toBe(true);
  });

  it('arms the displayed request on a normal approval', async () => {
    const actionStatus = jest.fn();
    render(<VaultSignRequest {...baseProps({ actionStatus })} />);
    await press('slider');
    await press('authentication');
    expect(actionStatus).toHaveBeenCalledWith(true);
    expect(consumeVaultApproval('digest-A')).toBe(true);
  });
});

describe('VaultSignRequest vault descriptor (VD-3)', () => {
  it('blocks a request without a published descriptor verdict', () => {
    const tx = decoded();
    clearVaultVerdict('vaultsign');
    render(<VaultSignRequest {...baseProps({ decodedTx: tx })} />);
    expect(isSliderDisabled()).toBe(true);
  });

  it('hard-refuses a vault whose configuration changed since it was pinned', () => {
    render(
      <VaultSignRequest
        {...baseProps({
          decodedTx: decoded({ error: 'changed' }, 'digest-A', {
            kind: 'refused',
            code: 'mismatch',
            reason: 'changed',
          }),
        })}
      />,
    );
    expect(isSliderDisabled()).toBe(true);
    expect(
      screen.getByText('home:vault_descriptor_changed_title'),
    ).toBeTruthy();
    expect(screen.getByText('home:vault_descriptor_changed_info')).toBeTruthy();
    fireEvent.press(screen.getByText('home:reject'));
    expect(consumeVaultRejectionCode()).toBe('VAULT_DESCRIPTOR_CHANGED');
  });

  it('refuses an old app without a descriptor with the update-required message', () => {
    render(
      <VaultSignRequest
        {...baseProps({
          decodedTx: decoded({ error: 'missing' }, 'digest-A', {
            kind: 'refused',
            code: 'missing',
            reason: 'Update required: vault descriptor missing',
          }),
        })}
      />,
    );
    expect(isSliderDisabled()).toBe(true);
    expect(
      screen.getByText('home:vault_descriptor_missing_title'),
    ).toBeTruthy();
  });

  it('first sight: the pin confirmation comes first, then the request can be approved', async () => {
    const actionStatus = jest.fn();
    const needsPin: VaultDescriptorVerdict = {
      kind: 'needs_pin',
      descriptor: DESCRIPTOR,
      hash: 'b'.repeat(64),
      pinKey: `${DESCRIPTOR.orgId}:${DESCRIPTOR.vaultId}`,
    };
    render(
      <VaultSignRequest
        {...baseProps({
          actionStatus,
          vaultName: 'Treasury',
          decodedTx: decoded({}, 'digest-A', needsPin),
        })}
      />,
    );
    // the pin screen, not the request: every signer is listed
    expect(screen.queryByTestId('slider')).toBeNull();
    expect(screen.getByText('home:vault_pin_note')).toBeTruthy();
    expect(screen.getByText('Treasury')).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(
      DESCRIPTOR.members.length,
    );

    await press('pin-confirm');
    // confirmed: the request is shown and approvable
    expect(isSliderDisabled()).toBe(false);
    await press('slider');
    await press('authentication');
    expect(actionStatus).toHaveBeenCalledWith(true);
    expect(consumeVaultApproval('digest-A')).toBe(true);
  });

  it('first sight: cancelling the pin confirmation refuses the request', () => {
    const actionStatus = jest.fn();
    render(
      <VaultSignRequest
        {...baseProps({
          actionStatus,
          decodedTx: decoded({}, 'digest-A', {
            kind: 'needs_pin',
            descriptor: DESCRIPTOR,
            hash: 'c'.repeat(64),
            pinKey: `${DESCRIPTOR.orgId}:${DESCRIPTOR.vaultId}`,
          }),
        })}
      />,
    );
    fireEvent.press(screen.getByText('home:vault_pin_cancel'));
    expect(actionStatus).toHaveBeenCalledWith(false);
    expect(consumeVaultRejectionCode()).toBe('VAULT_PIN_REFUSED');
  });
});
