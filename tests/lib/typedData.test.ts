// @ts-nocheck test suite
/**
 * EIP-712 typed data: parsing (same rules as SSP Wallet), and a full 2-of-2
 * signature with the real Schnorr SDK — the wallet's half over the digest,
 * the key's half from continueSigningSchnorrMultisig(…, 'eip712') — checked
 * the way the account contract's isValidSignature checks it.
 */
import * as accountAbstraction from '@runonflux/aa-schnorr-multisig-sdk';
import { ethers } from 'ethers';
import {
  parseTypedData,
  serializeTypedData,
  typedDataDigest,
  typedDataMatchesChain,
  typedDataRisk,
} from '../../src/lib/typedData';
import { continueSigningSchnorrMultisig } from '../../src/lib/evmSigning';
import { buildEip191Preimage } from '../../src/lib/consumerGuards';

// The example from the EIP-712 specification, with its published digest.
const MAIL = {
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ],
    Person: [
      { name: 'name', type: 'string' },
      { name: 'wallet', type: 'address' },
    ],
    Mail: [
      { name: 'from', type: 'Person' },
      { name: 'to', type: 'Person' },
      { name: 'contents', type: 'string' },
    ],
  },
  primaryType: 'Mail',
  domain: {
    name: 'Ether Mail',
    version: '1',
    chainId: 1,
    verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
  },
  message: {
    from: {
      name: 'Cow',
      wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
    },
    to: {
      name: 'Bob',
      wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
    },
    contents: 'Hello, Bob!',
  },
};
const MAIL_DIGEST =
  '0xbe609aee343fb3c4b28e1df9e632fca64fcfaede20f02e86244efddf30957bd2';

const N = BigInt(
  '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141',
);

/** MultiSigSmartAccount._verifySchnorr, in JS: the recovered owner or null. */
function contractRecover(signature: string, digest: string): string | null {
  const [px, e, s, parity] = ethers.AbiCoder.defaultAbiCoder().decode(
    ['bytes32', 'bytes32', 'bytes32', 'uint8'],
    signature,
  );
  const pxN = BigInt(px);
  const sp = N - ((BigInt(s) * pxN) % N);
  const ep = N - ((BigInt(e) * pxN) % N);
  const highS = ep > N / 2n;
  const R = ethers.recoverAddress(ethers.toBeHex(sp, 32), {
    r: px,
    s: ethers.toBeHex(highS ? N - ep : ep, 32),
    v: highS ? 55 - Number(parity) : Number(parity),
  });
  const ok =
    ethers.solidityPackedKeccak256(
      ['address', 'uint8', 'bytes32', 'bytes32'],
      [R, Number(parity), px, digest],
    ) === e;
  return ok ? ethers.getAddress('0x' + px.slice(-40)) : null;
}

/** One 2-of-2 signature: the wallet's half (SDK), then the key's. */
function signBoth(
  data: string,
  messageType: 'personal' | 'eip712',
  walletDigest: string,
) {
  const walletPriv = ethers.Wallet.createRandom().privateKey;
  const keyPriv = ethers.Wallet.createRandom().privateKey;
  const walletSigner =
    accountAbstraction.helpers.SchnorrHelpers.createSchnorrSigner(walletPriv);
  walletSigner.generatePubNonces();
  const keyNonce = accountAbstraction.core._generateNonce();
  const keyPubHex = ethers.SigningKey.computePublicKey(keyPriv, true).slice(2);
  const publicKeys = [
    walletSigner.getPubKey(),
    new accountAbstraction.types.Key(Buffer.from(keyPubHex, 'hex')),
  ];
  const publicNonces = [
    walletSigner.getPubNonces(),
    {
      kPublic: new accountAbstraction.types.Key(keyNonce.kPublic),
      kTwoPublic: new accountAbstraction.types.Key(keyNonce.kTwoPublic),
    },
  ];
  // Read before signing: the SDK burns the wallet's nonce when it signs.
  const walletNonces = walletSigner.getPubNonces();
  const { signature: sigOne, challenge } = walletSigner.signMultiSigHash(
    walletDigest,
    publicKeys,
    publicNonces,
  );
  const signature = continueSigningSchnorrMultisig(
    data,
    { privKey: keyPriv, pubKey: keyPubHex },
    walletSigner.getPubKey().buffer.toString('hex'),
    {
      kPublic: walletNonces.kPublic.buffer.toString('hex'),
      kTwoPublic: walletNonces.kTwoPublic.buffer.toString('hex'),
    },
    {
      k: keyNonce.k.toString('hex'),
      kTwo: keyNonce.kTwo.toString('hex'),
      kPublic: keyNonce.kPublic.toString('hex'),
      kTwoPublic: keyNonce.kTwoPublic.toString('hex'),
    },
    sigOne.buffer.toString('hex'),
    challenge.buffer.toString('hex'),
    messageType,
  );
  const combined =
    accountAbstraction.signers.Schnorrkel.getCombinedPublicKey(publicKeys);
  // The account owner is the low 20 bytes of the combined key's x.
  const owner = ethers.getAddress(
    '0x' + combined.buffer.subarray(13, 33).toString('hex'),
  );
  return { signature, owner };
}

describe('parseTypedData', () => {
  test('hashes the EIP-712 specification example to its published digest', () => {
    expect(typedDataDigest(parseTypedData(MAIL))).toBe(MAIL_DIGEST);
    const json = serializeTypedData(parseTypedData(JSON.stringify(MAIL)));
    expect(typedDataDigest(parseTypedData(json))).toBe(MAIL_DIGEST);
  });

  test('refuses malformed payloads', () => {
    expect(() => parseTypedData('not json')).toThrow();
    expect(() => parseTypedData({ ...MAIL, primaryType: 'Missing' })).toThrow();
    expect(() =>
      parseTypedData({
        ...MAIL,
        types: {
          ...MAIL.types,
          EIP712Domain: [...MAIL.types.EIP712Domain].reverse(),
        },
      }),
    ).toThrow(/EIP712Domain/);
  });

  test('matches the domain chainId against the signing chain', () => {
    const payload = parseTypedData(MAIL);
    expect(typedDataMatchesChain(payload, '1')).toBe(true);
    expect(typedDataMatchesChain(payload, '11155111')).toBe(false);
    expect(typedDataMatchesChain(payload, undefined)).toBe(false);
  });

  test('flags permits as approvals', () => {
    expect(
      typedDataRisk({
        ...parseTypedData(MAIL),
        primaryType: 'Permit',
        types: { Permit: [{ name: 'spender', type: 'address' }] },
      }),
    ).toBe('approval');
    expect(typedDataRisk(parseTypedData(MAIL))).toBeNull();
  });
});

describe('continueSigningSchnorrMultisig', () => {
  test('typed data: the 2-of-2 signature verifies over the EIP-712 digest', () => {
    const json = serializeTypedData(parseTypedData(MAIL));
    // About half of all signatures exercise the high-s recovery path.
    for (let i = 0; i < 12; i += 1) {
      const { signature, owner } = signBoth(json, 'eip712', MAIL_DIGEST);
      expect(contractRecover(signature, MAIL_DIGEST)).toBe(owner);
      expect(contractRecover(signature, ethers.ZeroHash)).toBeNull();
    }
  });

  test('personal messages are unchanged: verify over hashMessage(text)', () => {
    const text = 'Sign in to example.com';
    const { signature, owner } = signBoth(
      buildEip191Preimage(text),
      'personal',
      ethers.hashMessage(text),
    );
    expect(contractRecover(signature, ethers.hashMessage(text))).toBe(owner);
  });

  test('typed data sent without messageType is refused as a personal message', () => {
    const json = serializeTypedData(parseTypedData(MAIL));
    expect(() => signBoth(json, 'personal', MAIL_DIGEST)).toThrow(/EIP-191/);
  });

  test('malformed typed data is refused', () => {
    expect(() =>
      signBoth('{"not":"typed data"}', 'eip712', MAIL_DIGEST),
    ).toThrow();
  });
});
