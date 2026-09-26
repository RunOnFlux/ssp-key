/**
 * usePendingRequests, Kaspa routing:
 *  - a kas vault request is decoded ONLY through the kas own-lookup decode
 *    (never the utxolib path), and its verdict starts pending (null);
 *  - a decode started for an older request can never overwrite the verdict
 *    or decoded values of a newer one, nor survive the clear/complete path;
 *  - kas is refused for EVM message signing (contract §6).
 */
import { act, renderHook } from '@testing-library/react-native';

import type { KasVaultDecodeState } from '../../src/lib/kaspaVault';
import type { VaultDecodedTx } from '../../src/lib/transactions';
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

// Each kas decode is held open until the test resolves it.
type Pending = {
  data: { requestId?: string };
  finish: (decoded: VaultDecodedTx, state: KasVaultDecodeState) => void;
};
const pending: Pending[] = [];
jest.mock('../../src/lib/kaspaVault', () => ({
  applyVaultKasDecode: (
    data: { requestId?: string },
    setDecoded: (tx: VaultDecodedTx) => void,
    setState: (s: KasVaultDecodeState) => void,
  ) =>
    new Promise<void>((resolve) => {
      pending.push({
        data,
        finish: (decoded, state) => {
          setDecoded(decoded);
          setState(state);
          resolve();
        },
      });
    }),
}));

import { usePendingRequests } from '../../src/screens/Home/hooks/usePendingRequests';

const kasRequest = (requestId: string) =>
  ({
    chain: 'kas',
    orgIndex: 100,
    vaultIndex: 0,
    requestId,
    rawUnsignedTx: '{"format":"kaspa-core-signing-bundle","version":1}',
    inputDetails: JSON.stringify([{ index: 0, addressIndex: 0 }]),
    recipients: JSON.stringify([{ address: 'kaspa:qr', amount: '1' }]),
    fee: '1',
    walletSignatures: [],
    walletPubKey: '',
    wkIdentity: 'wk',
  }) as unknown as vaultSigningRequest;

const decodedFor = (id: string): VaultDecodedTx => ({
  sender: `sender-${id}`,
  recipients: [],
  fee: '1',
});
const ok: KasVaultDecodeState = { status: 'ok', reasons: [], warnings: [] };
const failed: KasVaultDecodeState = {
  status: 'failed',
  reasons: ['recipients differ from the proposal'],
  warnings: [],
};

beforeEach(() => {
  pending.length = 0;
  jest.clearAllMocks();
});

describe('usePendingRequests (kas)', () => {
  it('routes a kas vault request to the own-lookup decode, pending first', async () => {
    const { result } = renderHook(() => usePendingRequests('btc'));
    act(() => {
      result.current.ingestVaultSigningRequest(kasRequest('a'), 'label');
    });
    expect(pending).toHaveLength(1);
    // inputDetails / recipients arrive parsed
    expect(pending[0].data).toMatchObject({
      requestId: 'a',
      inputDetails: [{ index: 0, addressIndex: 0 }],
    });
    expect(mockDecodeVaultTransaction).not.toHaveBeenCalled(); // never utxolib
    expect(result.current.kasDecodeState).toBeNull(); // pending blocks approval
    expect(result.current.decodedVaultTx).toBeNull();
    await act(async () => {
      pending[0].finish(decodedFor('a'), ok);
      await Promise.resolve();
    });
    expect(result.current.kasDecodeState).toEqual(ok);
    expect(result.current.decodedVaultTx).toEqual(decodedFor('a'));
  });

  it('a stale decode never overwrites the verdict of a newer request', async () => {
    const { result } = renderHook(() => usePendingRequests('btc'));
    act(() => {
      result.current.ingestVaultSigningRequest(kasRequest('old'), 'label');
    });
    act(() => {
      result.current.ingestVaultSigningRequest(kasRequest('new'), 'label');
    });
    expect(pending.map((p) => p.data.requestId)).toEqual(['old', 'new']);
    // the NEW (failing) request resolves first, then the OLD one says ok
    await act(async () => {
      pending[1].finish(decodedFor('new'), failed);
      await Promise.resolve();
    });
    await act(async () => {
      pending[0].finish(decodedFor('old'), ok);
      await Promise.resolve();
    });
    expect(result.current.vaultSigningData?.requestId).toBe('new');
    expect(result.current.kasDecodeState).toEqual(failed);
    expect(result.current.decodedVaultTx).toEqual(decodedFor('new'));
  });

  it('a decode finishing after the request was cleared is discarded', async () => {
    const { result } = renderHook(() => usePendingRequests('btc'));
    act(() => {
      result.current.ingestVaultSigningRequest(kasRequest('a'), 'label');
    });
    act(() => {
      result.current.clearVaultSigningState();
    });
    await act(async () => {
      pending[0].finish(decodedFor('a'), ok);
      await Promise.resolve();
    });
    expect(result.current.vaultSigningData).toBeNull();
    expect(result.current.kasDecodeState).toBeNull();
    expect(result.current.decodedVaultTx).toBeNull();
  });

  it('refuses kas for EVM message signing', () => {
    const onUnsupported = jest.fn();
    const { result } = renderHook(() =>
      usePendingRequests('btc', onUnsupported),
    );
    act(() => {
      result.current.handleEvmSigningRequest({
        chain: 'kas',
      } as unknown as evmSigningRequest);
    });
    expect(result.current.evmSigningData).toBeNull();
    expect(onUnsupported).toHaveBeenCalledWith('evmsigning', 'kas');
  });
});
