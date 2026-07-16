import {
  parseChainSyncRequest,
  buildChainSyncRejectionPayload,
  chainSyncSymbols,
  CHAIN_SYNC_REQUEST_VERSION,
  CHAIN_SYNC_MAX_CHAINS,
  CHAIN_SYNC_POST_SPACING_MS,
} from '../../src/lib/chainSyncRequest';
import type { cryptos } from '../../src/types';

const IDENTITY_CHAIN = 'btc' as keyof cryptos;

// standard BIP32 test vector xpub — format-valid for the regex check
const VALID_XPUB =
  'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';

// format-valid variants (regex check only — no checksum) for multi-chain tests,
// since each chain must carry a distinct extended key
const VALID_XPUB_2 = VALID_XPUB.slice(0, -1) + 'a';
const VALID_XPUB_3 = VALID_XPUB.slice(0, -1) + 'b';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';

function solPubkeyArray(): string {
  const keys: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    keys.push('A'.repeat(39) + BASE58[i]);
  }
  return JSON.stringify(keys);
}

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    chains: [{ chain: 'eth', xpubWallet: VALID_XPUB }],
    ...overrides,
  });
}

describe('parseChainSyncRequest', () => {
  it('accepts a valid single-chain version 1 request', () => {
    const result = parseChainSyncRequest(payload(), IDENTITY_CHAIN);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.request.version).toBe(1);
      expect(result.request.chains).toEqual([
        { chain: 'eth', xpubWallet: VALID_XPUB },
      ]);
    }
  });

  it('accepts multiple chains across chain types', () => {
    const result = parseChainSyncRequest(
      payload({
        chains: [
          { chain: 'eth', xpubWallet: VALID_XPUB },
          { chain: 'flux', xpubWallet: VALID_XPUB_2 },
          { chain: 'polygon', xpubWallet: VALID_XPUB_3 },
        ],
      }),
      IDENTITY_CHAIN,
    );
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.request.chains.map((c) => c.chain)).toEqual([
        'eth',
        'flux',
        'polygon',
      ]);
    }
  });

  it('accepts a Solana chain with a 20-entry pubkey array', () => {
    const result = parseChainSyncRequest(
      payload({
        chains: [{ chain: 'solDevnet', xpubWallet: solPubkeyArray() }],
      }),
      IDENTITY_CHAIN,
    );
    expect(result.status).toBe('ok');
  });

  it('rejects a Solana chain carrying a regular xpub', () => {
    const result = parseChainSyncRequest(
      payload({ chains: [{ chain: 'solDevnet', xpubWallet: VALID_XPUB }] }),
      IDENTITY_CHAIN,
    );
    expect(result).toEqual({ status: 'invalid', reason: 'bad_xpub' });
  });

  it('rejects a non-Solana chain carrying a pubkey array', () => {
    const result = parseChainSyncRequest(
      payload({ chains: [{ chain: 'eth', xpubWallet: solPubkeyArray() }] }),
      IDENTITY_CHAIN,
    );
    expect(result).toEqual({ status: 'invalid', reason: 'bad_xpub' });
  });

  it('returns unsupported_version for a newer protocol version', () => {
    const result = parseChainSyncRequest(
      payload({ version: CHAIN_SYNC_REQUEST_VERSION + 1 }),
      IDENTITY_CHAIN,
    );
    expect(result).toEqual({
      status: 'unsupported_version',
      version: CHAIN_SYNC_REQUEST_VERSION + 1,
    });
  });

  it.each([[0], [-1], [1.5], ['1'], [null], [undefined]])(
    'rejects malformed version %p',
    (version) => {
      const result = parseChainSyncRequest(
        payload({ version }),
        IDENTITY_CHAIN,
      );
      expect(result).toEqual({ status: 'invalid', reason: 'bad_version' });
    },
  );

  it('rejects non-JSON payloads', () => {
    expect(parseChainSyncRequest('not json', IDENTITY_CHAIN)).toEqual({
      status: 'invalid',
      reason: 'not_json',
    });
  });

  it('rejects non-object payloads', () => {
    expect(parseChainSyncRequest('[1,2]', IDENTITY_CHAIN)).toEqual({
      status: 'invalid',
      reason: 'not_object',
    });
    expect(parseChainSyncRequest('null', IDENTITY_CHAIN)).toEqual({
      status: 'invalid',
      reason: 'not_object',
    });
  });

  it('rejects an empty chain list', () => {
    const result = parseChainSyncRequest(
      payload({ chains: [] }),
      IDENTITY_CHAIN,
    );
    expect(result).toEqual({ status: 'invalid', reason: 'no_chains' });
  });

  it('rejects more than the maximum number of chains', () => {
    const chains = Array.from({ length: CHAIN_SYNC_MAX_CHAINS + 1 }, () => ({
      chain: 'eth',
      xpubWallet: VALID_XPUB,
    }));
    const result = parseChainSyncRequest(payload({ chains }), IDENTITY_CHAIN);
    expect(result).toEqual({ status: 'invalid', reason: 'too_many_chains' });
  });

  it('rejects unknown chains', () => {
    const result = parseChainSyncRequest(
      payload({ chains: [{ chain: 'dogechain', xpubWallet: VALID_XPUB }] }),
      IDENTITY_CHAIN,
    );
    expect(result).toEqual({ status: 'invalid', reason: 'unknown_chain' });
  });

  it('never allows the identity chain — identity pairing is QR-only', () => {
    const result = parseChainSyncRequest(
      payload({ chains: [{ chain: 'btc', xpubWallet: VALID_XPUB }] }),
      IDENTITY_CHAIN,
    );
    expect(result).toEqual({
      status: 'invalid',
      reason: 'identity_chain_not_allowed',
    });
  });

  it('rejects duplicate chains', () => {
    const result = parseChainSyncRequest(
      payload({
        chains: [
          { chain: 'eth', xpubWallet: VALID_XPUB },
          { chain: 'eth', xpubWallet: VALID_XPUB },
        ],
      }),
      IDENTITY_CHAIN,
    );
    expect(result).toEqual({ status: 'invalid', reason: 'duplicate_chain' });
  });

  it('rejects the same xpub reused across different chains', () => {
    const result = parseChainSyncRequest(
      payload({
        chains: [
          { chain: 'eth', xpubWallet: VALID_XPUB },
          { chain: 'polygon', xpubWallet: VALID_XPUB },
        ],
      }),
      IDENTITY_CHAIN,
    );
    expect(result).toEqual({ status: 'invalid', reason: 'duplicate_xpub' });
  });

  it('rejects missing/empty/oversized xpubs', () => {
    for (const xpubWallet of [undefined, '', 'x'.repeat(3001), 42]) {
      const result = parseChainSyncRequest(
        payload({ chains: [{ chain: 'eth', xpubWallet }] }),
        IDENTITY_CHAIN,
      );
      expect(result).toEqual({ status: 'invalid', reason: 'bad_xpub' });
    }
  });

  it('rejects malformed entries', () => {
    for (const entry of [null, 'eth', ['eth']]) {
      const result = parseChainSyncRequest(
        payload({ chains: [entry] }),
        IDENTITY_CHAIN,
      );
      expect(result).toEqual({ status: 'invalid', reason: 'bad_entry' });
    }
  });
});

describe('buildChainSyncRejectionPayload', () => {
  it('carries the protocol version and reason', () => {
    const parsed = JSON.parse(buildChainSyncRejectionPayload('declined'));
    expect(parsed).toEqual({
      version: CHAIN_SYNC_REQUEST_VERSION,
      reason: 'declined',
    });
  });
});

describe('chainSyncSymbols', () => {
  it('maps chains to their registry symbols', () => {
    expect(
      chainSyncSymbols(['eth', 'flux', 'polygon'] as (keyof cryptos)[]),
    ).toBe('ETH, FLUX, POL');
  });
});

describe('constants', () => {
  it('spaces per-chain sync posts wider than the wallet 1s poll', () => {
    expect(CHAIN_SYNC_POST_SPACING_MS).toBeGreaterThan(1000);
  });
});
