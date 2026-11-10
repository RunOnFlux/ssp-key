import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import TransactionRequest from '../../src/components/TransactionRequest/TransactionRequest';
import { decodeTransactionForApproval } from '../../src/lib/transactions';

/**
 * Kaspa approval wiring: the decode must receive the pair's DECRYPTED xpubs
 * (this chain's stored ones) and the request path (the vault is derived
 * on-device, never read from the payload), the fee is shown,
 * describeTransaction warnings are surfaced and a failed own-lookup decode
 * blocks approval.
 */

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
  // This chain's stored (encrypted) xpubs, as the screen reads them.
  const enc = (v: string) =>
    require('crypto-js')
      .AES.encrypt(v, 'enc-key' + 'pw')
      .toString();
  const chainState = {
    xpubWallet: enc('XPUB_WALLET'),
    xpubKey: enc('XPUB_KEY'),
  };
  const state = new Proxy({}, { get: () => chainState });
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

const renderKas = (actionStatus: jest.Mock = jest.fn()) =>
  render(
    <TransactionRequest
      rawTx='{"format":"kaspa-core-signing-bundle"}'
      chain="kas"
      utxos={[]}
      path="0-2"
      activityStatus={false}
      actionStatus={actionStatus}
    />,
  );

const APPROVED = {
  txid: 'ab'.repeat(32),
  fee: '200000000',
  outputs: ['kaspa:qrecipient|150000000'],
};

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
      kasWarnings: ['fee-above-threshold'],
    });
    renderKas();
    await settle();
    expect(decodeMock).toHaveBeenCalledWith(
      '{"format":"kaspa-core-signing-bundle"}',
      'kas',
      { xpubWallet: 'XPUB_WALLET', xpubKey: 'XPUB_KEY', path: '0-2' },
      {},
      expect.any(Function),
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

  it('hands the displayed summary back on approval', async () => {
    decodeMock.mockResolvedValue({
      sender: 'kaspa:pvault',
      receiver: 'kaspa:qrecipient',
      amount: '1.5',
      fee: '2',
      tokenSymbol: 'KAS',
      recipientCount: 1,
      kasWarnings: [],
      kasApproved: APPROVED,
    });
    const actionStatus = jest.fn();
    renderKas(actionStatus);
    await settle();
    fireEvent.press(screen.getByTestId('slider'));
    fireEvent.press(screen.getByTestId('authentication'));
    expect(actionStatus).toHaveBeenCalledWith(true, APPROVED);
  });

  it('never approves a kas payload whose decode carried no summary', async () => {
    decodeMock.mockResolvedValue({
      sender: 'kaspa:pvault',
      receiver: 'kaspa:qrecipient',
      amount: '1.5',
      fee: '2',
      tokenSymbol: 'KAS',
      recipientCount: 1,
      kasWarnings: [],
    });
    const actionStatus = jest.fn();
    renderKas(actionStatus);
    await settle();
    fireEvent.press(screen.getByTestId('slider'));
    fireEvent.press(screen.getByTestId('authentication'));
    expect(actionStatus).not.toHaveBeenCalledWith(true, expect.anything());
    expect(actionStatus).not.toHaveBeenCalledWith(true);
  });

  it('re-decodes when the request path changes (effect deps)', async () => {
    decodeMock.mockResolvedValue({
      sender: 'kaspa:pvault',
      receiver: 'kaspa:qrecipient',
      amount: '1.5',
      fee: '2',
      tokenSymbol: 'KAS',
      recipientCount: 1,
      kasWarnings: [],
      kasApproved: APPROVED,
    });
    const actionStatus = jest.fn();
    const view = renderKas(actionStatus);
    await settle();
    expect(decodeMock).toHaveBeenCalledTimes(1);
    view.rerender(
      <TransactionRequest
        rawTx='{"format":"kaspa-core-signing-bundle"}'
        chain="kas"
        utxos={[]}
        path="0-3"
        activityStatus={false}
        actionStatus={actionStatus}
      />,
    );
    await settle();
    expect(decodeMock).toHaveBeenCalledTimes(2);
    expect(decodeMock).toHaveBeenLastCalledWith(
      '{"format":"kaspa-core-signing-bundle"}',
      'kas',
      { xpubWallet: 'XPUB_WALLET', xpubKey: 'XPUB_KEY', path: '0-3' },
      {},
      expect.any(Function),
    );
  });
});
