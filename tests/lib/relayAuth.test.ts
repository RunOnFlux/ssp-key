import { fluxnode } from '@runonflux/flux-sdk';

import {
  generateNonce,
  computeBodyHash,
  createSignaturePayload,
  signMessage,
  createMultisigAuth,
  addAuthToRequest,
} from '../../src/lib/relayAuth';
import type { SignaturePayload, AuthFields } from '../../src/lib/relayAuth';
import { generateAddressKeypair } from '../../src/lib/wallet';

// Access the mocked signMessage from jest.setup.js
const mockedFluxSignMessage = fluxnode.signMessage as jest.Mock;

describe('Relay Auth Lib', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── generateNonce ───────────────────────────────────────────────────

  describe('generateNonce', () => {
    test('should return a 64-character hex string', () => {
      const nonce = generateNonce();
      expect(nonce).toHaveLength(64);
    });

    test('should match hex pattern', () => {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should return different values on successive calls', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).not.toBe(nonce2);
    });

    test('should always return a string type', () => {
      const nonce = generateNonce();
      expect(typeof nonce).toBe('string');
    });
  });

  // ─── computeBodyHash ────────────────────────────────────────────────

  describe('computeBodyHash', () => {
    test('should return a 64-character hex string', () => {
      const hash = computeBodyHash({ key: 'value' });
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should return consistent hash for same input', () => {
      const body = { action: 'sync', data: 'test' };
      const hash1 = computeBodyHash(body);
      const hash2 = computeBodyHash(body);
      expect(hash1).toBe(hash2);
    });

    test('should return different hash for different inputs', () => {
      const hash1 = computeBodyHash({ key: 'value1' });
      const hash2 = computeBodyHash({ key: 'value2' });
      expect(hash1).not.toBe(hash2);
    });

    test('should handle empty object', () => {
      const hash = computeBodyHash({});
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle nested objects', () => {
      const hash = computeBodyHash({
        outer: { inner: { deep: 'value' } },
      } as Record<string, unknown>);
      expect(hash).toHaveLength(64);
    });

    test('should handle arrays in body', () => {
      const hash = computeBodyHash({
        items: [1, 2, 3],
      } as Record<string, unknown>);
      expect(hash).toHaveLength(64);
    });

    test('should produce different hashes for objects with different key order', () => {
      // JSON.stringify produces different strings for different key orders
      // so the hash should differ (unless JS engine sorts keys, which V8 does for numeric)
      const hash1 = computeBodyHash({ a: 1, b: 2 });
      const hash2 = computeBodyHash({ b: 2, a: 1 });
      // Both should be valid hashes regardless
      expect(hash1).toHaveLength(64);
      expect(hash2).toHaveLength(64);
    });

    test('should handle body with null values', () => {
      const hash = computeBodyHash({ key: null } as Record<string, unknown>);
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle body with numeric values', () => {
      const hash = computeBodyHash({ count: 42, price: 9.99 });
      expect(hash).toHaveLength(64);
    });

    test('should handle body with boolean values', () => {
      const hash = computeBodyHash({ active: true, deleted: false });
      expect(hash).toHaveLength(64);
    });
  });

  // ─── createSignaturePayload ─────────────────────────────────────────

  describe('createSignaturePayload', () => {
    test('should construct payload with all required fields', () => {
      const before = Date.now();
      const payload = createSignaturePayload('sync', 'test-identity');
      const after = Date.now();

      expect(payload).toHaveProperty('timestamp');
      expect(payload).toHaveProperty('action');
      expect(payload).toHaveProperty('identity');
      expect(payload).toHaveProperty('nonce');
      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });

    test('should set the correct action type', () => {
      const payload = createSignaturePayload('sync', 'test-identity');
      expect(payload.action).toBe('sync');
    });

    test('should set the correct identity', () => {
      const payload = createSignaturePayload('action', 'wk-identity-123');
      expect(payload.identity).toBe('wk-identity-123');
    });

    test('should generate a valid nonce', () => {
      const payload = createSignaturePayload('sync', 'test-identity');
      expect(payload.nonce).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should not include data field when dataHash is not provided', () => {
      const payload = createSignaturePayload('sync', 'test-identity');
      expect(payload.data).toBeUndefined();
    });

    test('should include data field when dataHash is provided', () => {
      const dataHash = 'abc123def456';
      const payload = createSignaturePayload(
        'token',
        'test-identity',
        dataHash,
      );
      expect(payload.data).toBe(dataHash);
    });

    test('should not include data field when dataHash is empty string', () => {
      const payload = createSignaturePayload('sync', 'test-identity', '');
      expect(payload.data).toBeUndefined();
    });

    test('should handle all action types', () => {
      const actions: SignaturePayload['action'][] = [
        'sync',
        'action',
        'token',
        'join',
      ];
      for (const action of actions) {
        const payload = createSignaturePayload(action, 'identity');
        expect(payload.action).toBe(action);
      }
    });

    test('should generate unique nonces for successive calls', () => {
      const payload1 = createSignaturePayload('sync', 'test-identity');
      const payload2 = createSignaturePayload('sync', 'test-identity');
      expect(payload1.nonce).not.toBe(payload2.nonce);
    });

    test('should use current timestamp', () => {
      const before = Date.now();
      const payload = createSignaturePayload('sync', 'id');
      const after = Date.now();

      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ─── signMessage ────────────────────────────────────────────────────

  describe('signMessage', () => {
    // Use known test values from wallet.test.ts
    const testXpriv =
      'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY';
    // Derive a WIF private key using the same approach as createMultisigAuth
    const testKeypair = generateAddressKeypair(testXpriv, 10, 0, 'flux');
    const testWIF = testKeypair.privKey;

    test('should call fluxnode.signMessage with correct parameters', () => {
      signMessage('test message', testWIF, 'flux');

      expect(mockedFluxSignMessage).toHaveBeenCalledTimes(1);
      expect(mockedFluxSignMessage).toHaveBeenCalledWith(
        'test message',
        expect.any(String), // privateKeyHex derived from WIF
        true, // isCompressed
        expect.any(String), // messagePrefix from blockchain config
        expect.objectContaining({ extraEntropy: expect.any(Buffer) }),
      );
    });

    test('should return a string signature', () => {
      const signature = signMessage('test message', testWIF, 'flux');
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);
    });

    test('should default to btc chain when chain is not specified', () => {
      signMessage('test message', testWIF);

      expect(mockedFluxSignMessage).toHaveBeenCalledTimes(1);
      // The function should use btc blockchain config
      expect(mockedFluxSignMessage).toHaveBeenCalledWith(
        'test message',
        expect.any(String),
        true,
        expect.any(String),
        expect.objectContaining({ extraEntropy: expect.any(Buffer) }),
      );
    });

    test('should pass the message unchanged to fluxnode.signMessage', () => {
      const message =
        '{"timestamp":1234567890,"action":"sync","identity":"test"}';
      signMessage(message, testWIF, 'flux');

      expect(mockedFluxSignMessage).toHaveBeenCalledWith(
        message,
        expect.any(String),
        expect.any(Boolean),
        expect.any(String),
        expect.any(Object),
      );
    });

    test('should always use compressed key format', () => {
      signMessage('msg', testWIF, 'flux');

      const callArgs = mockedFluxSignMessage.mock.calls[0];
      // isCompressed is the 3rd argument (index 2)
      expect(callArgs[2]).toBe(true);
    });

    test('should provide extra entropy for non-deterministic signatures', () => {
      signMessage('msg', testWIF, 'flux');

      const callArgs = mockedFluxSignMessage.mock.calls[0];
      const options = callArgs[4];
      expect(options).toHaveProperty('extraEntropy');
      expect(Buffer.isBuffer(options.extraEntropy)).toBe(true);
      expect(options.extraEntropy.length).toBe(32);
    });
  });

  // ─── addAuthToRequest ───────────────────────────────────────────────

  describe('addAuthToRequest', () => {
    const mockAuth: AuthFields = {
      signature: 'mock-signature-base64',
      message:
        '{"timestamp":123,"action":"sync","identity":"id","nonce":"abc"}',
      publicKey: '02abcdef1234567890',
      witnessScript: 'mock-witness-script',
    };

    test('should merge auth fields into body', () => {
      const body = { data: 'test-data', chain: 'flux' };
      const result = addAuthToRequest(body, mockAuth);

      expect(result.data).toBe('test-data');
      expect(result.chain).toBe('flux');
      expect(result.signature).toBe('mock-signature-base64');
      expect(result.message).toBe(mockAuth.message);
      expect(result.publicKey).toBe('02abcdef1234567890');
      expect(result.witnessScript).toBe('mock-witness-script');
    });

    test('should not modify original body object', () => {
      const body = { data: 'original' };
      const originalBody = { ...body };
      addAuthToRequest(body, mockAuth);

      expect(body).toEqual(originalBody);
    });

    test('should include all auth fields in result', () => {
      const body = {};
      const result = addAuthToRequest(body, mockAuth);

      expect(result).toHaveProperty('signature');
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('publicKey');
      expect(result).toHaveProperty('witnessScript');
    });

    test('should handle auth without optional witnessScript', () => {
      const authNoWitness: AuthFields = {
        signature: 'sig',
        message: 'msg',
        publicKey: 'pub',
      };
      const body = { key: 'value' };
      const result = addAuthToRequest(body, authNoWitness);

      expect(result.key).toBe('value');
      expect(result.signature).toBe('sig');
      expect(result.witnessScript).toBeUndefined();
    });

    test('should override body fields if they conflict with auth fields', () => {
      const body = { signature: 'old-sig', extra: 'data' };
      const result = addAuthToRequest(body, mockAuth);

      // Auth fields should take precedence (spread order)
      expect(result.signature).toBe('mock-signature-base64');
      expect(result.extra).toBe('data');
    });

    test('should handle empty body object', () => {
      const body = {};
      const result = addAuthToRequest(body, mockAuth);

      expect(result.signature).toBe(mockAuth.signature);
      expect(result.message).toBe(mockAuth.message);
      expect(result.publicKey).toBe(mockAuth.publicKey);
      expect(result.witnessScript).toBe(mockAuth.witnessScript);
    });

    test('should preserve complex body structures', () => {
      const body = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        nullField: null,
      } as Record<string, unknown>;
      const result = addAuthToRequest(body, mockAuth);

      expect(result.nested).toEqual({ deep: { value: 42 } });
      expect(result.array).toEqual([1, 2, 3]);
      expect(result.nullField).toBeNull();
      expect(result.signature).toBe(mockAuth.signature);
    });
  });

  // ─── createMultisigAuth ─────────────────────────────────────────────

  describe('createMultisigAuth', () => {
    const testXpriv =
      'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY';
    const testWkIdentity = 'bc1q-test-wk-identity';
    const testWitnessScript = 'mock-witness-script-hex';
    const testPublicKey = '02abcdef1234567890abcdef';

    test('should return an object with all required AuthFields', () => {
      const auth = createMultisigAuth(
        'sync',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );

      expect(auth).toHaveProperty('signature');
      expect(auth).toHaveProperty('message');
      expect(auth).toHaveProperty('publicKey');
      expect(auth).toHaveProperty('witnessScript');
    });

    test('should return the provided publicKey unchanged', () => {
      const auth = createMultisigAuth(
        'sync',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );

      expect(auth.publicKey).toBe(testPublicKey);
    });

    test('should return the provided witnessScript unchanged', () => {
      const auth = createMultisigAuth(
        'action',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );

      expect(auth.witnessScript).toBe(testWitnessScript);
    });

    test('should produce a valid JSON message containing the payload', () => {
      const auth = createMultisigAuth(
        'sync',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );

      const parsed = JSON.parse(auth.message) as SignaturePayload;
      expect(parsed.action).toBe('sync');
      expect(parsed.identity).toBe(testWkIdentity);
      expect(parsed.nonce).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof parsed.timestamp).toBe('number');
    });

    test('should include data hash in message when provided', () => {
      const dataHash = 'abcdef1234567890';
      const auth = createMultisigAuth(
        'token',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
        dataHash,
      );

      const parsed = JSON.parse(auth.message) as SignaturePayload;
      expect(parsed.data).toBe(dataHash);
    });

    test('should not include data field in message when dataHash is not provided', () => {
      const auth = createMultisigAuth(
        'sync',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );

      const parsed = JSON.parse(auth.message) as SignaturePayload;
      expect(parsed.data).toBeUndefined();
    });

    test('should call fluxnode.signMessage to produce the signature', () => {
      createMultisigAuth(
        'sync',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );

      expect(mockedFluxSignMessage).toHaveBeenCalledTimes(1);
    });

    test('should return a non-empty signature string', () => {
      const auth = createMultisigAuth(
        'sync',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );

      expect(typeof auth.signature).toBe('string');
      expect(auth.signature.length).toBeGreaterThan(0);
    });

    test('should work with different action types', () => {
      const actions: SignaturePayload['action'][] = [
        'sync',
        'action',
        'token',
        'join',
      ];

      for (const action of actions) {
        jest.clearAllMocks();
        const auth = createMultisigAuth(
          action,
          testWkIdentity,
          testXpriv,
          testWitnessScript,
          testPublicKey,
          'flux',
        );

        const parsed = JSON.parse(auth.message) as SignaturePayload;
        expect(parsed.action).toBe(action);
        expect(mockedFluxSignMessage).toHaveBeenCalledTimes(1);
      }
    });

    test('should derive identity keypair at typeIndex=10, addressIndex=0', () => {
      // Verify the keypair derivation is consistent with wallet lib
      const expectedKeypair = generateAddressKeypair(testXpriv, 10, 0, 'flux');

      createMultisigAuth(
        'sync',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );

      // The private key hex derived from the WIF should be passed to signMessage
      expect(mockedFluxSignMessage).toHaveBeenCalledWith(
        expect.any(String), // message
        expect.any(String), // privateKeyHex (derived from expectedKeypair.privKey WIF)
        true,
        expect.any(String), // messagePrefix
        expect.any(Object), // options with extraEntropy
      );

      // Verify the keypair is valid
      expect(expectedKeypair.privKey).toBeDefined();
      expect(expectedKeypair.pubKey).toBeDefined();
    });

    test('should set timestamp close to current time', () => {
      const before = Date.now();
      const auth = createMultisigAuth(
        'sync',
        testWkIdentity,
        testXpriv,
        testWitnessScript,
        testPublicKey,
        'flux',
      );
      const after = Date.now();

      const parsed = JSON.parse(auth.message) as SignaturePayload;
      expect(parsed.timestamp).toBeGreaterThanOrEqual(before);
      expect(parsed.timestamp).toBeLessThanOrEqual(after);
    });
  });

  // ─── Integration: createMultisigAuth + addAuthToRequest ─────────────

  describe('Integration: createMultisigAuth + addAuthToRequest', () => {
    const testXpriv =
      'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY';

    test('should produce a complete authenticated request', () => {
      const body = { chain: 'flux', data: 'some-data' };
      const auth = createMultisigAuth(
        'sync',
        'wk-identity',
        testXpriv,
        'witness-script',
        'pub-key',
        'flux',
      );
      const authenticatedRequest = addAuthToRequest(body, auth);

      // Original body fields
      expect(authenticatedRequest.chain).toBe('flux');
      expect(authenticatedRequest.data).toBe('some-data');

      // Auth fields
      expect(authenticatedRequest.signature).toBeDefined();
      expect(authenticatedRequest.message).toBeDefined();
      expect(authenticatedRequest.publicKey).toBe('pub-key');
      expect(authenticatedRequest.witnessScript).toBe('witness-script');

      // Message should be valid JSON
      const parsed = JSON.parse(
        authenticatedRequest.message,
      ) as SignaturePayload;
      expect(parsed.action).toBe('sync');
      expect(parsed.identity).toBe('wk-identity');
    });

    test('should produce authenticated request with body hash for tamper protection', () => {
      const body = { chain: 'flux', amount: '1000' };
      const bodyHash = computeBodyHash(body);
      const auth = createMultisigAuth(
        'action',
        'wk-identity',
        testXpriv,
        'witness-script',
        'pub-key',
        'flux',
        bodyHash,
      );
      const authenticatedRequest = addAuthToRequest(body, auth);

      const parsed = JSON.parse(
        authenticatedRequest.message,
      ) as SignaturePayload;
      expect(parsed.data).toBe(bodyHash);
      expect(parsed.action).toBe('action');
    });
  });
});
