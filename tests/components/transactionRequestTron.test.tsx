import React from 'react';
import * as CryptoJS from 'crypto-js';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import TransactionRequest from '../../src/components/TransactionRequest/TransactionRequest';
import { decodeTransactionForApproval } from '../../src/lib/transactions';

/**
 * TRON approval wiring: the decode must receive the pair's DECRYPTED xpubs,
 * the request path and the pinned network (the vault is derived on-device,
 * never read from the payload); the on-device Op view is rendered; approval
 * hands back exactly the displayed digest summary; a refused payload, a
 * missing summary or an unfunded self-pay account never approves.
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

const mockNetwork = { name: 'pinned-test-network' };
jest.mock('../../src/lib/tron', () => ({
  tronNetwork: () => mockNetwork,
  tronHttpClient: jest.fn(),
  fetchTronBalance: jest.fn(),
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
    TronOpDetails: (props: { view: { calls: { amount: string }[] } }) =>
      leaf('tron-details', props.view.calls.map((c) => c.amount).join(',')),
    SlideToApprove: (props: {
      disabled?: boolean;
      accessibilityLabel?: string;
      onComplete: () => void;
    }) =>
      ReactLib.createElement(
        Text,
        {
          testID: 'slider',
          accessibilityLabel: props.accessibilityLabel,
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

const RAW = '{"format":"ssp-tron-op","version":1}';

const renderTron = (actionStatus: jest.Mock = jest.fn()) =>
  render(
    <TransactionRequest
      rawTx={RAW}
      chain="tron"
      utxos={[]}
      path="0-3"
      xpubWallet={encrypt('XPUB_WALLET')}
      xpubKey={encrypt('XPUB_KEY')}
      activityStatus={false}
      actionStatus={actionStatus}
    />,
  );

const APPROVED = {
  chain: 'tron',
  vault: 'TWq9eJbomJDmkME7ahC4renGL2BXacL2vd',
  digest: '0x5792bc619441f3f65ee8a181e43fbbc1bccd49eb1ed0afa6f9a51e855bd6065c',
};

const view = (extra: Record<string, unknown> = {}) => ({
  chain: 'tron',
  vault: APPROVED.vault,
  nonce: '7',
  deadline: 1790000000,
  calls: [
    {
      index: 0,
      kind: 'trc20Transfer' as const,
      to: 'TGjtodRV2nm6tQd9hsxiecLNN9QmhhVbbD',
      amount: '25',
      amountBaseUnits: '25000000',
      symbol: 'USDT',
      decimals: 6,
      token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      unknownToken: false,
      toVault: false,
    },
  ],
  fee: {
    kind: 'trx' as const,
    amount: '6.3',
    amountBaseUnits: '6300000',
    symbol: 'TRX',
    token: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb',
    recipient: 'TFhcYVArFkJW6bPUDid4AFCAjKmh6Ez3vv',
  },
  selfPay: false,
  isCancellation: false,
  warnings: [],
  ...extra,
});

const decoded = (extra: Record<string, unknown> = {}) => ({
  sender: APPROVED.vault,
  receiver: 'TGjtodRV2nm6tQd9hsxiecLNN9QmhhVbbD',
  amount: '25',
  fee: '6.3',
  tokenSymbol: 'USDT',
  token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  recipientCount: 1,
  tron: view(),
  tronApproved: APPROVED,
  ...extra,
});

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const approveThroughAuth = () => {
  fireEvent.press(screen.getByTestId('slider'));
  const auth = screen.queryByTestId('authentication');
  if (auth) fireEvent.press(auth);
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TransactionRequest (tron)', () => {
  it('decodes with the decrypted pair xpubs, path and pinned network', async () => {
    decodeMock.mockResolvedValue(decoded());
    renderTron();
    await settle();
    expect(decodeMock).toHaveBeenCalledWith(RAW, 'tron', [], undefined, {
      xpubWallet: 'XPUB_WALLET',
      xpubKey: 'XPUB_KEY',
      path: '0-3',
      network: mockNetwork,
      getBalance: expect.any(Function),
    });
    expect(screen.getByTestId('tron-details')).toHaveTextContent('25');
    // the on-device Op view replaces the generic recipient / fee rows
    expect(screen.queryByTestId('recipient')).toBeNull();
    expect(screen.queryByTestId('fee')).toBeNull();
    expect(screen.getByTestId('slider').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('announces the whole Op to screen readers, never "amount + native symbol"', async () => {
    // an unknown TRC-20 would otherwise be read out as "sending 5000000 TRX"
    decodeMock.mockResolvedValue(
      decoded({
        amount: '5000000',
        tokenSymbol: '',
        token: 'TWr4qR84ARRVT2s2ccExEzhy1AbvUg5JUo',
        tron: view({
          calls: [
            {
              ...view().calls[0],
              amount: '5000000',
              symbol: null,
              decimals: null,
              token: 'TWr4qR84ARRVT2s2ccExEzhy1AbvUg5JUo',
              unknownToken: true,
            },
          ],
        }),
      }),
    );
    renderTron();
    await settle();
    expect(screen.getByTestId('slider').props.accessibilityLabel).toBe(
      'home:a11y_approve_action',
    );
  });

  it('hands the displayed digest summary back on approval', async () => {
    decodeMock.mockResolvedValue(decoded());
    const actionStatus = jest.fn();
    renderTron(actionStatus);
    await settle();
    approveThroughAuth();
    expect(actionStatus).toHaveBeenCalledWith(true, undefined, APPROVED);
  });

  it('never approves a tron payload whose decode carried no summary', async () => {
    decodeMock.mockResolvedValue(decoded({ tronApproved: undefined }));
    const actionStatus = jest.fn();
    renderTron(actionStatus);
    await settle();
    approveThroughAuth();
    expect(actionStatus).not.toHaveBeenCalledWith(
      true,
      expect.anything(),
      expect.anything(),
    );
    expect(actionStatus).not.toHaveBeenCalledWith(true);
  });

  it('blocks approval of a refused payload and says why', async () => {
    decodeMock.mockResolvedValue({
      sender: 'decodingError',
      receiver: 'decodingError',
      amount: 'decodingError',
      fee: 'decodingError',
      tokenSymbol: 'decodingError',
      errorReason: 'tron',
      errorDetail: 'policy:FEE_ABOVE_CEILING',
    });
    renderTron();
    await settle();
    expect(screen.queryByTestId('slider')).toBeNull();
    expect(screen.getByTestId('risk')).toHaveTextContent(
      'home:tx_decode_failed_title',
    );
  });

  it('shows an unfunded self-pay account; the signing path re-checks the balance', async () => {
    decodeMock.mockResolvedValue(
      decoded({
        fee: '0',
        tron: view({
          fee: { kind: 'none' },
          selfPay: true,
          selfPayAccount: {
            address: 'TNpFc6D1wF1NEZVdX1nPTm1yPPX3tUm1sV',
            balanceSun: '1000000',
            balance: '1',
            minimumSun: '25000000',
            minimum: '25',
            sufficient: false,
          },
        }),
      }),
    );
    const actionStatus = jest.fn();
    renderTron(actionStatus);
    await settle();
    // the view (with its funding banner) is on screen …
    expect(screen.getByTestId('tron-details')).toBeTruthy();
    // … and approval hands the digest to the signing path, which reads the
    // balance again and refuses before broadcasting when it is still short
    approveThroughAuth();
    expect(actionStatus).toHaveBeenCalledWith(true, undefined, APPROVED);
  });
});
