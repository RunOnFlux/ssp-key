// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite

jest.mock('@runonflux/aa-schnorr-multisig-sdk', () => {
  const mockSigBuffer = Buffer.alloc(32, 0xcd);
  const mockChallengeBuffer = Buffer.alloc(32, 0xef);
  const mockSig = { buffer: mockSigBuffer };
  const mockChallenge = { buffer: mockChallengeBuffer };
  const mockPubNonces = {
    kPublic: { buffer: Buffer.alloc(33, 0x11) },
    kTwoPublic: { buffer: Buffer.alloc(33, 0x22) },
  };
  const mockBuffer33 = Buffer.alloc(33, 0xab);
  const mockKey = { buffer: mockBuffer33 };

  const mockSigner = {
    restorePubNonces: jest.fn(),
    getPubKey: jest.fn(() => mockKey),
    getPubNonces: jest.fn(() => mockPubNonces),
    signMultiSigHash: jest.fn(() => ({
      signature: mockSig,
      challenge: mockChallenge,
    })),
  };

  function KeyImpl(buf) {
    this.buffer = buf;
  }

  return {
    helpers: {
      SchnorrHelpers: {
        createSchnorrSigner: jest.fn(() => mockSigner),
      },
    },
    types: {
      Key: jest.fn(function (buf) {
        return new KeyImpl(buf);
      }),
      PublicNonces: jest.fn(),
      SchnorrSignature: jest.fn(function (buf) {
        return { buffer: buf };
      }),
    },
    signers: {
      Schnorrkel: {
        getCombinedPublicKey: jest.fn(() => mockKey),
        sumSigs: jest.fn(() => mockSig),
        signHash: jest.fn(() => ({
          signature: mockSig,
          finalPublicNonce: mockPubNonces.kPublic,
          challenge: mockChallenge,
        })),
      },
    },
    __mocks: {
      mockSigner,
      mockKey,
      mockSig,
      mockChallenge,
      mockPubNonces,
      mockSigBuffer,
      mockChallengeBuffer,
    },
  };
});

import { continueVaultSigningSchnorrMultisig } from './evmSigning';
import * as accountAbstraction from '@runonflux/aa-schnorr-multisig-sdk';

// Convenience accessors into the mock
const mocks = () => (accountAbstraction as any).__mocks;

// The signer's pubkey hex — matches mockKey.buffer
const SIGNER_PUB_KEY_HEX = Buffer.alloc(33, 0xab).toString('hex');

// Fixed keypair and nonce used across tests
const keypair = {
  privKey: '0x' + 'aa'.repeat(32),
  pubKey: 'ab'.repeat(33),
};

// keyNonce whose kPublic/kTwoPublic match the mock's getPubNonces() output so
// the signer-nonce-slot detection branch works correctly.
const buildKeyNonce = () => {
  const { mockPubNonces } = mocks();
  return {
    k: 'f1'.repeat(32),
    kTwo: 'f2'.repeat(32),
    kPublic: mockPubNonces.kPublic.buffer.toString('hex'),
    kTwoPublic: mockPubNonces.kTwoPublic.buffer.toString('hex'),
  };
};

describe('continueVaultSigningSchnorrMultisig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return wallet contribution when key pubkey not in array (wallet-only passthrough)', () => {
    // allPublicKeys contains a key that is NOT the signer's pubkey
    const otherKey = 'cc'.repeat(33);
    const keyNonce = buildKeyNonce();
    const result = continueVaultSigningSchnorrMultisig(
      'deadbeef'.repeat(8),
      keypair,
      keyNonce,
      [otherKey],
      [{ kPublic: keyNonce.kPublic, kTwoPublic: keyNonce.kTwoPublic }],
      'aabbcc'.repeat(10),
    );

    expect(result.signerContribution).toBe('aabbcc'.repeat(10));
    expect(result.challenge).toBe('');
  });

  it('should use signMultiSigHash for multi-key arrays (2+ keys)', () => {
    const { mockSigner } = mocks();
    const keyNonce = buildKeyNonce();
    const otherKey = 'cc'.repeat(33);

    continueVaultSigningSchnorrMultisig(
      'deadbeef'.repeat(8),
      keypair,
      keyNonce,
      [SIGNER_PUB_KEY_HEX, otherKey],
      [
        { kPublic: keyNonce.kPublic, kTwoPublic: keyNonce.kTwoPublic },
        { kPublic: 'dd'.repeat(33), kTwoPublic: 'ee'.repeat(33) },
      ],
      'ff'.repeat(32),
    );

    expect(mockSigner.signMultiSigHash).toHaveBeenCalledTimes(1);
  });

  it('should sum wallet + key signatures for multi-key with sigOneHex', () => {
    const { Schnorrkel } = (accountAbstraction as any).signers;
    const keyNonce = buildKeyNonce();
    const otherKey = 'cc'.repeat(33);
    const sigOneHex = 'ff'.repeat(32);

    continueVaultSigningSchnorrMultisig(
      'deadbeef'.repeat(8),
      keypair,
      keyNonce,
      [SIGNER_PUB_KEY_HEX, otherKey],
      [
        { kPublic: keyNonce.kPublic, kTwoPublic: keyNonce.kTwoPublic },
        { kPublic: 'dd'.repeat(33), kTwoPublic: 'ee'.repeat(33) },
      ],
      sigOneHex,
    );

    expect(Schnorrkel.sumSigs).toHaveBeenCalledTimes(1);
  });

  it('single-key: should use Schnorrkel.signHash instead of signMultiSigHash', () => {
    const { mockSigner } = mocks();
    const { Schnorrkel } = (accountAbstraction as any).signers;
    const keyNonce = buildKeyNonce();

    continueVaultSigningSchnorrMultisig(
      'deadbeef'.repeat(8),
      keypair,
      keyNonce,
      [SIGNER_PUB_KEY_HEX],
      [{ kPublic: keyNonce.kPublic, kTwoPublic: keyNonce.kTwoPublic }],
      '',
    );

    expect(Schnorrkel.signHash).toHaveBeenCalledTimes(1);
    expect(mockSigner.signMultiSigHash).not.toHaveBeenCalled();
  });

  it('single-key: should return signature and challenge from signHash', () => {
    const { mockSigBuffer, mockChallengeBuffer } = mocks();
    const keyNonce = buildKeyNonce();

    const result = continueVaultSigningSchnorrMultisig(
      'deadbeef'.repeat(8),
      keypair,
      keyNonce,
      [SIGNER_PUB_KEY_HEX],
      [{ kPublic: keyNonce.kPublic, kTwoPublic: keyNonce.kTwoPublic }],
      '',
    );

    expect(result.signerContribution).toBe(mockSigBuffer.toString('hex'));
    expect(result.challenge).toBe(mockChallengeBuffer.toString('hex'));
  });

  it('single-key: should not call getCombinedPublicKey or sumSigs', () => {
    const { Schnorrkel } = (accountAbstraction as any).signers;
    const keyNonce = buildKeyNonce();

    continueVaultSigningSchnorrMultisig(
      'deadbeef'.repeat(8),
      keypair,
      keyNonce,
      [SIGNER_PUB_KEY_HEX],
      [{ kPublic: keyNonce.kPublic, kTwoPublic: keyNonce.kTwoPublic }],
      '',
    );

    expect(Schnorrkel.getCombinedPublicKey).not.toHaveBeenCalled();
    expect(Schnorrkel.sumSigs).not.toHaveBeenCalled();
  });

  it('should throw on empty arrays', () => {
    expect(() =>
      continueVaultSigningSchnorrMultisig(
        'deadbeef'.repeat(8),
        keypair,
        buildKeyNonce(),
        [],
        [],
        '',
      ),
    ).toThrow('Invalid signing arrays');
  });

  it('should throw on mismatched array lengths', () => {
    const keyNonce = buildKeyNonce();
    expect(() =>
      continueVaultSigningSchnorrMultisig(
        'deadbeef'.repeat(8),
        keypair,
        keyNonce,
        [SIGNER_PUB_KEY_HEX, 'cc'.repeat(33)],
        [{ kPublic: keyNonce.kPublic, kTwoPublic: keyNonce.kTwoPublic }],
        '',
      ),
    ).toThrow('Invalid signing arrays');
  });

  it('key-only mode: should return individual sig when sigOneHex is empty', () => {
    const { mockSigBuffer, mockChallengeBuffer } = mocks();
    const { Schnorrkel } = (accountAbstraction as any).signers;
    const keyNonce = buildKeyNonce();
    const otherKey = 'cc'.repeat(33);

    const result = continueVaultSigningSchnorrMultisig(
      'deadbeef'.repeat(8),
      keypair,
      keyNonce,
      [SIGNER_PUB_KEY_HEX, otherKey],
      [
        { kPublic: keyNonce.kPublic, kTwoPublic: keyNonce.kTwoPublic },
        { kPublic: 'dd'.repeat(33), kTwoPublic: 'ee'.repeat(33) },
      ],
      '',
    );

    // sumSigs must NOT be called — key returns its own sig directly
    expect(Schnorrkel.sumSigs).not.toHaveBeenCalled();
    expect(result.signerContribution).toBe(mockSigBuffer.toString('hex'));
    expect(result.challenge).toBe(mockChallengeBuffer.toString('hex'));
  });
});
