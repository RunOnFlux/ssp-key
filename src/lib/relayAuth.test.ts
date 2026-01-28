// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite

// Mock blockchains for this test
jest.mock('@storage/blockchains', () => ({
  blockchains: {
    btc: {
      id: 'btc',
      libid: 'bitcoin',
      messagePrefix: '\x18Bitcoin Signed Message:\n',
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
    },
    flux: {
      id: 'flux',
      libid: 'flux',
      messagePrefix: '\x18Zelcash Signed Message:\n',
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
    },
  },
}));

// Mock wallet functions
jest.mock('./wallet', () => ({
  wifToPrivateKey: jest.fn((wif: string) => 'a'.repeat(64)),
  generateAddressKeypair: jest.fn(() => ({
    privKey: 'L1TnU2zbNaAqMoVh65Cyvmcjzbrj41Gs9iTLcWbpJCMynXuap6UN',
    pubKey:
      '0278d4aa2a1c643fc68a0de5454e47c520cf59643526474e63b320144de9e0d59a',
  })),
}));

import {
  computeBodyHash,
  generateNonce,
  createSignaturePayload,
  signMessage,
  createMultisigAuth,
  addAuthToRequest,
} from './relayAuth';

describe('RelayAuth Lib', () => {
  describe('computeBodyHash', () => {
    it('should compute SHA256 hash of request body', () => {
      const body = { action: 'test', data: 'hello' };
      const hash = computeBodyHash(body);

      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });

    it('should produce consistent hash for same input', () => {
      const body = { foo: 'bar', num: 123 };
      const hash1 = computeBodyHash(body);
      const hash2 = computeBodyHash(body);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different input', () => {
      const body1 = { action: 'test1' };
      const body2 = { action: 'test2' };

      const hash1 = computeBodyHash(body1);
      const hash2 = computeBodyHash(body2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty object', () => {
      const hash = computeBodyHash({});
      expect(hash).toHaveLength(64);
    });
  });

  describe('generateNonce', () => {
    it('should generate a 64 character hex string', () => {
      const nonce = generateNonce();

      expect(nonce).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(nonce)).toBe(true);
    });

    it('should generate unique nonces', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('createSignaturePayload', () => {
    it('should create payload with all required fields', () => {
      const payload = createSignaturePayload('action', 'test-identity');

      expect(payload.action).toBe('action');
      expect(payload.identity).toBe('test-identity');
      expect(payload.timestamp).toBeDefined();
      expect(typeof payload.timestamp).toBe('number');
      expect(payload.nonce).toHaveLength(64);
    });

    it('should include data hash when provided', () => {
      const payload = createSignaturePayload(
        'sync',
        'my-identity',
        'abc123hash',
      );

      expect(payload.data).toBe('abc123hash');
    });

    it('should not include data when not provided', () => {
      const payload = createSignaturePayload('join', 'my-identity');

      expect(payload.data).toBeUndefined();
    });

    it('should support all action types', () => {
      const actions = ['sync', 'action', 'token', 'join'] as const;

      for (const action of actions) {
        const payload = createSignaturePayload(action, 'identity');
        expect(payload.action).toBe(action);
      }
    });
  });

  describe('signMessage', () => {
    it('should return a signature string', () => {
      const message = 'test message';
      const privateKeyWIF =
        'L1TnU2zbNaAqMoVh65Cyvmcjzbrj41Gs9iTLcWbpJCMynXuap6UN';

      const signature = signMessage(message, privateKeyWIF, 'btc');

      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });
  });

  describe('createMultisigAuth', () => {
    it('should create auth fields with all required properties', () => {
      const result = createMultisigAuth(
        'action',
        'bc1qtest',
        'xprv...',
        'witnessScriptHex',
        '02pubkey',
        'btc',
      );

      expect(result.signature).toBeDefined();
      expect(result.message).toBeDefined();
      expect(result.publicKey).toBe('02pubkey');
      expect(result.witnessScript).toBe('witnessScriptHex');
    });

    it('should include data hash in message when provided', () => {
      const result = createMultisigAuth(
        'sync',
        'bc1qtest',
        'xprv...',
        'witnessScript',
        'pubkey',
        'btc',
        'datahash123',
      );

      const parsedMessage = JSON.parse(result.message);
      expect(parsedMessage.data).toBe('datahash123');
    });

    it('should not include data in message when not provided', () => {
      const result = createMultisigAuth(
        'join',
        'bc1qtest',
        'xprv...',
        'witnessScript',
        'pubkey',
        'btc',
      );

      const parsedMessage = JSON.parse(result.message);
      expect(parsedMessage.data).toBeUndefined();
    });
  });

  describe('addAuthToRequest', () => {
    it('should merge auth fields into request body', () => {
      const body = { action: 'test', data: 'payload' };
      const authFields = {
        signature: 'test-signature',
        message: 'test-message',
        publicKey: 'test-pubkey',
        witnessScript: 'test-witness',
      };

      const result = addAuthToRequest(body, authFields);

      expect(result.action).toBe('test');
      expect(result.data).toBe('payload');
      expect(result.signature).toBe('test-signature');
      expect(result.message).toBe('test-message');
      expect(result.publicKey).toBe('test-pubkey');
      expect(result.witnessScript).toBe('test-witness');
    });

    it('should preserve original body fields', () => {
      const body = { foo: 'bar', nested: { a: 1 } };
      const authFields = {
        signature: 'sig',
        message: 'msg',
        publicKey: 'pk',
      };

      const result = addAuthToRequest(body, authFields);

      expect(result.foo).toBe('bar');
      expect(result.nested).toEqual({ a: 1 });
    });
  });
});
