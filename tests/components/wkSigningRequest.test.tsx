/**
 * H-7 / KEY-1: the WK signing screen is built from the CLASSIFIED message, not
 * from requester-supplied labels.
 *
 * Before: every request rendered "SSP Authentication — a website is requesting
 * your signature to authenticate", with the requester's siteName/description
 * on top and the message in a tiny box — so a vault-xpub attestation or an
 * ownership transfer looked like a login. Now:
 *  - invalid messages are refused (no approve control at all);
 *  - an enterprise login shows the origin FROM THE MESSAGE;
 *  - critical actions get a red screen with action / org / target;
 *  - generic requests mark requester info as claimed and show the message.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

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

jest.mock('lucide-react-native', () => {
  const ReactLib = require('react');
  const { Text } = require('react-native');
  const icon = (name: string) => () => ReactLib.createElement(Text, null, name);
  return {
    Globe: icon('Globe'),
    LogIn: icon('LogIn'),
    OctagonAlert: icon('OctagonAlert'),
    Pen: icon('Pen'),
  };
});

jest.mock('../../src/components/Authentication/Authentication', () => {
  const ReactLib = require('react');
  const { Text } = require('react-native');
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
  const ReactLib = require('react');
  const { Text, View } = require('react-native');
  return {
    RiskBanner: (props: { title: string; messages?: string[] }) =>
      ReactLib.createElement(
        View,
        { testID: 'risk-banner' },
        ReactLib.createElement(Text, null, props.title),
        ...(props.messages ?? []).map((m: string, i: number) =>
          ReactLib.createElement(Text, { key: i }, m),
        ),
      ),
    SlideToApprove: (props: { onComplete: () => void }) =>
      ReactLib.createElement(
        Text,
        { testID: 'slide-to-approve', onPress: props.onComplete },
        'slide',
      ),
  };
});

import WkSigningRequest from '../../src/components/WkSigningRequest/WkSigningRequest';

const TS = '1760000000000';
const NONCE = '0123456789abcdef0123456789abcdef';
const ORIGIN = 'https://enterprise.sspwallet.com';
const TARGET = 'bc1qattackerwkidentity0000000000000000000000000000000000000000';

const requester = {
  origin: 'https://evil.example',
  siteName: 'SSP Enterprise',
  description: 'Sign in to continue',
};

const renderRequest = (message: string, actionStatus = jest.fn()) => {
  render(
    <WkSigningRequest
      activityStatus={false}
      message={message}
      wkIdentity="bc1qwk"
      requesterInfo={requester}
      actionStatus={actionStatus}
    />,
  );
  return actionStatus;
};

describe('WkSigningRequest', () => {
  it('refuses a vault-xpub attestation: no approve control, only close', () => {
    const actionStatus = renderRequest(
      `SSP_VAULT_XPUB:key:xpub${'a'.repeat(100)}:eth:150`,
    );
    expect(screen.getByTestId('wk-refused-title')).toBeTruthy();
    expect(screen.queryByTestId('slide-to-approve')).toBeNull();
    // requester labels are never rendered for a refused request
    expect(screen.queryByText('SSP Enterprise')).toBeNull();
    fireEvent.press(screen.getByTestId('wk-reject'));
    expect(actionStatus).toHaveBeenCalledWith(false);
  });

  it('refuses relay-auth JSON', () => {
    renderRequest(
      JSON.stringify({
        timestamp: 1,
        action: 'action',
        identity: 'x',
        nonce: NONCE,
      }),
    );
    expect(screen.getByTestId('wk-refused-title')).toBeTruthy();
    expect(screen.queryByTestId('slide-to-approve')).toBeNull();
  });

  it('shows an enterprise login with the origin taken from the message', () => {
    renderRequest(`${TS}:SSP_ENTERPRISE_LOGIN:${NONCE}:${ORIGIN}`);
    expect(screen.getByTestId('wk-login-title')).toBeTruthy();
    expect(screen.getByTestId('wk-login-origin').props.children).toBe(ORIGIN);
    // the requester-supplied siteName / origin / description are not shown
    expect(screen.queryByText('SSP Enterprise')).toBeNull();
    expect(screen.queryByText('https://evil.example')).toBeNull();
    expect(screen.queryByText('Sign in to continue')).toBeNull();
    expect(screen.getByTestId('slide-to-approve')).toBeTruthy();
  });

  it('shows a red critical screen for an ownership transfer (v2)', () => {
    renderRequest(
      `${TS}:SSP_CRITICAL:transfer_ownership:org-42:${TARGET}:${NONCE}:${ORIGIN}`,
    );
    expect(screen.getByTestId('wk-critical-title')).toBeTruthy();
    expect(screen.getByTestId('wk-critical-action').props.children).toBe(
      'home:wk_critical_action_transfer_ownership',
    );
    expect(screen.getByTestId('wk-critical-org').props.children).toBe('org-42');
    expect(screen.getByTestId('wk-critical-target').props.children).toBe(
      TARGET,
    );
    expect(screen.getByTestId('wk-critical-origin').props.children).toBe(
      ORIGIN,
    );
    expect(
      screen.getByText('home:wk_critical_action_transfer_ownership_effect'),
    ).toBeTruthy();
    expect(screen.queryByText('SSP Enterprise')).toBeNull();
  });

  it('splits a vault-scoped challenge and shows "none" as no target', () => {
    renderRequest(
      `${TS}:SSP_CRITICAL:freeze_vault:org-42/vault-7:none:${NONCE.slice(0, 24)}:${ORIGIN}`,
    );
    expect(screen.getByTestId('wk-critical-org').props.children).toBe('org-42');
    expect(screen.getByTestId('wk-critical-vault').props.children).toBe(
      'vault-7',
    );
    expect(screen.getByTestId('wk-critical-target').props.children).toBe(
      'home:wk_critical_no_target',
    );
  });

  it('shows the new email for an email change, not an org', () => {
    renderRequest(
      `${TS}:SSP_CRITICAL:change_enterprise_email:user:attacker@evil.example:${NONCE.slice(0, 24)}:${ORIGIN}`,
    );
    expect(screen.getByTestId('wk-critical-email').props.children).toBe(
      'attacker@evil.example',
    );
    expect(screen.queryByTestId('wk-critical-org')).toBeNull();
    expect(screen.getByTestId('wk-critical-account').props.children).toBe(
      'home:wk_critical_account_value',
    );
  });

  it('marks a legacy critical request as not bound to a website', () => {
    renderRequest(`${TS}:SSP_CRITICAL:remove_member:org-42:${TARGET}:${NONCE}`);
    expect(screen.getByTestId('wk-critical-title')).toBeTruthy();
    expect(screen.getByTestId('wk-critical-origin').props.children).toBe(
      'home:wk_critical_origin_legacy',
    );
  });

  it('shows an unknown critical action raw instead of a prototype lookup', () => {
    renderRequest(`${TS}:SSP_CRITICAL:constructor:org:${TARGET}:${NONCE}`);
    expect(screen.getByTestId('wk-critical-action').props.children).toBe(
      'home:wk_critical_action_unknown',
    );
  });

  it('labels requester info on a generic request as claimed and shows the message', () => {
    const message = `${TS}${NONCE}`;
    renderRequest(message);
    expect(screen.getByTestId('wk-generic-title')).toBeTruthy();
    expect(screen.getByTestId('wk-requester-claimed')).toBeTruthy();
    expect(screen.getByTestId('wk-message').props.children).toBe(message);
    expect(screen.getByText('SSP Enterprise')).toBeTruthy();
  });

  it('approves only through Authentication', () => {
    const actionStatus = renderRequest(
      `${TS}:SSP_ENTERPRISE_LOGIN:${NONCE}:${ORIGIN}`,
    );
    fireEvent.press(screen.getByTestId('slide-to-approve'));
    expect(actionStatus).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('authentication'));
    expect(actionStatus).toHaveBeenCalledWith(true);
  });
});
