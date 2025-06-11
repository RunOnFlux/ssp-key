import * as accountAbstraction from '@runonflux/aa-schnorr-multisig-sdk';
import { ethers } from 'ethers';

import { keyPair, publicPrivateNonce } from '../types';

interface publicNonces {
  kPublic: string;
  kTwoPublic: string;
}

export function continueSigningSchnorrMultisig(
  messageToSign: string,
  keyKeypair: keyPair,
  walletPublicKey: string,
  publicNoncesWallet: publicNonces,
  publicNoncesKey: publicPrivateNonce,
  sigOneHex: string,
  challenge: string,
): string {
  try {
    console.log('Signing formatted message:', {
      message: messageToSign,
      messageLength: messageToSign.length,
    });

    // Create Schnorr signers from private key using the SDK
    const schnorrSigner2 =
      accountAbstraction.helpers.SchnorrHelpers.createSchnorrSigner(
        keyKeypair.privKey as `0x${string}`,
      );

    const kPrivate = new accountAbstraction.types.Key(
      Buffer.from(publicNoncesKey.k, 'hex'),
    );
    const kTwoPrivate = new accountAbstraction.types.Key(
      Buffer.from(publicNoncesKey.kTwo, 'hex'),
    );

    schnorrSigner2.restorePubNonces(kPrivate, kTwoPrivate);

    const pubNoncesTwo = schnorrSigner2.getPubNonces();

    const kPublicWallet = new accountAbstraction.types.Key(
      Buffer.from(publicNoncesWallet.kPublic, 'hex'),
    );
    const kTwoPublicWallet = new accountAbstraction.types.Key(
      Buffer.from(publicNoncesWallet.kTwoPublic, 'hex'),
    );
    const pubNoncesOne: accountAbstraction.types.PublicNonces = {
      kPublic: kPublicWallet,
      kTwoPublic: kTwoPublicWallet,
    };

    const publicNonces = [pubNoncesOne, pubNoncesTwo];
    console.log('🔐 Generated fresh public nonces successfully');

    const pubKeyOne = new accountAbstraction.types.Key(
      Buffer.from(walletPublicKey, 'hex'),
    );
    const pubKeyTwo = schnorrSigner2.getPubKey();

    if (!pubKeyOne || !pubKeyTwo) {
      throw new Error(
        'Failed to initialize Schnorr signers - invalid public keys',
      );
    }

    const publicKeys = [pubKeyOne, pubKeyTwo];
    console.log('🔐 Generated fresh public nonces successfully');

    // Get combined public key using Schnorrkel static method
    const combinedPublicKey =
      accountAbstraction.signers.Schnorrkel.getCombinedPublicKey(publicKeys);

    console.log('🔐 Generated combined public key');

    const { signature: sigTwo } = schnorrSigner2.signMultiSigMsg(
      messageToSign,
      publicKeys,
      publicNonces,
    );

    console.log('🔐 Generated signature');

    const sigOne = new accountAbstraction.types.SchnorrSignature(
      Buffer.from(sigOneHex, 'hex'),
    );
    console.log('🔐 Generated signature');

    // Sum the signatures
    const sSummed = accountAbstraction.signers.Schnorrkel.sumSigs([
      sigOne,
      sigTwo,
    ]);
    console.log('🔐 Signatures summed successfully');

    // Extract px and parity from combined public key for signature encoding
    const px = ethers.hexlify(combinedPublicKey.buffer.subarray(1, 33));
    const parity = combinedPublicKey.buffer[0] - 2 + 27;

    console.log('🔐 Extracted px and parity:', { px, parity });

    // Encode signature using ABI coder
    const abiCoder = new ethers.AbiCoder();

    const challengeBuffer = Buffer.from(challenge, 'hex');

    const sigData = abiCoder.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint8'],
      [
        px,
        ethers.hexlify(challengeBuffer),
        ethers.hexlify(sSummed.buffer),
        parity,
      ],
    );

    console.log('🔐 signature generated:', {
      sigData,
      length: sigData.length,
    });

    return sigData;
  } catch (error) {
    console.error('Error in Enhanced Schnorr MultiSig signing:', error);
    throw error;
  }
}
