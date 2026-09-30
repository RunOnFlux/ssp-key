/**
 * usePendingRequests, TRON routing:
 *  - a TRON `tx` is refused outright (txrejected via onUnsupportedChain, a
 *    clear "not live" message) while the SDK table has no deployment;
 *  - a TRON vault request is decoded ONLY through the tronOp verification
 *    (never utxolib) and fails closed while TRON is not live;
 *  - tron is refused for EVM message signing (contract §7).
 */
import { act, renderHook } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import type { evmSigningRequest, vaultSigningRequest } from '../../src/types';

jest.mock('react-native-toast-message', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../src/hooks/useSocket', () => {
  const socket = {
    newTx: { rawTx: '', chain: '', path: '', utxos: [] },
    publicNoncesRequest: '',
    evmSigningRequest: null,
    wkSigningRequest: null,
    vaultXpubRequest: null,
    vaultSigningRequest: null,
    keyNonceSyncRequest: null,
    fluxNodeStartRequest: null,
  };
  return { useSocket: () => socket };
});

const mockDecodeVaultTransaction = jest.fn();
jest.mock('../../src/lib/transactions', () => ({
  decodeVaultTransaction: (...args: unknown[]) =>
    mockDecodeVaultTransaction(...args),
}));

jest.mock('../../src/lib/rates', () => ({
  getCryptoUsdRate: jest.fn(() => Promise.resolve(0)),
}));

import { usePendingRequests } from '../../src/screens/Home/hooks/usePendingRequests';

const TRON_TX = JSON.stringify({ format: 'ssp-tron-op', version: 1 });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('usePendingRequests (tron)', () => {
  it('refuses a TRON tx while TRON is not live and tells the wallet', () => {
    const onUnsupported = jest.fn();
    const { result } = renderHook(() =>
      usePendingRequests('btc', onUnsupported),
    );
    act(() => {
      result.current.handleTxRequest(TRON_TX, 'tron', '0-0', []);
    });
    expect(result.current.rawTx).toBe('');
    expect(onUnsupported).toHaveBeenCalledWith('tx', 'tron');
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text1: 'home:err_tron_not_live' }),
    );
    act(() => {
      result.current.handleTxRequest(TRON_TX, 'tronNile', '0-0', []);
    });
    expect(onUnsupported).toHaveBeenCalledWith('tx', 'tronNile');
  });

  it('decodes a TRON vault request from tronOp only — failed while not live', async () => {
    const { result } = renderHook(() => usePendingRequests('btc'));
    act(() => {
      result.current.ingestVaultSigningRequest(
        {
          chain: 'tron',
          orgIndex: 100,
          vaultIndex: 0,
          requestId: 'r',
          rawUnsignedTx: '0x' + '11'.repeat(32),
          tronOp: '{}',
          inputDetails: '[]',
          recipients: '[]',
          fee: '0',
          walletSignatures: [],
          walletPubKey: '',
          wkIdentity: 'wk',
        } as unknown as vaultSigningRequest,
        'label',
      );
    });
    expect(mockDecodeVaultTransaction).not.toHaveBeenCalled(); // never utxolib
    // pending (null) until the rate lookup resolves: approval blocked
    expect(result.current.tronDecodeState).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.tronDecodeState).toEqual(
      expect.objectContaining({ status: 'failed' }),
    );
    expect(result.current.tronDecodeState?.reasons[0]).toMatch(/not live/);
    expect(result.current.decodedVaultTx?.error).toBeTruthy();
    act(() => {
      result.current.clearVaultSigningState();
    });
    expect(result.current.tronDecodeState).toBeNull();
  });

  it('refuses tron for EVM message signing', () => {
    const onUnsupported = jest.fn();
    const { result } = renderHook(() =>
      usePendingRequests('btc', onUnsupported),
    );
    act(() => {
      result.current.handleEvmSigningRequest({
        chain: 'tron',
        walletInUse: '0-0',
        requestId: 'x',
      } as unknown as evmSigningRequest);
    });
    expect(result.current.evmSigningData).toBeNull();
    expect(onUnsupported).toHaveBeenCalledWith('evmsigning', 'tron');
  });
});
