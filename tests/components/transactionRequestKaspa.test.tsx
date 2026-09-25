import React from 'react';
import * as CryptoJS from 'crypto-js';
import { act, render, screen } from '@testing-library/react-native';
import TransactionRequest from '../../src/components/TransactionRequest/TransactionRequest';
import { decodeTransactionForApproval } from '../../src/lib/transactions';

/**
 * Kaspa approval wiring: the decode must receive the pair's DECRYPTED xpubs
 * and the request path (the vault is derived on-device, never read from the
 * payload), the fee is shown, describeTransaction warnings are surfaced and a
 * failed own-lookup decode blocks approval.
 */

const ENC_KEY = 'enc-key';
const PASSWORD = 'pw';
const PW_FOR_ENCRYPTION = ENC_KEY + PASSWORD;

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn((opts: { service: string }) =>
    Promise.resolve(
      opts.service === 'enc_key'
        ? { password: 'enc-key' }
        : {
            password: require('crypto-js')
              .AES.encrypt('pw', 'enc-key')
              .toString(),
          },
    ),
  ),
}));

jest.mock('../../src/lib/transactions', () => ({
  decodeTransactionForApproval: jest.fn(),
}));

jest.mock('../../src/lib/rates', () => ({
  getCryptoUsdRate: jest.fn(() => Promise.resolve(0)),
  formatUsdAmount: (usd: number) => usd.toFixed(2),
}));

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

// useTheme needs the redux store; the styles are irrelevant here.
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

// Authentication surfaces its callback so the "approve after the payload
// changed" path can be driven directly.
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

// The shared request blocks are replaced by leaves that expose the decoded
// values verbatim — the global react-i18next mock returns bare keys, so
// interpolated copy (ActionCard) cannot carry the amount.
jest.mock('../../src/components/request', () => {
  const { Text } = require('react-native');
  const ReactLib = require('react');
  const leaf = (testID: string, value?: string) =>
    ReactLib.createElement(Text, { testID }, value ?? '');
  return {
    RequestHeader: (props: { identity?: string }) =>
      leaf('sender', props.identity),
    ActionCard: (props: { action: string }) => leaf('action', props.action),
    RecipientCard: (props: { address: string }) =>
      leaf('recipient', props.address),
    FeeRow: (props: { fee: string }) => leaf('fee', props.fee),
    RiskBanner: (props: { title: string }) => leaf('risk', props.title),
    AdvancedSection: (props: { children?: React.ReactNode }) =>
      ReactLib.createElement(ReactLib.Fragment, null, props.children),
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

const decodeMock = decodeTransactionForApproval as jest.MockedFunction<
  typeof decodeTransactionForApproval
>;

const encrypt = (v: string) =>
  CryptoJS.AES.encrypt(v, PW_FOR_ENCRYPTION).toString();

const renderKas = () =>
  render(
    <TransactionRequest
      rawTx='{"format":"kaspa-core-signing-bundle"}'
      chain="kas"
      utxos={[]}
      path="0-2"
      xpubWallet={encrypt('XPUB_WALLET')}
      xpubKey={encrypt('XPUB_KEY')}
      activityStatus={false}
      actionStatus={jest.fn()}
    />,
  );

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TransactionRequest (kas)', () => {
  it('decodes with the decrypted pair xpubs and path, shows fee + warnings', async () => {
    decodeMock.mockResolvedValue({
      sender: 'kaspa:pvault',
      receiver: 'kaspa:qrecipient',
      amount: '1.5',
      fee: '2',
      tokenSymbol: 'KAS',
      recipientCount: 1,
      warnings: ['fee-above-threshold'],
    });
    renderKas();
    await settle();
    expect(decodeMock).toHaveBeenCalledWith(
      '{"format":"kaspa-core-signing-bundle"}',
      'kas',
      [],
      { xpubWallet: 'XPUB_WALLET', xpubKey: 'XPUB_KEY', path: '0-2' },
    );
    expect(screen.getByTestId('fee')).toHaveTextContent('2');
    expect(screen.getByTestId('risk')).toHaveTextContent(
      'home:kas_tx_warnings_title',
    );
    expect(screen.getByTestId('slider').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('blocks approval when the own-lookup decode fails', async () => {
    decodeMock.mockResolvedValue({
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
      tokenSymbol: 'decodingError',
      errorReason: 'kas_utxo_fetch',
    });
    renderKas();
    await settle();
    expect(screen.queryByTestId('slider')).toBeNull();
    expect(screen.getByTestId('risk')).toHaveTextContent(
      'home:tx_decode_failed_title',
    );
  });
});
