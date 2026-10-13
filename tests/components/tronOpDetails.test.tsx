import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import TronOpDetails, {
  tronRiskyCalls,
} from '../../src/components/request/TronOpDetails';
import {
  TRON_COSIGNED_OPS_STORAGE_KEY,
  recordTronCosignedOp,
  type TronCallView,
  type TronOpView,
} from '../../src/lib/tron';
import { storage } from '../../src/store/index';

/**
 * TronOpDetails (CHN-6 / CHN-9): approve, unknown contract calls and Stake
 * 2.0 self-calls are rendered under a CRITICAL banner if one ever reaches an
 * approval screen, and an earlier co-signed payment of the vault that is
 * not confirmed on-chain is called out as a possible double payment (the
 * record is re-checked against this device's node).
 */

// CHN-9: this device's TRON node, as seen by the on-chain re-check.
const mockTronClient = {
  hasCode: jest.fn(() => Promise.resolve(true)),
  isNonceUsed: jest.fn<Promise<boolean>, [string, bigint]>(() =>
    Promise.resolve(false),
  ),
};
jest.mock('../../src/lib/tron', () => ({
  ...jest.requireActual('../../src/lib/tron'),
  tronHttpClient: () => mockTronClient,
}));

// lucide ships ESM only: every icon is a no-op component here.
jest.mock(
  'lucide-react-native',
  () => new Proxy({}, { get: () => () => null }),
);

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
      darkMode: false,
    }),
  };
});

const VAULT = 'TWq9eJbomJDmkME7ahC4renGL2BXacL2vd';
const TO = 'TGjtodRV2nm6tQd9hsxiecLNN9QmhhVbbD';
const NOW_SEC = Math.floor(Date.now() / 1000);

const call = (over: Partial<TronCallView>): TronCallView => ({
  index: 0,
  kind: 'trxTransfer',
  to: TO,
  amount: '1',
  amountBaseUnits: '1000000',
  symbol: 'TRX',
  decimals: 6,
  unknownToken: false,
  toVault: false,
  ...over,
});

const view = (calls: TronCallView[], nonce = '7'): TronOpView => ({
  chain: 'tron',
  vault: VAULT,
  nonce,
  deadline: NOW_SEC + 600,
  calls,
  fee: { kind: 'none' },
  selfPay: true,
  isCancellation: calls.length === 0,
  warnings: [],
});

beforeEach(() => {
  storage.set(TRON_COSIGNED_OPS_STORAGE_KEY, '[]');
  mockTronClient.hasCode.mockImplementation(() => Promise.resolve(true));
  mockTronClient.isNonceUsed.mockImplementation(() => Promise.resolve(false));
});

/** Let the on-chain re-check resolve and its state update land. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

const cosigned = (nonce: bigint) =>
  recordTronCosignedOp({
    chain: 'tron',
    vault: VAULT,
    nonce,
    deadline: BigInt(NOW_SEC + 900),
    digest: '0x' + nonce.toString(16).padStart(64, '0'),
  });

describe('TronOpDetails risk banners', () => {
  it('a plain transfer shows no critical banner', () => {
    render(<TronOpDetails view={view([call({})])} />);
    expect(screen.queryByText('home:tron_risky_calls_title')).toBeNull();
    expect(screen.queryByText('home:tron_refused_pending_title')).toBeNull();
  });

  it('approve / unknown / staking calls are shown under a critical banner', () => {
    const risky = [
      call({ index: 0, kind: 'approve', to: TO, token: TO }),
      call({ index: 1, kind: 'unknown', data: '0x12345678' }),
      call({
        index: 2,
        kind: 'selfCall',
        to: VAULT,
        action: 'delegateResource',
      }),
      call({
        index: 3,
        kind: 'selfCall',
        to: VAULT,
        action: 'invalidateNonces',
      }),
    ];
    expect(tronRiskyCalls(view(risky)).map((c) => c.index)).toEqual([0, 1, 2]);
    render(<TronOpDetails view={view(risky)} />);
    expect(screen.getByText('home:tron_risky_calls_title')).toBeTruthy();
    expect(screen.getByText('home:tron_risky_call_approve')).toBeTruthy();
    expect(screen.getByText('home:tron_risky_call_unknown')).toBeTruthy();
    expect(screen.getByText('home:tron_risky_call_staking')).toBeTruthy();
  });

  it('warns about an earlier co-signed payment under another nonce that is not on-chain (CHN-9)', async () => {
    cosigned(7n);
    const { unmount } = render(<TronOpDetails view={view([call({})], '8')} />);
    expect(screen.getByText('home:tron_refused_pending_title')).toBeTruthy();
    expect(screen.getByText('home:tron_refused_pending_desc')).toBeTruthy();
    // the node does not show nonce 7 used: the warning stays
    await settle();
    expect(mockTronClient.isNonceUsed).toHaveBeenCalledWith(VAULT, 7n);
    expect(screen.getByText('home:tron_refused_pending_title')).toBeTruthy();
    unmount();
    // the same nonce replaces the earlier payment: no warning
    render(<TronOpDetails view={view([call({})], '7')} />);
    expect(screen.queryByText('home:tron_refused_pending_title')).toBeNull();
  });

  it('drops the warning once the node shows the earlier nonce used (a confirmed payment)', async () => {
    cosigned(7n);
    mockTronClient.isNonceUsed.mockImplementation(() => Promise.resolve(true));
    render(<TronOpDetails view={view([call({})], '8')} />);
    await settle();
    expect(mockTronClient.isNonceUsed).toHaveBeenCalledWith(VAULT, 7n);
    expect(screen.queryByText('home:tron_refused_pending_title')).toBeNull();
  });

  it('keeps the warning when the node cannot be asked', async () => {
    cosigned(7n);
    mockTronClient.hasCode.mockImplementation(() =>
      Promise.reject(new Error('node down')),
    );
    render(<TronOpDetails view={view([call({})], '8')} />);
    await settle();
    expect(mockTronClient.hasCode).toHaveBeenCalled();
    expect(screen.getByText('home:tron_refused_pending_title')).toBeTruthy();
  });

  it('an unreadable refusal record is shown, not hidden', () => {
    storage.set(TRON_COSIGNED_OPS_STORAGE_KEY, '{oops');
    render(<TronOpDetails view={view([call({})], '8')} />);
    expect(screen.getByText('home:tron_refused_unreadable_desc')).toBeTruthy();
  });
});
