/**
 * RA-4: authenticated GET polls.
 *
 * Released clients polled GET /v1/action/:wkIdentity unsigned, so anyone who
 * knew an identity could read its pending payloads (RLY-5). The Key now signs
 * every poll with the header scheme from the contract: a 'read' SignaturePayload
 * whose `data` is sha256("GET <path>") (path without query string), signed by
 * the identity key, plus the public key and the 2-of-2 witness script.
 */
import { createHash } from 'node:crypto';

import {
  createReadAuthHeaders,
  readAuthDataHash,
  READ_AUTH_HEADERS,
  relayRequestPath,
} from '../../src/lib/relayAuth';
import { verifyBitcoinMessageSignature } from '../../src/lib/wkMessage';

// The global jest.setup.js mock returns fake signatures; this suite checks a
// real one end to end.
jest.mock('@runonflux/flux-sdk', () =>
  jest.requireActual('@runonflux/flux-sdk'),
);

// tests/lib/wallet.test.ts vector: m/…/0/1 of the test xprv
const WIF = 'KxcvLgMARzhsH9ttJvxFC56aCNeYviVwN3GKXamhJb5PCPyYy6eU';
const PUB =
  '0313b0012725426394a61c44a0ec4be91be554d1625d97ee6565db61b30500f8da';
const WK = 'bc1qexamplewkidentity0000000000000000000000000000000000000000';
const WITNESS = `5221${'02'.padEnd(66, 'a')}21${'03'.padEnd(66, 'b')}52ae`;
const BTC_PREFIX = '\x18Bitcoin Signed Message:\n';

describe('relayRequestPath', () => {
  it.each([
    [`https://relay.sspwallet.com/v1/action/${WK}`, `/v1/action/${WK}`],
    [`https://relay.sspwallet.com/v1/action/${WK}?a=1`, `/v1/action/${WK}`],
    [`/v1/sync/${WK}#frag`, `/v1/sync/${WK}`],
    [`v1/nonces/status/${WK}`, `/v1/nonces/status/${WK}`],
  ])('%s -> %s', (input, expected) => {
    expect(relayRequestPath(input)).toBe(expected);
  });
});

describe('readAuthDataHash', () => {
  it('is sha256 hex of "GET <path>"', () => {
    const path = `/v1/action/${WK}`;
    expect(readAuthDataHash(path)).toBe(
      createHash('sha256').update(`GET ${path}`, 'utf8').digest('hex'),
    );
  });
});

describe('createReadAuthHeaders', () => {
  it('signs a read payload bound to the path, verifiable with the identity key', () => {
    const before = Date.now();
    const headers = createReadAuthHeaders({
      path: `https://relay.sspwallet.com/v1/action/${WK}?ignored=1`,
      identity: WK,
      identityPrivKeyWIF: WIF,
      publicKey: PUB,
      witnessScript: WITNESS,
      chain: 'btc',
    });
    expect(Object.keys(headers).sort()).toEqual(
      [
        READ_AUTH_HEADERS.signature,
        READ_AUTH_HEADERS.message,
        READ_AUTH_HEADERS.publicKey,
        READ_AUTH_HEADERS.witnessScript,
      ].sort(),
    );
    const message = headers[READ_AUTH_HEADERS.message];
    const payload = JSON.parse(message);
    expect(payload).toEqual({
      timestamp: expect.any(Number),
      action: 'read',
      identity: WK,
      nonce: expect.stringMatching(/^[0-9a-f]{64}$/),
      data: createHash('sha256')
        .update(`GET /v1/action/${WK}`, 'utf8')
        .digest('hex'),
    });
    expect(payload.timestamp).toBeGreaterThanOrEqual(before);
    expect(headers[READ_AUTH_HEADERS.publicKey]).toBe(PUB);
    expect(headers[READ_AUTH_HEADERS.witnessScript]).toBe(WITNESS);
    expect(
      verifyBitcoinMessageSignature(
        message,
        headers[READ_AUTH_HEADERS.signature],
        PUB,
        BTC_PREFIX,
      ),
    ).toBe(true);
  });

  it('omits the witness script header for single-sig identities', () => {
    const headers = createReadAuthHeaders({
      path: '/v1/sync/1walletidentity',
      identity: '1walletidentity',
      identityPrivKeyWIF: WIF,
      publicKey: PUB,
    });
    expect(headers[READ_AUTH_HEADERS.witnessScript]).toBeUndefined();
  });

  it('uses a fresh nonce for every poll', () => {
    const make = () =>
      JSON.parse(
        createReadAuthHeaders({
          path: `/v1/action/${WK}`,
          identity: WK,
          identityPrivKeyWIF: WIF,
          publicKey: PUB,
          witnessScript: WITNESS,
        })[READ_AUTH_HEADERS.message],
      ).nonce;
    expect(make()).not.toBe(make());
  });
});
