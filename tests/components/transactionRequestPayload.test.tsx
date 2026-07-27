import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen } from '@testing-library/react-native';
import TransactionRequest from '../../src/components/TransactionRequest/TransactionRequest';
import { decodeTransactionForApproval } from '../../src/lib/transactions';
import type { utxo } from '../../src/types';

/**
 * Payload-identity regression guard for the transaction approval screen.
 *
 * The bug: a second transaction request arriving while the first was still
 * decoding was never decoded. A boolean re-entrancy guard returned from the
 * decode effect BEFORE any state reset, and it was cleared only in the async
 * `finally` — by which time the new effect run had already bailed and, with
 * deps of [rawTx, chain], would never re-fire. The in-flight decode of the OLD
 * payload then wrote its values unguarded and no displayed field was ever
 * cleared, so the SSP Key could display transaction #1 while the slide to
 * approve signed transaction #2 (Home signs its CURRENT rawTx state).
 *
 * These tests pin the three properties that make that interleaving
 * impossible: the new payload is decoded, no field survives a payload change,
 * and a superseded decode cannot write state or be approved.
 */

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

type TxInfo = Awaited<ReturnType<typeof decodeTransactionForApproval>>;

const decodeMock = decodeTransactionForApproval as jest.MockedFunction<
  typeof decodeTransactionForApproval
>;

const UTXOS: utxo[] = [
  {
    txid: 'a'.repeat(64),
    vout: 0,
    scriptPubKey: '0014' + 'b'.repeat(40),
    satoshis: '100000',
    confirmations: 6,
    coinbase: false,
  },
];

const txInfo = (suffix: string): TxInfo => ({
  sender: `SENDER_${suffix}`,
  receiver: `RECEIVER_${suffix}`,
  amount: `1.${suffix.length}`,
  fee: `0.000${suffix.length}`,
  tokenSymbol: 'BTC',
});

/** Applies a state change and lets every pending microtask settle. */
const flush = async (change: () => void) => {
  await act(async () => {
    change();
    await Promise.resolve();
  });
};

/** Pending decode per rawTx, resolvable/rejectable from the test body. */
function deferredDecodes() {
  const settlers = new Map<
    string,
    { resolve: (info: TxInfo) => void; reject: (error: Error) => void }
  >();
  decodeMock.mockImplementation(
    (rawTx: string) =>
      new Promise<TxInfo>((resolve, reject) => {
        settlers.set(rawTx, { resolve, reject });
      }),
  );
  return {
    settle: (rawTx: string, info: TxInfo) =>
      flush(() => settlers.get(rawTx)!.resolve(info)),
    fail: (rawTx: string, error: Error) =>
      flush(() => settlers.get(rawTx)!.reject(error)),
  };
}

const renderRequest = (rawTx: string, actionStatus = jest.fn()) => {
  const view = render(
    <TransactionRequest
      rawTx={rawTx}
      chain="btc"
      utxos={UTXOS}
      activityStatus={false}
      actionStatus={actionStatus}
    />,
  );
  const rerenderWith = (nextRawTx: string) =>
    view.rerender(
      <TransactionRequest
        rawTx={nextRawTx}
        chain="btc"
        utxos={UTXOS}
        activityStatus={false}
        actionStatus={actionStatus}
      />,
    );
  return { ...view, rerenderWith, actionStatus };
};

const isSliderDisabled = () =>
  screen.getByTestId('slider').props.accessibilityState.disabled === true;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TransactionRequest payload identity', () => {
  it('shows the loading state and blocks approval until the decode resolves', async () => {
    const decodes = deferredDecodes();
    const { actionStatus } = renderRequest('TX_A');

    expect(screen.getByText('home:tx_decoding')).toBeTruthy();
    expect(screen.queryByTestId('recipient')).toBeNull();
    expect(isSliderDisabled()).toBe(true);

    await decodes.settle('TX_A', txInfo('A'));

    expect(screen.queryByText('home:tx_decoding')).toBeNull();
    expect(screen.getByTestId('recipient')).toHaveTextContent('RECEIVER_A');
    expect(isSliderDisabled()).toBe(false);
    expect(actionStatus).not.toHaveBeenCalled();
  });

  it('decodes a payload that arrives while the previous decode is in flight', async () => {
    const decodes = deferredDecodes();
    const { rerenderWith } = renderRequest('TX_A');

    rerenderWith('TX_B');

    // The old bug: the re-entrancy guard bailed out here and, because rawTx
    // never changed again, TX_B was never decoded at all.
    expect(decodeMock).toHaveBeenCalledTimes(2);
    expect(decodeMock).toHaveBeenLastCalledWith('TX_B', 'btc', UTXOS);

    await decodes.settle('TX_B', txInfo('B'));

    expect(screen.getByTestId('recipient')).toHaveTextContent('RECEIVER_B');
    expect(screen.getByTestId('sender')).toHaveTextContent('SENDER_B');
    expect(isSliderDisabled()).toBe(false);
  });

  it('never renders the previous payload once a new one arrives', async () => {
    const decodes = deferredDecodes();
    const { rerenderWith } = renderRequest('TX_A');
    await decodes.settle('TX_A', txInfo('A'));
    expect(screen.getByTestId('recipient')).toHaveTextContent('RECEIVER_A');

    rerenderWith('TX_B');

    // Every displayed field is cleared synchronously with the payload change:
    // no value block is on screen, only the loading state.
    expect(screen.getByText('home:tx_decoding')).toBeTruthy();
    expect(screen.queryByTestId('recipient')).toBeNull();
    expect(screen.queryByTestId('fee')).toBeNull();
    expect(screen.queryByTestId('action')).toBeNull();
    expect(screen.getByTestId('sender')).toHaveTextContent('');
    expect(isSliderDisabled()).toBe(true);
  });

  it('drops the values of a decode that resolves after a newer payload arrived', async () => {
    const decodes = deferredDecodes();
    const { rerenderWith } = renderRequest('TX_A');

    rerenderWith('TX_B');
    await decodes.settle('TX_A', txInfo('A')); // late, superseded

    expect(screen.getByText('home:tx_decoding')).toBeTruthy();
    expect(screen.queryByTestId('recipient')).toBeNull();
    expect(isSliderDisabled()).toBe(true);

    await decodes.settle('TX_B', txInfo('B'));

    expect(screen.getByTestId('recipient')).toHaveTextContent('RECEIVER_B');
  });

  it('does not block the new payload when the superseded decode fails', async () => {
    const decodes = deferredDecodes();
    const { rerenderWith } = renderRequest('TX_A');

    rerenderWith('TX_B');
    await decodes.fail('TX_A', new Error('decode of the abandoned payload'));

    // The failure belongs to a payload nobody is looking at — it must not
    // hard-block the request now on screen.
    expect(screen.queryByTestId('risk')).toBeNull();

    await decodes.settle('TX_B', txInfo('B'));

    expect(screen.queryByTestId('risk')).toBeNull();
    expect(screen.getByTestId('recipient')).toHaveTextContent('RECEIVER_B');
    expect(isSliderDisabled()).toBe(false);
  });

  it('blocks approval and clears the values when the decode fails', async () => {
    const decodes = deferredDecodes();
    const { actionStatus } = renderRequest('TX_A');
    await decodes.fail('TX_A', new Error('undecodable'));

    expect(screen.getByTestId('risk')).toHaveTextContent(
      'home:tx_decode_failed_title',
    );
    expect(screen.queryByTestId('slider')).toBeNull();
    expect(actionStatus).not.toHaveBeenCalled();
  });

  it('never approves a payload change that happened mid-authentication', async () => {
    const decodes = deferredDecodes();
    const { rerenderWith, actionStatus } = renderRequest('TX_A');
    await decodes.settle('TX_A', txInfo('A'));

    await flush(() => screen.getByTestId('slider').props.onPress());
    expect(screen.getByTestId('authentication')).toBeTruthy();

    rerenderWith('TX_B');

    // The authentication started for TX_A is gone; the user re-approves what
    // is on screen once TX_B is decoded.
    expect(screen.queryByTestId('authentication')).toBeNull();
    expect(actionStatus).not.toHaveBeenCalled();
  });

  it('refuses to approve while a decode is in flight', async () => {
    const decodes = deferredDecodes();
    const { actionStatus } = renderRequest('TX_A');

    // The real slider also refuses to fire while disabled; this drives the
    // approve() choke point itself, which both approve paths funnel through.
    await flush(() => screen.getByTestId('slider').props.onPress());
    const auth = screen.queryByTestId('authentication');
    if (auth) {
      await flush(() => auth.props.onPress());
    }
    expect(actionStatus).not.toHaveBeenCalled();

    await decodes.settle('TX_A', txInfo('A'));
    expect(actionStatus).not.toHaveBeenCalled();
  });
});

describe('HomeRequests mounts one TransactionRequest per payload', () => {
  it('keys the component on rawTx', () => {
    // A fresh mount per payload makes stale decoded state unrepresentable in
    // the app even though the component guards the same invariant itself.
    const source = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        'src',
        'screens',
        'Home',
        'components',
        'HomeRequests.tsx',
      ),
      'utf8',
    );
    const mount = source.slice(
      source.indexOf('<TransactionRequest'),
      source.indexOf('/>', source.indexOf('<TransactionRequest')),
    );
    expect(mount).toContain('key={rawTx}');
  });
});
