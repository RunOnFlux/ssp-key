// @ts-nocheck
/**
 * Critical security tests for Schnorr multisig signing functions in ssp-key.
 *
 * Tests the KEY-SIDE of EVM vault signing — signature completion.
 * Two exported functions:
 *   1. continueSigningSchnorrMultisig()  — Legacy 2-of-2 (ABI-encoded sig)
 *   2. continueVaultSigningSchnorrMultisig() — Vault M-of-N (raw contribution)
 */

// ---- Mock constants ----
const MOCK_PUB_KEY_BUFFER = Buffer.alloc(33, 0xab);
const MOCK_SIG_BUFFER = Buffer.alloc(32, 0xcd);
const MOCK_CHALLENGE_BUFFER = Buffer.alloc(32, 0xef);
const MOCK_ABI_ENCODED = '0xmockedAbiEncodedSignature';

// ---- Mock SDK objects ----
const mockRestorePubNonces = jest.fn();
const mockGetPubKey = jest.fn(() => ({ buffer: MOCK_PUB_KEY_BUFFER }));
const mockGetPubNonces = jest.fn(() => ({
  kPublic: { buffer: MOCK_PUB_KEY_BUFFER },
  kTwoPublic: { buffer: MOCK_PUB_KEY_BUFFER },
}));
const mockSignMultiSigMsg = jest.fn(() => ({
  signature: { buffer: MOCK_SIG_BUFFER },
  challenge: { buffer: MOCK_CHALLENGE_BUFFER },
}));
const mockSignMultiSigHash = jest.fn(() => ({
  signature: { buffer: MOCK_SIG_BUFFER },
  challenge: { buffer: MOCK_CHALLENGE_BUFFER },
}));
const mockCreateSchnorrSigner = jest.fn(() => ({
  restorePubNonces: mockRestorePubNonces,
  getPubKey: mockGetPubKey,
  getPubNonces: mockGetPubNonces,
  signMultiSigMsg: mockSignMultiSigMsg,
  signMultiSigHash: mockSignMultiSigHash,
}));
const mockGetCombinedPublicKey = jest.fn(() => ({
  buffer: MOCK_PUB_KEY_BUFFER,
}));
const mockSumSigs = jest.fn(() => ({ buffer: MOCK_SIG_BUFFER }));
const mockKeyConstructor = jest.fn((buf: Buffer) => ({ buffer: buf }));
const mockSchnorrSignatureConstructor = jest.fn((buf: Buffer) => ({
  buffer: buf,
}));

// ---- Mock ethers ----
const mockEncode = jest.fn(() => MOCK_ABI_ENCODED);
const mockHexlify = jest.fn(
  (buf: Buffer | Uint8Array) => '0x' + Buffer.from(buf).toString('hex'),
);

jest.mock('@runonflux/aa-schnorr-multisig-sdk', () => {
  return {
    __esModule: true,
    helpers: {
      SchnorrHelpers: {
        get createSchnorrSigner() {
          return mockCreateSchnorrSigner;
        },
      },
    },
    types: {
      get Key() {
        return mockKeyConstructor;
      },
      get SchnorrSignature() {
        return mockSchnorrSignatureConstructor;
      },
      PublicNonces: jest.fn(),
    },
    signers: {
      Schnorrkel: {
        get getCombinedPublicKey() {
          return mockGetCombinedPublicKey;
        },
        get sumSigs() {
          return mockSumSigs;
        },
      },
    },
  };
});

jest.mock('ethers', () => ({
  ethers: {
    get hexlify() {
      return mockHexlify;
    },
    AbiCoder: jest.fn().mockImplementation(() => ({
      get encode() {
        return mockEncode;
      },
    })),
  },
}));

import {
  continueSigningSchnorrMultisig,
  continueVaultSigningSchnorrMultisig,
} from '../../src/lib/evmSigning';

// ---- Test data helpers ----
const MOCK_MESSAGE = 'test message to sign';
const MOCK_PRIV_KEY = '0x' + 'aa'.repeat(32);
const MOCK_PUB_KEY_HEX = 'bb'.repeat(33);
const MOCK_WALLET_PUB_KEY_HEX = 'cc'.repeat(33);
const MOCK_SIG_ONE_HEX = 'dd'.repeat(32);
const MOCK_CHALLENGE_HEX = 'ee'.repeat(32);
const MOCK_NONCE_K = 'ff'.repeat(32);
const MOCK_NONCE_K_TWO = '11'.repeat(32);
const MOCK_NONCE_K_PUBLIC = '22'.repeat(33);
const MOCK_NONCE_K_TWO_PUBLIC = '33'.repeat(33);

function makeKeyKeypair() {
  return { privKey: MOCK_PRIV_KEY, pubKey: MOCK_PUB_KEY_HEX };
}

function makeWalletPublicNonces() {
  return {
    kPublic: MOCK_NONCE_K_PUBLIC,
    kTwoPublic: MOCK_NONCE_K_TWO_PUBLIC,
  };
}

function makeKeyNonce() {
  return {
    k: MOCK_NONCE_K,
    kTwo: MOCK_NONCE_K_TWO,
    kPublic: MOCK_NONCE_K_PUBLIC,
    kTwoPublic: MOCK_NONCE_K_TWO_PUBLIC,
  };
}

// ---- Tests ----

describe('evmSigning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default implementations after clearAllMocks
    mockGetPubKey.mockReturnValue({ buffer: MOCK_PUB_KEY_BUFFER });
    mockGetPubNonces.mockReturnValue({
      kPublic: { buffer: MOCK_PUB_KEY_BUFFER },
      kTwoPublic: { buffer: MOCK_PUB_KEY_BUFFER },
    });
    mockSignMultiSigMsg.mockReturnValue({
      signature: { buffer: MOCK_SIG_BUFFER },
      challenge: { buffer: MOCK_CHALLENGE_BUFFER },
    });
    mockSignMultiSigHash.mockReturnValue({
      signature: { buffer: MOCK_SIG_BUFFER },
      challenge: { buffer: MOCK_CHALLENGE_BUFFER },
    });
    mockCreateSchnorrSigner.mockReturnValue({
      restorePubNonces: mockRestorePubNonces,
      getPubKey: mockGetPubKey,
      getPubNonces: mockGetPubNonces,
      signMultiSigMsg: mockSignMultiSigMsg,
      signMultiSigHash: mockSignMultiSigHash,
    });
    mockSumSigs.mockReturnValue({ buffer: MOCK_SIG_BUFFER });
    mockGetCombinedPublicKey.mockReturnValue({ buffer: MOCK_PUB_KEY_BUFFER });
    mockKeyConstructor.mockImplementation((buf: Buffer) => ({ buffer: buf }));
    mockSchnorrSignatureConstructor.mockImplementation((buf: Buffer) => ({
      buffer: buf,
    }));
    mockEncode.mockReturnValue(MOCK_ABI_ENCODED);
    mockHexlify.mockImplementation(
      (buf: Buffer | Uint8Array) => '0x' + Buffer.from(buf).toString('hex'),
    );
  });

  // ==========================================================================
  // continueSigningSchnorrMultisig — Legacy 2-of-2
  // ==========================================================================
  describe('continueSigningSchnorrMultisig()', () => {
    test('should create signer from key private key', () => {
      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      expect(mockCreateSchnorrSigner).toHaveBeenCalledTimes(1);
      expect(mockCreateSchnorrSigner).toHaveBeenCalledWith(MOCK_PRIV_KEY);
    });

    test('should restore pre-reserved nonce via restorePubNonces', () => {
      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      expect(mockRestorePubNonces).toHaveBeenCalledTimes(1);
      // First arg = Key(k), second arg = Key(kTwo)
      const kArg = mockRestorePubNonces.mock.calls[0][0];
      const kTwoArg = mockRestorePubNonces.mock.calls[0][1];
      expect(kArg.buffer).toEqual(Buffer.from(MOCK_NONCE_K, 'hex'));
      expect(kTwoArg.buffer).toEqual(Buffer.from(MOCK_NONCE_K_TWO, 'hex'));
    });

    test('should construct wallet public nonces from hex', () => {
      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      // The function creates Key instances from wallet nonce hex strings
      const keyCalls = mockKeyConstructor.mock.calls;
      // kPublicWallet and kTwoPublicWallet are among the Key constructor calls
      const walletKPublicCall = keyCalls.find(
        (c: any[]) =>
          c[0] instanceof Buffer &&
          c[0].equals(Buffer.from(MOCK_NONCE_K_PUBLIC, 'hex')),
      );
      const walletKTwoPublicCall = keyCalls.find(
        (c: any[]) =>
          c[0] instanceof Buffer &&
          c[0].equals(Buffer.from(MOCK_NONCE_K_TWO_PUBLIC, 'hex')),
      );
      expect(walletKPublicCall).toBeDefined();
      expect(walletKTwoPublicCall).toBeDefined();
    });

    test('should create both public keys (wallet and key)', () => {
      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      // Wallet public key constructed from hex
      const walletPubKeyCall = mockKeyConstructor.mock.calls.find(
        (c: any[]) =>
          c[0] instanceof Buffer &&
          c[0].equals(Buffer.from(MOCK_WALLET_PUB_KEY_HEX, 'hex')),
      );
      expect(walletPubKeyCall).toBeDefined();

      // Key's public key obtained from signer
      expect(mockGetPubKey).toHaveBeenCalled();
    });

    test('should call signMultiSigMsg with correct args', () => {
      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      expect(mockSignMultiSigMsg).toHaveBeenCalledTimes(1);
      const [msg, pubKeys, pubNonces] = mockSignMultiSigMsg.mock.calls[0];
      expect(msg).toBe(MOCK_MESSAGE);
      // 2 public keys (wallet + key)
      expect(pubKeys).toHaveLength(2);
      // 2 nonce sets (wallet + key)
      expect(pubNonces).toHaveLength(2);
    });

    test('should sum wallet and key signatures via sumSigs', () => {
      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      expect(mockSumSigs).toHaveBeenCalledTimes(1);
      const [sigs] = mockSumSigs.mock.calls[0];
      expect(sigs).toHaveLength(2);
      // First sig is sigOne (from wallet), second is sigTwo (from signMultiSigMsg)
      expect(sigs[0].buffer).toEqual(Buffer.from(MOCK_SIG_ONE_HEX, 'hex'));
      expect(sigs[1].buffer).toEqual(MOCK_SIG_BUFFER);
    });

    test('should get combined public key', () => {
      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      expect(mockGetCombinedPublicKey).toHaveBeenCalledTimes(1);
      const [pubKeys] = mockGetCombinedPublicKey.mock.calls[0];
      expect(pubKeys).toHaveLength(2);
    });

    test('should extract px (bytes 1-33) and parity (byte[0] - 2 + 27)', () => {
      // Combined public key buffer: byte 0 is prefix (02 or 03), bytes 1-32 is x
      const combinedKeyBuffer = Buffer.alloc(33);
      combinedKeyBuffer[0] = 0x02; // even parity prefix
      combinedKeyBuffer.fill(0xaa, 1, 33);
      mockGetCombinedPublicKey.mockReturnValue({
        buffer: combinedKeyBuffer,
      });

      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      // hexlify called with subarray(1,33) for px
      const pxCall = mockHexlify.mock.calls.find(
        (c: any[]) =>
          c[0] instanceof Buffer &&
          c[0].length === 32 &&
          c[0].equals(combinedKeyBuffer.subarray(1, 33)),
      );
      expect(pxCall).toBeDefined();

      // Parity: 0x02 - 2 + 27 = 27
      const encodeCall = mockEncode.mock.calls[0];
      const parityArg = encodeCall[1][3]; // fourth ABI arg
      expect(parityArg).toBe(27);
    });

    test('should compute parity 28 for odd prefix (0x03)', () => {
      const combinedKeyBuffer = Buffer.alloc(33);
      combinedKeyBuffer[0] = 0x03; // odd parity prefix
      combinedKeyBuffer.fill(0xbb, 1, 33);
      mockGetCombinedPublicKey.mockReturnValue({
        buffer: combinedKeyBuffer,
      });

      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      // Parity: 0x03 - 2 + 27 = 28
      const encodeCall = mockEncode.mock.calls[0];
      const parityArg = encodeCall[1][3];
      expect(parityArg).toBe(28);
    });

    test('should ABI encode [px, challenge, sSummed, parity] as bytes32,bytes32,bytes32,uint8', () => {
      continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      expect(mockEncode).toHaveBeenCalledTimes(1);
      const [types, values] = mockEncode.mock.calls[0];
      expect(types).toEqual(['bytes32', 'bytes32', 'bytes32', 'uint8']);
      // 4 values: px, challenge, sSummed, parity
      expect(values).toHaveLength(4);
    });

    test('should return ABI-encoded signature string', () => {
      const result = continueSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        MOCK_WALLET_PUB_KEY_HEX,
        makeWalletPublicNonces(),
        makeKeyNonce(),
        MOCK_SIG_ONE_HEX,
        MOCK_CHALLENGE_HEX,
      );

      expect(result).toBe(MOCK_ABI_ENCODED);
    });

    test('should throw when public key initialization fails', () => {
      // getPubKey returns falsy -> throws
      mockGetPubKey.mockReturnValueOnce(null);

      expect(() =>
        continueSigningSchnorrMultisig(
          MOCK_MESSAGE,
          makeKeyKeypair(),
          MOCK_WALLET_PUB_KEY_HEX,
          makeWalletPublicNonces(),
          makeKeyNonce(),
          MOCK_SIG_ONE_HEX,
          MOCK_CHALLENGE_HEX,
        ),
      ).toThrow('Failed to initialize Schnorr signers - invalid public keys');
    });

    test('should propagate SDK errors from signMultiSigMsg', () => {
      mockSignMultiSigMsg.mockImplementationOnce(() => {
        throw new Error('SDK signing failed');
      });

      expect(() =>
        continueSigningSchnorrMultisig(
          MOCK_MESSAGE,
          makeKeyKeypair(),
          MOCK_WALLET_PUB_KEY_HEX,
          makeWalletPublicNonces(),
          makeKeyNonce(),
          MOCK_SIG_ONE_HEX,
          MOCK_CHALLENGE_HEX,
        ),
      ).toThrow('SDK signing failed');
    });
  });

  // ==========================================================================
  // continueVaultSigningSchnorrMultisig — Vault M-of-N
  // ==========================================================================
  describe('continueVaultSigningSchnorrMultisig()', () => {
    // For vault signing, the signer's public key must appear in allPublicKeys
    const signerPubKeyHex = MOCK_PUB_KEY_BUFFER.toString('hex');

    function makeAllPublicKeys2of2() {
      return [MOCK_WALLET_PUB_KEY_HEX, signerPubKeyHex];
    }

    function makeAllPublicNonces2of2() {
      return [
        { kPublic: 'aa'.repeat(33), kTwoPublic: 'bb'.repeat(33) },
        {
          kPublic: MOCK_PUB_KEY_BUFFER.toString('hex'),
          kTwoPublic: MOCK_PUB_KEY_BUFFER.toString('hex'),
        },
      ];
    }

    test('should restore pre-reserved key nonce', () => {
      continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        makeAllPublicKeys2of2(),
        makeAllPublicNonces2of2(),
        MOCK_SIG_ONE_HEX,
      );

      expect(mockRestorePubNonces).toHaveBeenCalledTimes(1);
      const kArg = mockRestorePubNonces.mock.calls[0][0];
      const kTwoArg = mockRestorePubNonces.mock.calls[0][1];
      expect(kArg.buffer).toEqual(Buffer.from(MOCK_NONCE_K, 'hex'));
      expect(kTwoArg.buffer).toEqual(Buffer.from(MOCK_NONCE_K_TWO, 'hex'));
    });

    test('should throw when allPublicKeys is empty', () => {
      expect(() =>
        continueVaultSigningSchnorrMultisig(
          MOCK_MESSAGE,
          makeKeyKeypair(),
          makeKeyNonce(),
          [],
          makeAllPublicNonces2of2(),
          MOCK_SIG_ONE_HEX,
        ),
      ).toThrow('Invalid signing arrays: 0 keys vs 2 nonces');
    });

    test('should throw when allPublicNonces is empty', () => {
      expect(() =>
        continueVaultSigningSchnorrMultisig(
          MOCK_MESSAGE,
          makeKeyKeypair(),
          makeKeyNonce(),
          makeAllPublicKeys2of2(),
          [],
          MOCK_SIG_ONE_HEX,
        ),
      ).toThrow('Invalid signing arrays: 2 keys vs 0 nonces');
    });

    test('should throw when arrays have different lengths', () => {
      expect(() =>
        continueVaultSigningSchnorrMultisig(
          MOCK_MESSAGE,
          makeKeyKeypair(),
          makeKeyNonce(),
          [signerPubKeyHex],
          makeAllPublicNonces2of2(),
          MOCK_SIG_ONE_HEX,
        ),
      ).toThrow('Invalid signing arrays: 1 keys vs 2 nonces');
    });

    test('should find key public key in allPublicKeys array', () => {
      continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        makeAllPublicKeys2of2(),
        makeAllPublicNonces2of2(),
        MOCK_SIG_ONE_HEX,
      );

      // The function should locate the signer by matching getPubKey().buffer hex
      expect(mockGetPubKey).toHaveBeenCalled();
    });

    test('should throw when key public key not found (key mismatch)', () => {
      // All keys in array are different from signer's pub key
      const mismatchedKeys = ['cc'.repeat(33), 'dd'.repeat(33)];
      const nonces = [
        { kPublic: 'aa'.repeat(33), kTwoPublic: 'bb'.repeat(33) },
        { kPublic: 'cc'.repeat(33), kTwoPublic: 'dd'.repeat(33) },
      ];

      expect(() =>
        continueVaultSigningSchnorrMultisig(
          MOCK_MESSAGE,
          makeKeyKeypair(),
          makeKeyNonce(),
          mismatchedKeys,
          nonces,
          MOCK_SIG_ONE_HEX,
        ),
      ).toThrow('Key public key not found in allSignerKeys array');
    });

    test('should replace key entry in publicKeys with internal Key instance', () => {
      const internalPubKey = { buffer: MOCK_PUB_KEY_BUFFER };
      mockGetPubKey.mockReturnValue(internalPubKey);

      continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        makeAllPublicKeys2of2(),
        makeAllPublicNonces2of2(),
        MOCK_SIG_ONE_HEX,
      );

      // signMultiSigHash receives publicKeys array where the signer's slot
      // is the internal Key instance (not a Key constructed from hex)
      const [, pubKeys] = mockSignMultiSigHash.mock.calls[0];
      const signerIdx = makeAllPublicKeys2of2().indexOf(signerPubKeyHex);
      expect(pubKeys[signerIdx]).toBe(internalPubKey);
    });

    test('should use signer internal nonces for matching slot', () => {
      const internalNonces = {
        kPublic: { buffer: MOCK_PUB_KEY_BUFFER },
        kTwoPublic: { buffer: MOCK_PUB_KEY_BUFFER },
      };
      mockGetPubNonces.mockReturnValue(internalNonces);

      continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        makeAllPublicKeys2of2(),
        makeAllPublicNonces2of2(),
        MOCK_SIG_ONE_HEX,
      );

      // signMultiSigHash receives nonces array with internal nonces at signer index
      const [, , pubNonces] = mockSignMultiSigHash.mock.calls[0];
      const signerIdx = makeAllPublicKeys2of2().indexOf(signerPubKeyHex);
      expect(pubNonces[signerIdx]).toBe(internalNonces);
    });

    test('should call signMultiSigHash with all public keys and nonces', () => {
      continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        makeAllPublicKeys2of2(),
        makeAllPublicNonces2of2(),
        MOCK_SIG_ONE_HEX,
      );

      expect(mockSignMultiSigHash).toHaveBeenCalledTimes(1);
      const [msg, pubKeys, pubNonces] = mockSignMultiSigHash.mock.calls[0];
      expect(msg).toBe(MOCK_MESSAGE);
      expect(pubKeys).toHaveLength(2);
      expect(pubNonces).toHaveLength(2);
    });

    test('should sum wallet sigOne and key sigTwo via sumSigs', () => {
      continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        makeAllPublicKeys2of2(),
        makeAllPublicNonces2of2(),
        MOCK_SIG_ONE_HEX,
      );

      expect(mockSumSigs).toHaveBeenCalledTimes(1);
      const [sigs] = mockSumSigs.mock.calls[0];
      expect(sigs).toHaveLength(2);
      // First is sigOne from wallet, second is sigTwo from signMultiSigMsg
      expect(sigs[0].buffer).toEqual(Buffer.from(MOCK_SIG_ONE_HEX, 'hex'));
      expect(sigs[1].buffer).toEqual(MOCK_SIG_BUFFER);
    });

    test('should return signerContribution as hex string', () => {
      const result = continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        makeAllPublicKeys2of2(),
        makeAllPublicNonces2of2(),
        MOCK_SIG_ONE_HEX,
      );

      expect(result.signerContribution).toBe(MOCK_SIG_BUFFER.toString('hex'));
    });

    test('should return challenge as hex string', () => {
      const result = continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        makeAllPublicKeys2of2(),
        makeAllPublicNonces2of2(),
        MOCK_SIG_ONE_HEX,
      );

      expect(result.challenge).toBe(MOCK_CHALLENGE_BUFFER.toString('hex'));
    });

    test('should handle 4 keys for 2-of-2 vault (2 signers x 2 keys each)', () => {
      const fourKeys = [
        'aa'.repeat(33), // signer1 wallet
        'bb'.repeat(33), // signer1 key
        signerPubKeyHex, // signer2 key (this signer)
        'dd'.repeat(33), // signer2 wallet
      ];
      const fourNonces = [
        { kPublic: '11'.repeat(33), kTwoPublic: '12'.repeat(33) },
        { kPublic: '21'.repeat(33), kTwoPublic: '22'.repeat(33) },
        {
          kPublic: MOCK_PUB_KEY_BUFFER.toString('hex'),
          kTwoPublic: MOCK_PUB_KEY_BUFFER.toString('hex'),
        },
        { kPublic: '41'.repeat(33), kTwoPublic: '42'.repeat(33) },
      ];

      const result = continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        fourKeys,
        fourNonces,
        MOCK_SIG_ONE_HEX,
      );

      expect(mockSignMultiSigHash).toHaveBeenCalledTimes(1);
      const [, pubKeys, pubNonces] = mockSignMultiSigHash.mock.calls[0];
      expect(pubKeys).toHaveLength(4);
      expect(pubNonces).toHaveLength(4);
      expect(result.signerContribution).toBe(MOCK_SIG_BUFFER.toString('hex'));
      expect(result.challenge).toBe(MOCK_CHALLENGE_BUFFER.toString('hex'));
    });

    test('should handle 6 keys for 2-of-3 vault (3 signers x 2 keys each)', () => {
      const sixKeys = [
        'a1'.repeat(33),
        'b1'.repeat(33),
        'c1'.repeat(33),
        signerPubKeyHex, // this signer
        'd1'.repeat(33),
        'e1'.repeat(33),
      ];
      const sixNonces = [
        { kPublic: '11'.repeat(33), kTwoPublic: '12'.repeat(33) },
        { kPublic: '21'.repeat(33), kTwoPublic: '22'.repeat(33) },
        { kPublic: '31'.repeat(33), kTwoPublic: '32'.repeat(33) },
        {
          kPublic: MOCK_PUB_KEY_BUFFER.toString('hex'),
          kTwoPublic: MOCK_PUB_KEY_BUFFER.toString('hex'),
        },
        { kPublic: '51'.repeat(33), kTwoPublic: '52'.repeat(33) },
        { kPublic: '61'.repeat(33), kTwoPublic: '62'.repeat(33) },
      ];

      const result = continueVaultSigningSchnorrMultisig(
        MOCK_MESSAGE,
        makeKeyKeypair(),
        makeKeyNonce(),
        sixKeys,
        sixNonces,
        MOCK_SIG_ONE_HEX,
      );

      expect(mockSignMultiSigHash).toHaveBeenCalledTimes(1);
      const [, pubKeys, pubNonces] = mockSignMultiSigHash.mock.calls[0];
      expect(pubKeys).toHaveLength(6);
      expect(pubNonces).toHaveLength(6);
      expect(result.signerContribution).toBeDefined();
      expect(result.challenge).toBeDefined();
    });

    test('should propagate SDK errors from signMultiSigHash', () => {
      mockSignMultiSigHash.mockImplementationOnce(() => {
        throw new Error('Vault SDK signing error');
      });

      expect(() =>
        continueVaultSigningSchnorrMultisig(
          MOCK_MESSAGE,
          makeKeyKeypair(),
          makeKeyNonce(),
          makeAllPublicKeys2of2(),
          makeAllPublicNonces2of2(),
          MOCK_SIG_ONE_HEX,
        ),
      ).toThrow('Vault SDK signing error');
    });

    test('should propagate errors from sumSigs', () => {
      mockSumSigs.mockImplementationOnce(() => {
        throw new Error('sumSigs failed');
      });

      expect(() =>
        continueVaultSigningSchnorrMultisig(
          MOCK_MESSAGE,
          makeKeyKeypair(),
          makeKeyNonce(),
          makeAllPublicKeys2of2(),
          makeAllPublicNonces2of2(),
          MOCK_SIG_ONE_HEX,
        ),
      ).toThrow('sumSigs failed');
    });
  });
});
