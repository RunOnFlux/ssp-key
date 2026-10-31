/**
 * WK message grammar + paired-wallet signature check (H-7 / KEY-1).
 *
 * The identity key at /10/0 authenticates enterprise logins, SSP critical
 * actions, vault-xpub / recovery / chain-sync attestations and relay auth. The
 * Key used to sign ANY string a wksigningrequest carried and present it as
 * "authentication". These tests pin the classification both devices share
 * (contract section "WK") and the walletSignature check that keeps a relay —
 * or anything without the paired wallet's identity key — from feeding the Key
 * a message at all.
 */
// Node's own crypto, not the react-native-quick-crypto alias babel maps
// `crypto` to (mocked in jest.setup.js).
import { createHash } from 'node:crypto';
import { SigningKey } from 'ethers';

import {
  bitcoinMessageDigest,
  checkWkSigningRequest,
  classifyWkMessage,
  criticalActionCopy,
  describeCriticalScope,
  isBareOrigin,
  verifyBitcoinMessageSignature,
  WK_MESSAGE_MAX_LENGTH,
  WK_MESSAGE_MIN_LENGTH,
} from '../../src/lib/wkMessage';

// jest.setup.js mocks flux-sdk's signMessage globally; the real one is the
// signer SSP Wallet and SSP Key actually use, so the vectors come from it.
const { fluxnode } = jest.requireActual<{
  fluxnode: {
    signMessage: (
      message: string,
      privKeyHex: string,
      compressed: boolean,
      prefix: string,
    ) => string;
  };
}>('@runonflux/flux-sdk');

const BTC_PREFIX = '\x18Bitcoin Signed Message:\n';
const TS = '1760000000000';
const NONCE32 = '0123456789abcdef0123456789abcdef';
const ORIGIN = 'https://enterprise.sspwallet.com';
const WK = 'bc1qwkidentityexample0000000000000000000000000000000000000000';
const TARGET_WK = 'bc1qtargetidentity00000000000000000000000000000000000000000';

const WALLET_PRIV = '11'.repeat(32);
const ATTACKER_PRIV = '22'.repeat(32);
const pubOf = (priv: string) =>
  new SigningKey(`0x${priv}`).compressedPublicKey.slice(2);
const WALLET_PUB = pubOf(WALLET_PRIV);
const ATTACKER_PUB = pubOf(ATTACKER_PRIV);

const sign = (message: string, priv: string, prefix = BTC_PREFIX) =>
  fluxnode.signMessage(message, priv, true, prefix);

const login = (origin = ORIGIN, nonce = NONCE32, ts = TS) =>
  `${ts}:SSP_ENTERPRISE_LOGIN:${nonce}:${origin}`;
const critical = (
  action = 'transfer_ownership',
  org = '6650f0c2e4b0a1b2c3d4e5f6',
  target = TARGET_WK,
  nonce = NONCE32,
) => `${TS}:SSP_CRITICAL:${action}:${org}:${target}:${nonce}`;

describe('classifyWkMessage — enterprise login (EL-1)', () => {
  it('parses the v2 login challenge', () => {
    expect(classifyWkMessage(login())).toEqual({
      kind: 'enterprise_login',
      fields: { timestamp: Number(TS), nonce: NONCE32, origin: ORIGIN },
    });
  });

  it('accepts a localhost dev origin with a port', () => {
    const result = classifyWkMessage(login('http://localhost:5173'));
    expect(result.kind).toBe('enterprise_login');
  });

  it.each([
    ['uppercase nonce', login(ORIGIN, NONCE32.toUpperCase())],
    ['short nonce', login(ORIGIN, NONCE32.slice(1))],
    ['long nonce', login(ORIGIN, `${NONCE32}a`)],
    ['non-hex nonce', login(ORIGIN, `${NONCE32.slice(1)}g`)],
    ['origin with a path', login(`${ORIGIN}/login`)],
    ['origin with a trailing slash', login(`${ORIGIN}/`)],
    ['origin with userinfo', login(`${ORIGIN}@evil.example`)],
    ['spoofing path', login('https://evil.example/enterprise.sspwallet.com')],
    ['uppercase host', login('https://Enterprise.SSPWallet.com')],
    ['non-http scheme', login('ftp://enterprise.sspwallet.com')],
    ['port out of range', login('https://enterprise.sspwallet.com:65536')],
    ['12-digit timestamp', login(ORIGIN, NONCE32, TS.slice(1))],
    ['query string', login(`${ORIGIN}?a=b`)],
  ])('refuses a login-tagged message with %s', (_label, message) => {
    expect(classifyWkMessage(message)).toEqual({
      kind: 'invalid',
      reason: expect.any(String),
    });
  });

  it('refuses trailing whitespace instead of trimming it', () => {
    expect(classifyWkMessage(`${login()} `).kind).toBe('invalid');
  });
});

describe('classifyWkMessage — SSP critical actions (EL-4)', () => {
  it('parses the v2 critical challenge with its origin', () => {
    expect(classifyWkMessage(`${critical()}:${ORIGIN}`)).toEqual({
      kind: 'critical',
      fields: {
        timestamp: Number(TS),
        action: 'transfer_ownership',
        targetOrgId: '6650f0c2e4b0a1b2c3d4e5f6',
        targetWkIdentity: TARGET_WK,
        nonce: NONCE32,
        origin: ORIGIN,
      },
    });
  });

  it('parses the legacy v1 critical challenge (no origin)', () => {
    expect(classifyWkMessage(critical())).toEqual({
      kind: 'critical_legacy',
      fields: {
        timestamp: Number(TS),
        action: 'transfer_ownership',
        targetOrgId: '6650f0c2e4b0a1b2c3d4e5f6',
        targetWkIdentity: TARGET_WK,
        nonce: NONCE32,
      },
    });
  });

  it.each(['delete_organization', 'remove_member', 'change_enterprise_email'])(
    'parses %s',
    (action) => {
      const result = classifyWkMessage(critical(action));
      expect(result.kind).toBe('critical_legacy');
      if (result.kind === 'critical_legacy') {
        expect(result.fields.action).toBe(action);
      }
    },
  );

  it('allows empty org / target fields (grammar uses [^:]*)', () => {
    const message = `${TS}:SSP_CRITICAL:delete_organization:org1::${NONCE32}`;
    expect(classifyWkMessage(message).kind).toBe('critical_legacy');
  });

  it.each([
    ['uppercase action', critical('TRANSFER_OWNERSHIP')],
    ['digits in action', critical('transfer2')],
    ['extra field', `${critical()}:extra`],
    ['non-hex nonce', critical('remove_member', 'org', TARGET_WK, 'xyz123')],
    ['origin with a path', `${critical()}:${ORIGIN}/x`],
    ['missing nonce', `${TS}:SSP_CRITICAL:remove_member:org:${TARGET_WK}:`],
  ])('refuses a critical-tagged message with %s', (_label, message) => {
    expect(classifyWkMessage(message)).toEqual({
      kind: 'invalid',
      reason: 'reserved_tag',
    });
  });

  it('refuses the SSP_CRITICAL attack payload framed without a timestamp', () => {
    expect(
      classifyWkMessage(
        `SSP_CRITICAL:transfer_ownership:org:${TARGET_WK}:${NONCE32}`,
      ).kind,
    ).toBe('invalid');
  });
});

describe('classifyWkMessage — reserved formats and garbage are invalid', () => {
  const XPUB =
    'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz';

  it.each([
    // the KEY-1 scenario: vault-xpub attestation smuggled through WK signing
    ['vault xpub attestation', `SSP_VAULT_XPUB:key:${XPUB}:eth:150`],
    [
      'vault xpub attestation behind a timestamp',
      `${TS}SSP_VAULT_XPUB:key:${XPUB}:eth:150`,
    ],
    [
      'chain sync attestation',
      `SSP_CHAIN_SYNC:eth:${XPUB}:${XPUB}`.slice(0, 400),
    ],
    ['chain sync tag behind a timestamp', `${TS}${NONCE32}SSP_CHAIN_SYNC:eth`],
    ['recovery tag behind a timestamp', `${TS}${NONCE32}SSP_RECOVERY`],
    ['login tag inside generic text', `${TS}${NONCE32} SSP_ENTERPRISE_LOGIN`],
  ])('%s', (_label, message) => {
    expect(classifyWkMessage(message)).toEqual({
      kind: 'invalid',
      reason: expect.stringMatching(/reserved_tag|no_timestamp/),
    });
  });

  it('refuses relay auth JSON', () => {
    const json = JSON.stringify({
      timestamp: Number(TS),
      action: 'action',
      identity: WK,
      nonce: NONCE32 + NONCE32,
    });
    expect(classifyWkMessage(json)).toEqual({
      kind: 'invalid',
      reason: 'json',
    });
  });

  it('refuses the recovery-xpub attestation (newline separated)', () => {
    expect(
      classifyWkMessage(`ssp-recovery-xpub\n${WK}\n${XPUB}`.slice(0, 300)),
    ).toEqual({ kind: 'invalid', reason: 'control_chars' });
  });

  it.each([
    ['newline', `${TS}${NONCE32}\nhidden`],
    ['NUL', `${TS}${NONCE32}\u0000`],
    ['DEL', `${TS}${NONCE32}\u007f`],
    ['C1 control', `${TS}${NONCE32}\u0085`],
    ['RTL override', `${TS}${NONCE32}\u202e`],
    ['bidi isolate', `${TS}${NONCE32}\u2066x`],
    ['line separator', `${TS}${NONCE32}\u2028`],
  ])('refuses a message with a %s', (_label, message) => {
    expect(classifyWkMessage(message)).toEqual({
      kind: 'invalid',
      reason: 'control_chars',
    });
  });

  it.each([
    ['not a string', 12345],
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_label, message) => {
    expect(classifyWkMessage(message)).toEqual({
      kind: 'invalid',
      reason: 'not_string',
    });
  });

  it('enforces the 45–500 length window', () => {
    expect(classifyWkMessage(`${TS}${'a'.repeat(31)}`)).toEqual({
      kind: 'invalid',
      reason: 'length',
    });
    expect(
      classifyWkMessage(`${TS}${'a'.repeat(WK_MESSAGE_MAX_LENGTH - 12)}`),
    ).toEqual({ kind: 'invalid', reason: 'length' });
    expect(
      classifyWkMessage(`${TS}${'a'.repeat(WK_MESSAGE_MIN_LENGTH - 13)}`).kind,
    ).toBe('generic');
    expect(
      classifyWkMessage(`${TS}${'a'.repeat(WK_MESSAGE_MAX_LENGTH - 13)}`).kind,
    ).toBe('generic');
  });

  it('refuses a message without the 13-digit timestamp prefix', () => {
    expect(classifyWkMessage(`hello world ${NONCE32}${NONCE32}`)).toEqual({
      kind: 'invalid',
      reason: 'no_timestamp',
    });
    expect(classifyWkMessage(`${TS.slice(1)}x${NONCE32}${NONCE32}`)).toEqual({
      kind: 'invalid',
      reason: 'no_timestamp',
    });
  });
});

describe('classifyWkMessage — generic third-party sign-in', () => {
  it('keeps the documented "Login with SSP" format working', () => {
    // SSP_Identity_Authentication_Guide: Date.now() + randomBytes(16).hex
    expect(classifyWkMessage(`${TS}${NONCE32}`)).toEqual({
      kind: 'generic',
      fields: { timestamp: Number(TS) },
    });
  });

  it('accepts free text after the timestamp', () => {
    expect(
      classifyWkMessage(`${TS} Sign in to example.com, nonce ${NONCE32}`).kind,
    ).toBe('generic');
  });
});

describe('isBareOrigin', () => {
  it.each([
    'https://enterprise.sspwallet.com',
    'http://localhost:5173',
    'https://a.b-c.example:443',
    'https://xn--bcher-kva.example',
  ])('accepts %s', (origin) => {
    expect(isBareOrigin(origin)).toBe(true);
  });

  it.each([
    'https://enterprise.sspwallet.com/',
    'https://-bad.example',
    'https://bad-.example',
    'https://user@host.example',
    'https://host.example:99999',
    'https://[::1]',
    'javascript:alert(1)',
  ])('refuses %s', (origin) => {
    expect(isBareOrigin(origin)).toBe(false);
  });
});

describe('bitcoinMessageDigest', () => {
  it('matches sha256d(prefix || varint(len) || message)', () => {
    const message = login();
    const buf = Buffer.concat([
      Buffer.from(BTC_PREFIX, 'utf8'),
      Buffer.from([Buffer.byteLength(message)]),
      Buffer.from(message, 'utf8'),
    ]);
    const expected = createHash('sha256')
      .update(createHash('sha256').update(buf).digest())
      .digest('hex');
    expect(
      Buffer.from(bitcoinMessageDigest(message, BTC_PREFIX)).toString('hex'),
    ).toBe(expected);
  });

  it('uses the 0xfd varint for messages longer than 252 bytes', () => {
    const message = `${TS}${'a'.repeat(300)}`;
    const buf = Buffer.concat([
      Buffer.from(BTC_PREFIX, 'utf8'),
      Buffer.from([0xfd, message.length & 0xff, message.length >> 8]),
      Buffer.from(message, 'utf8'),
    ]);
    const expected = createHash('sha256')
      .update(createHash('sha256').update(buf).digest())
      .digest('hex');
    expect(
      Buffer.from(bitcoinMessageDigest(message, BTC_PREFIX)).toString('hex'),
    ).toBe(expected);
  });
});

describe('verifyBitcoinMessageSignature', () => {
  const message = login();

  it('verifies a real signature from the signer the apps use', () => {
    expect(
      verifyBitcoinMessageSignature(
        message,
        sign(message, WALLET_PRIV),
        WALLET_PUB,
        BTC_PREFIX,
      ),
    ).toBe(true);
  });

  it('verifies long messages too', () => {
    const long = `${TS}${'b'.repeat(400)}`;
    expect(
      verifyBitcoinMessageSignature(
        long,
        sign(long, WALLET_PRIV),
        WALLET_PUB,
        BTC_PREFIX,
      ),
    ).toBe(true);
  });

  it('rejects a signature by another key', () => {
    expect(
      verifyBitcoinMessageSignature(
        message,
        sign(message, ATTACKER_PRIV),
        WALLET_PUB,
        BTC_PREFIX,
      ),
    ).toBe(false);
  });

  it('rejects a signature over a different message', () => {
    const signature = sign(message, WALLET_PRIV);
    expect(
      verifyBitcoinMessageSignature(
        `${message.slice(0, -1)}x`,
        signature,
        WALLET_PUB,
        BTC_PREFIX,
      ),
    ).toBe(false);
  });

  it('rejects a signature made with another chain prefix', () => {
    const signature = sign(
      message,
      WALLET_PRIV,
      '\x18Zelcash Signed Message:\n',
    );
    expect(
      verifyBitcoinMessageSignature(message, signature, WALLET_PUB, BTC_PREFIX),
    ).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['not base64', '!!!not-base64!!!'],
    ['wrong length', Buffer.alloc(64, 1).toString('base64')],
    [
      'uncompressed header',
      (() => {
        const raw = Buffer.from(sign(message, WALLET_PRIV), 'base64');
        raw[0] -= 4;
        return raw.toString('base64');
      })(),
    ],
    [
      'header out of range',
      (() => {
        const raw = Buffer.from(sign(message, WALLET_PRIV), 'base64');
        raw[0] = 99;
        return raw.toString('base64');
      })(),
    ],
  ])('rejects a malformed signature (%s)', (_label, signature) => {
    expect(
      verifyBitcoinMessageSignature(message, signature, WALLET_PUB, BTC_PREFIX),
    ).toBe(false);
  });

  it('rejects a malformed expected public key', () => {
    const signature = sign(message, WALLET_PRIV);
    expect(
      verifyBitcoinMessageSignature(message, signature, 'abcd', BTC_PREFIX),
    ).toBe(false);
  });
});

describe('checkWkSigningRequest', () => {
  const message = login();
  const request = (overrides: Record<string, unknown> = {}) => ({
    message,
    walletSignature: sign(message, WALLET_PRIV),
    walletPubKey: WALLET_PUB,
    wkIdentity: WK,
    ...overrides,
  });
  const check = (req: Record<string, unknown> | null) =>
    checkWkSigningRequest({
      request: req,
      ownWkIdentity: WK,
      pairedWalletIdentityPubKey: WALLET_PUB,
      messagePrefix: BTC_PREFIX,
    });

  it('accepts a request signed by the paired wallet', () => {
    const result = check(request());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.classification.kind).toBe('enterprise_login');
    }
  });

  it('accepts an older payload without walletPubKey when the signature verifies', () => {
    const result = check(request({ walletPubKey: undefined }));
    expect(result.ok).toBe(true);
  });

  it('refuses an invalid message even when the wallet signed it', () => {
    const vault = `SSP_VAULT_XPUB:key:${'x'.repeat(100)}:eth:150`;
    expect(
      check(
        request({ message: vault, walletSignature: sign(vault, WALLET_PRIV) }),
      ),
    ).toEqual({ ok: false, reason: 'invalid_message' });
  });

  it('refuses a request for another wkIdentity', () => {
    expect(check(request({ wkIdentity: TARGET_WK }))).toEqual({
      ok: false,
      reason: 'wrong_identity',
    });
  });

  it('refuses a relay-injected request carrying its own key pair', () => {
    expect(
      check(
        request({
          walletPubKey: ATTACKER_PUB,
          walletSignature: sign(message, ATTACKER_PRIV),
        }),
      ),
    ).toEqual({ ok: false, reason: 'wallet_key_mismatch' });
  });

  it('refuses a forged signature when the claimed key is the paired one', () => {
    expect(
      check(request({ walletSignature: sign(message, ATTACKER_PRIV) })),
    ).toEqual({
      ok: false,
      reason: 'bad_wallet_signature',
    });
  });

  it('refuses a signature over a different message', () => {
    const other = login(ORIGIN, 'f'.repeat(32));
    expect(
      check(request({ walletSignature: sign(other, WALLET_PRIV) })),
    ).toEqual({
      ok: false,
      reason: 'bad_wallet_signature',
    });
  });

  it.each([
    ['null request', null],
    ['missing signature', { message, wkIdentity: WK }],
    [
      'non-string message',
      { message: 1, walletSignature: 'x', wkIdentity: WK },
    ],
  ])('refuses a malformed request (%s)', (_label, req) => {
    expect(check(req as Record<string, unknown> | null)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('refuses when the paired wallet key is unknown', () => {
    expect(
      checkWkSigningRequest({
        request: request(),
        ownWkIdentity: WK,
        pairedWalletIdentityPubKey: '',
        messagePrefix: BTC_PREFIX,
      }),
    ).toEqual({ ok: false, reason: 'wallet_key_mismatch' });
  });
});

describe('critical challenge field layout (ssp-relay-enterprise v2)', () => {
  const NONCE24 = 'a1b2c3d4e5f6a7b8c9d0e1f2';
  const v2 = (action: string, f1: string, f2: string) =>
    `${TS}:SSP_CRITICAL:${action}:${f1}:${f2}:${NONCE24}:${ORIGIN}`;

  it('parses an org action with no target', () => {
    const result = classifyWkMessage(
      v2('delete_organization', 'org-1', 'none'),
    );
    expect(result.kind).toBe('critical');
    if (result.kind === 'critical') {
      expect(
        describeCriticalScope(
          result.fields.targetOrgId,
          result.fields.targetWkIdentity,
        ),
      ).toEqual({ kind: 'org', orgId: 'org-1', vaultId: '', target: null });
    }
  });

  it('splits a vault-scoped action into org and vault', () => {
    const result = classifyWkMessage(
      v2('freeze_vault', 'org-1/vault-9', TARGET_WK),
    );
    expect(result.kind).toBe('critical');
    if (result.kind === 'critical') {
      expect(
        describeCriticalScope(
          result.fields.targetOrgId,
          result.fields.targetWkIdentity,
        ),
      ).toEqual({
        kind: 'vault',
        orgId: 'org-1',
        vaultId: 'vault-9',
        target: TARGET_WK,
      });
    }
  });

  it('reads the new email of an email action', () => {
    const result = classifyWkMessage(
      v2('change_enterprise_email', 'user', 'alice@example.com'),
    );
    expect(result.kind).toBe('critical');
    if (result.kind === 'critical') {
      expect(
        describeCriticalScope(
          result.fields.targetOrgId,
          result.fields.targetWkIdentity,
        ),
      ).toEqual({
        kind: 'user',
        orgId: '',
        vaultId: '',
        target: 'alice@example.com',
      });
    }
    expect(describeCriticalScope('user', 'none').target).toBeNull();
  });

  it('knows every action the server issues and nothing from the prototype', () => {
    for (const action of [
      'transfer_ownership',
      'delete_organization',
      'remove_member',
      'promote_to_admin',
      'demote_from_admin',
      'change_enterprise_email',
      'remove_enterprise_email',
      'archive_vault',
      'unarchive_vault',
      'freeze_vault',
      'unfreeze_vault',
      'promote_vault_admin',
      'demote_vault_admin',
    ]) {
      expect(criticalActionCopy(action)?.label).toBe(
        `home:wk_critical_action_${action}`,
      );
    }
    expect(criticalActionCopy('constructor')).toBeUndefined();
    expect(criticalActionCopy('__proto__')).toBeUndefined();
  });
});
