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

/**
 * Continue Schnorr multisig signing on the Key side for enterprise vault M-of-N.
 *
 * Accepts variable-length arrays for M-of-N signing:
 * - allPublicKeys: ALL 2M public keys hex (canonical order)
 * - allPublicNonces: ALL 2M public nonces (canonical order)
 *
 * Returns raw signerContribution (sumSigs of wallet + key partial sigs)
 * and challenge hex. Backend handles ABI encoding for EVM submission.
 */
export function continueVaultSigningSchnorrMultisig(
  messageToSign: string,
  keyKeypair: keyPair,
  keyNonce: publicPrivateNonce,
  allPublicKeys: string[],
  allPublicNonces: publicNonces[],
  sigOneHex: string,
): { signerContribution: string; challenge: string } {
  if (
    !allPublicKeys.length ||
    !allPublicNonces.length ||
    allPublicKeys.length !== allPublicNonces.length
  ) {
    throw new Error(
      `Invalid signing arrays: ${allPublicKeys.length} keys vs ${allPublicNonces.length} nonces`,
    );
  }

  try {
    console.log('Vault Schnorr signing formatted message:', {
      message: messageToSign,
      messageLength: messageToSign.length,
    });

    // Create Schnorr signer from Key's private key
    const schnorrSigner =
      accountAbstraction.helpers.SchnorrHelpers.createSchnorrSigner(
        keyKeypair.privKey as `0x${string}`,
      );

    // Restore pre-reserved nonce
    const kPrivate = new accountAbstraction.types.Key(
      Buffer.from(keyNonce.k, 'hex'),
    );
    const kTwoPrivate = new accountAbstraction.types.Key(
      Buffer.from(keyNonce.kTwo, 'hex'),
    );
    schnorrSigner.restorePubNonces(kPrivate, kTwoPrivate);

    // Build Key[] from hex inputs
    const publicKeys = allPublicKeys.map(
      (hex) => new accountAbstraction.types.Key(Buffer.from(hex, 'hex')),
    );

    // Replace this signer's pubkey entry with the signer's internal Key instance
    const signerPubKey = schnorrSigner.getPubKey();
    const signerPubKeyHex = signerPubKey.buffer.toString('hex');
    const signerKeyIdx = allPublicKeys.findIndex(
      (hex) => hex === signerPubKeyHex,
    );
    if (signerKeyIdx === -1) {
      // Key pubkey not in signing array (e.g., wallet-only vault mode).
      // Return wallet's contribution as-is (wallet already signed).
      return {
        signerContribution: sigOneHex,
        challenge: '',
      };
    }
    publicKeys[signerKeyIdx] = signerPubKey;

    // Single-key Schnorr: smart account uses individual key (not combined).
    // The SDK's signMultiSigHash requires 2+ keys. For single-key vaults
    // (1-of-1 key_only or wallet_only), use Schnorrkel.signHash directly.
    if (publicKeys.length === 1) {
      const privHex = keyKeypair.privKey.startsWith('0x')
        ? keyKeypair.privKey.slice(2)
        : keyKeypair.privKey;
      const privKeyObj = new accountAbstraction.types.Key(
        Buffer.from(privHex, 'hex'),
      );
      const singleResult = accountAbstraction.signers.Schnorrkel.signHash(
        privKeyObj,
        messageToSign,
      );
      return {
        signerContribution: singleResult.signature.buffer.toString('hex'),
        challenge: singleResult.challenge.buffer.toString('hex'),
      };
    }

    // Build PublicNonces[] from hex inputs
    const signerPubNonces = schnorrSigner.getPubNonces();
    const signerNonceHex = signerPubNonces.kPublic.buffer.toString('hex');
    const publicNoncesArr: accountAbstraction.types.PublicNonces[] =
      allPublicNonces.map((n, i) => {
        // For the signer's own nonce slot, use the signer's internal nonces
        if (i === signerKeyIdx || n.kPublic === signerNonceHex) {
          return signerPubNonces;
        }
        return {
          kPublic: new accountAbstraction.types.Key(
            Buffer.from(n.kPublic, 'hex'),
          ),
          kTwoPublic: new accountAbstraction.types.Key(
            Buffer.from(n.kTwoPublic, 'hex'),
          ),
        };
      });

    console.log('🔐 Built public keys and nonces arrays');

    // Use signMultiSigHash (not signMultiSigMsg) because messageToSign is already
    // a keccak256 hash (the ERC-4337 UserOp hash). signMultiSigMsg would double-hash
    // it via _hashMessage, producing a signature the contract can't verify.
    const { signature: sigTwo, challenge } = schnorrSigner.signMultiSigHash(
      messageToSign,
      publicKeys,
      publicNoncesArr,
    );

    console.log('🔐 Generated Key partial signature');

    // Key-only mode: no wallet contribution to sum, return key's individual sig
    if (!sigOneHex) {
      console.log('🔐 Key-only mode: returning individual key signature');
      return {
        signerContribution: sigTwo.buffer.toString('hex'),
        challenge: challenge.buffer.toString('hex'),
      };
    }

    // Sum wallet's partial sig + key's partial sig = signer contribution
    const sigOne = new accountAbstraction.types.SchnorrSignature(
      Buffer.from(sigOneHex, 'hex'),
    );
    const signerContribution = accountAbstraction.signers.Schnorrkel.sumSigs([
      sigOne,
      sigTwo,
    ]);

    console.log('🔐 Signer contribution computed (wallet + key)');

    return {
      signerContribution: signerContribution.buffer.toString('hex'),
      challenge: challenge.buffer.toString('hex'),
    };
  } catch (error) {
    console.error('Error in Vault Schnorr MultiSig signing:', error);
    throw error;
  }
}
