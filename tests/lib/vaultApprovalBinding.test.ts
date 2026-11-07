/**
 * CHN-5 (request swap): the relay could push a new enterprise request while
 * the biometric prompt was open, and the approval given for the request on
 * screen signed the new one. Approval is now bound to the digest of the
 * exact request that was displayed, and the sign action refuses any other.
 */
import {
  armVaultApproval,
  bindDecodedToRequest,
  canonicalJson,
  consumeVaultApproval,
  disarmVaultApproval,
  requestDigestOfDecoded,
  vaultRequestDigest,
} from '../../src/lib/vaultApprovalBinding';

const request = (overrides: Record<string, unknown> = {}) => ({
  chain: 'solMainnet',
  orgIndex: 100,
  vaultIndex: 0,
  rawUnsignedTx: 'AQID',
  recipients: [{ address: 'A', amount: '1' }],
  inputDetails: [{ addressIndex: 0 }],
  requestId: 'r1',
  ...overrides,
});

describe('vaultRequestDigest', () => {
  it('is independent of key order and of undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
    expect(vaultRequestDigest({ a: 1, b: undefined })).toBe(
      vaultRequestDigest({ a: 1 }),
    );
    expect(vaultRequestDigest(request())).toBe(
      vaultRequestDigest({ ...request() }),
    );
  });

  it('changes when anything security-relevant changes', () => {
    const base = vaultRequestDigest(request());
    expect(vaultRequestDigest(request({ rawUnsignedTx: 'AQIE' }))).not.toBe(
      base,
    );
    expect(vaultRequestDigest(request({ orgIndex: 101 }))).not.toBe(base);
    expect(
      vaultRequestDigest(request({ inputDetails: [{ addressIndex: 1 }] })),
    ).not.toBe(base);
    expect(
      vaultRequestDigest(
        request({ recipients: [{ address: 'B', amount: '1' }] }),
      ),
    ).not.toBe(base);
    expect(vaultRequestDigest(request())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('approval arming', () => {
  afterEach(() => disarmVaultApproval());

  it('the sign action accepts only the request armed on screen, once', () => {
    const shown = vaultRequestDigest(request());
    armVaultApproval(shown);
    expect(consumeVaultApproval(shown)).toBe(true);
    // single-use
    expect(consumeVaultApproval(shown)).toBe(false);
  });

  it('refuses a request swapped in while authentication was open', () => {
    const shown = vaultRequestDigest(request());
    const swapped = vaultRequestDigest(request({ rawUnsignedTx: 'BBBB' }));
    armVaultApproval(shown);
    expect(consumeVaultApproval(swapped)).toBe(false);
    // the mismatch also disarms: a retry with the shown request needs a new
    // approval
    expect(consumeVaultApproval(shown)).toBe(false);
  });

  it('refuses when nothing was armed or it was disarmed', () => {
    const shown = vaultRequestDigest(request());
    expect(consumeVaultApproval(shown)).toBe(false);
    armVaultApproval(shown);
    disarmVaultApproval();
    expect(consumeVaultApproval(shown)).toBe(false);
  });
});

describe('decoded view binding', () => {
  it('maps a decoded view to the request it was decoded from', () => {
    const decoded = { sender: '', recipients: [], fee: '0' };
    expect(requestDigestOfDecoded(decoded)).toBeUndefined();
    expect(requestDigestOfDecoded(null)).toBeUndefined();
    const digest = vaultRequestDigest(request());
    expect(bindDecodedToRequest(decoded, digest)).toBe(decoded);
    expect(requestDigestOfDecoded(decoded)).toBe(digest);
    // a copy is a different view and is not bound
    expect(requestDigestOfDecoded({ ...decoded })).toBeUndefined();
  });
});
