/**
 * Regression tests for how relay-delivered actions reach the Home screen.
 *
 * Two bugs are pinned here:
 *
 * 1. An unknown chain id crashed Home. The store registers exactly one slice
 *    per key of `blockchains`, and Home destructures `state[activeChain]` in
 *    its render body. Writing a relay-supplied chain straight into
 *    `activeChain` therefore threw on every render — and there is no
 *    ErrorBoundary in this app, so the screen stayed down for as long as the
 *    request state lived. `isSupportedChain` is the gate every incoming chain
 *    must pass first.
 *
 * 2. The `GET /v1/action` poll (pull-to-refresh, and the handler a tapped push
 *    notification runs) answered only 8 of the 10 Key-directed relay actions —
 *    `recoveryrequest` and `enterprisefluxnodestart` were silently dropped, so
 *    tapping those notifications opened an idle Home. Both transports now agree
 *    on the action list, and the parity test below fails if they drift.
 */
import fs from 'fs';
import path from 'path';

import { blockchains } from '../../src/storage/blockchains';
import { store } from '../../src/store';
import {
  KEY_RELAY_ACTIONS,
  isSupportedChain,
  parseRecoveryRequestPayload,
  routeRelayAction,
  type RelayActionHandlers,
} from '../../src/screens/Home/hooks/usePendingRequests';

// The hook module pulls in the vault decoders and the socket context; neither
// takes part in routing, and the real ones drag in the Solana stack.
jest.mock('../../src/lib/transactions', () => ({
  decodeVaultTransaction: jest.fn(),
}));
jest.mock('../../src/lib/vaultSolanaDecode', () => ({
  applyVaultSolDecode: jest.fn(),
}));
jest.mock('../../src/hooks/useSocket', () => ({
  useSocket: jest.fn(() => ({})),
}));

const makeHandlers = (): jest.Mocked<RelayActionHandlers> => ({
  onTx: jest.fn(),
  onPublicNoncesRequest: jest.fn(),
  onEvmSigningRequest: jest.fn(),
  onWkSigningRequest: jest.fn(),
  onVaultSigningRequest: jest.fn(),
  onVaultXpubRequest: jest.fn(),
  onFluxNodeStartRequest: jest.fn(),
  onKeyNonceSyncRequest: jest.fn(),
  onRecoveryRequest: jest.fn(),
  onChainSyncRequest: jest.fn(),
  onInvalidPayload: jest.fn(),
});

describe('isSupportedChain', () => {
  it('accepts every chain the store registers a slice for', () => {
    const state = store.getState() as unknown as Record<string, unknown>;
    Object.keys(blockchains).forEach((chain) => {
      expect(isSupportedChain(chain)).toBe(true);
      // the reason the guard exists: this is what Home destructures
      expect(state[chain]).toBeDefined();
    });
  });

  it('rejects a chain the relay invented — the store has no slice for it', () => {
    const state = store.getState() as unknown as Record<
      string,
      { xpubKey: string } | undefined
    >;
    expect(isSupportedChain('newChainFromTheFuture')).toBe(false);
    const slice = state.newChainFromTheFuture;
    expect(slice).toBeUndefined();
    // the crash this guards: exactly what Home does with state[activeChain]
    expect(() => {
      const { xpubKey } = slice as { xpubKey: string };
      return xpubKey;
    }).toThrow(TypeError);
  });

  it('rejects non-string and prototype-inherited keys', () => {
    expect(isSupportedChain(undefined)).toBe(false);
    expect(isSupportedChain(null)).toBe(false);
    expect(isSupportedChain('')).toBe(false);
    expect(isSupportedChain(42)).toBe(false);
    expect(isSupportedChain({ id: 'btc' })).toBe(false);
    // truthy on `blockchains[chain]`, but not a registered chain
    expect(isSupportedChain('constructor')).toBe(false);
    expect(isSupportedChain('toString')).toBe(false);
  });
});

describe('parseRecoveryRequestPayload', () => {
  const valid = {
    pkEph: 'ab'.repeat(33),
    nonce: 'ff00',
    timestamp: 1700000000,
    recoveryIndex: 0,
  };

  it('accepts a well-formed payload', () => {
    expect(parseRecoveryRequestPayload(JSON.stringify(valid))).toEqual(valid);
  });

  it('rejects malformed, missing and non-JSON payloads', () => {
    expect(parseRecoveryRequestPayload(undefined)).toBeNull();
    expect(parseRecoveryRequestPayload('')).toBeNull();
    expect(parseRecoveryRequestPayload('not json')).toBeNull();
    expect(parseRecoveryRequestPayload('null')).toBeNull();
    expect(
      parseRecoveryRequestPayload(JSON.stringify({ ...valid, pkEph: 123 })),
    ).toBeNull();
    expect(
      parseRecoveryRequestPayload(JSON.stringify({ ...valid, nonce: null })),
    ).toBeNull();
    expect(
      parseRecoveryRequestPayload(JSON.stringify({ ...valid, timestamp: '1' })),
    ).toBeNull();
    // The index says which key of the recovery account the requester's
    // envelope uses, so a request without it cannot be answered usefully.
    expect(
      parseRecoveryRequestPayload(
        JSON.stringify({ ...valid, recoveryIndex: undefined }),
      ),
    ).toBeNull();
    expect(
      parseRecoveryRequestPayload(
        JSON.stringify({ ...valid, recoveryIndex: '0' }),
      ),
    ).toBeNull();
    // the object itself, not a JSON string — the relay always sends strings
    expect(parseRecoveryRequestPayload(valid)).toBeNull();
  });
});

describe('routeRelayAction', () => {
  it('routes a tx action with its chain, path and utxos', () => {
    const handlers = makeHandlers();
    const utxos = [{ txid: 'a', vout: 0 }];
    expect(
      routeRelayAction(
        {
          action: 'tx',
          payload: '0100000001',
          chain: 'btc',
          path: '0-0',
          utxos,
        },
        handlers,
      ),
    ).toBe(true);
    expect(handlers.onTx).toHaveBeenCalledWith('0100000001', 'btc', '0-0', [
      { txid: 'a', vout: 0 },
    ]);
  });

  it('defaults a missing tx path/utxos instead of passing undefined on', () => {
    const handlers = makeHandlers();
    routeRelayAction({ action: 'tx', payload: 'raw', chain: 'btc' }, handlers);
    expect(handlers.onTx).toHaveBeenCalledWith('raw', 'btc', '', []);
  });

  it('reports an invalid payload rather than surfacing an empty request', () => {
    const handlers = makeHandlers();
    expect(routeRelayAction({ action: 'tx' }, handlers)).toBe(true);
    expect(handlers.onTx).not.toHaveBeenCalled();
    expect(handlers.onInvalidPayload).toHaveBeenCalledTimes(1);
  });

  it('routes publicnoncesrequest with the requested chain', () => {
    const handlers = makeHandlers();
    routeRelayAction({ action: 'publicnoncesrequest', chain: 'eth' }, handlers);
    expect(handlers.onPublicNoncesRequest).toHaveBeenCalledWith('eth');
  });

  it('parses the JSON payload of the signing/vault actions', () => {
    const cases: {
      action: string;
      payload: Record<string, unknown>;
      handler: keyof RelayActionHandlers;
    }[] = [
      {
        action: 'evmsigningrequest',
        payload: { chain: 'eth', requestId: 'r1' },
        handler: 'onEvmSigningRequest',
      },
      {
        action: 'wksigningrequest',
        payload: { message: 'm' },
        handler: 'onWkSigningRequest',
      },
      {
        action: 'enterprisevaultsign',
        payload: { chain: 'btc', recipients: [] },
        handler: 'onVaultSigningRequest',
      },
      {
        action: 'enterprisevaultxpub',
        payload: { chain: 'btc', vaultId: 'v1' },
        handler: 'onVaultXpubRequest',
      },
    ];
    cases.forEach(({ action, payload, handler }) => {
      const handlers = makeHandlers();
      expect(
        routeRelayAction(
          { action, payload: JSON.stringify(payload) },
          handlers,
        ),
      ).toBe(true);
      expect(handlers[handler]).toHaveBeenCalledWith(payload);
      expect(handlers.onInvalidPayload).not.toHaveBeenCalled();
    });
  });

  it('reports invalid JSON on the signing/vault actions', () => {
    [
      'evmsigningrequest',
      'wksigningrequest',
      'enterprisevaultsign',
      'enterprisevaultxpub',
      'enterprisefluxnodestart',
      'recoveryrequest',
    ].forEach((action) => {
      const handlers = makeHandlers();
      expect(routeRelayAction({ action, payload: '{oops' }, handlers)).toBe(
        true,
      );
      expect(handlers.onInvalidPayload).toHaveBeenCalledTimes(1);
    });
  });

  it('routes enterprisekeynoncesync, which carries no payload', () => {
    const handlers = makeHandlers();
    expect(
      routeRelayAction({ action: 'enterprisekeynoncesync' }, handlers),
    ).toBe(true);
    expect(handlers.onKeyNonceSyncRequest).toHaveBeenCalledTimes(1);
  });

  it('routes enterprisefluxnodestart — the poll path used to drop it', () => {
    const handlers = makeHandlers();
    const request = { requestId: 'req-1', chain: 'flux', collateral: 'x' };
    expect(
      routeRelayAction(
        { action: 'enterprisefluxnodestart', payload: JSON.stringify(request) },
        handlers,
      ),
    ).toBe(true);
    expect(handlers.onFluxNodeStartRequest).toHaveBeenCalledWith(request);
  });

  it('routes recoveryrequest on the poll path too', () => {
    const handlers = makeHandlers();
    const request = {
      pkEph: 'aa',
      nonce: 'bb',
      timestamp: 1700000000,
      recoveryIndex: 0,
    };
    expect(
      routeRelayAction(
        { action: 'recoveryrequest', payload: JSON.stringify(request) },
        handlers,
      ),
    ).toBe(true);
    expect(handlers.onRecoveryRequest).toHaveBeenCalledWith(request);
  });

  it('rejects a recoveryrequest that fails validation', () => {
    const handlers = makeHandlers();
    routeRelayAction(
      { action: 'recoveryrequest', payload: JSON.stringify({ pkEph: 'aa' }) },
      handlers,
    );
    expect(handlers.onRecoveryRequest).not.toHaveBeenCalled();
    expect(handlers.onInvalidPayload).toHaveBeenCalledTimes(1);
  });

  it('hands chainsyncrequest its raw payload for versioned parsing', () => {
    const handlers = makeHandlers();
    routeRelayAction(
      { action: 'chainsyncrequest', payload: 'v1:btc,eth' },
      handlers,
    );
    expect(handlers.onChainSyncRequest).toHaveBeenCalledWith('v1:btc,eth');
  });

  it('handles every Key-directed relay action', () => {
    KEY_RELAY_ACTIONS.forEach((action) => {
      const handlers = makeHandlers();
      // payload deliberately unusable — an action is "handled" as soon as it
      // is recognised, even when its payload turns out to be invalid
      expect(routeRelayAction({ action, payload: 'x' }, handlers)).toBe(true);
    });
  });

  it('returns false for anything else so the caller can log it', () => {
    const handlers = makeHandlers();
    expect(routeRelayAction({}, handlers)).toBe(false);
    expect(routeRelayAction({ action: 'txid' }, handlers)).toBe(false);
    expect(routeRelayAction({ action: 'somethingnew' }, handlers)).toBe(false);
    Object.values(handlers).forEach((handler) => {
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('relay action parity between transports', () => {
  it('handles exactly the actions SocketContext listens for', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/contexts/SocketContext.tsx'),
      'utf8',
    );
    const listened = new Set<string>();
    const listener = /newSocket\.on\(\s*'([^']+)'/g;
    let match = listener.exec(source);
    while (match) {
      listened.add(match[1]);
      match = listener.exec(source);
    }
    // socket.io lifecycle events, not relay actions
    ['connect', 'connect_error', 'disconnect'].forEach((event) =>
      listened.delete(event),
    );

    expect(listened.size).toBeGreaterThan(0);
    expect([...listened].sort()).toEqual([...KEY_RELAY_ACTIONS].sort());
  });
});
