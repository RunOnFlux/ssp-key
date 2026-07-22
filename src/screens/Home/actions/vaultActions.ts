import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { fluxnode } from '@runonflux/flux-sdk';
import utxolib from '@runonflux/utxo-lib';
import { blockchains } from '@storage/blockchains';
import {
  getMasterXpriv,
  getMasterXpub,
  generateAddressKeypair,
  generateSolanaPubkeyArray,
  getLibId,
} from '../../../lib/wallet';
import { continueVaultSigningSchnorrMultisig } from '../../../lib/evmSigning';
import {
  userOpHashMatches,
  messageDigestMatches,
} from '../../../lib/userOpVerify';
import { signMessage } from '../../../lib/relayAuth';
import { setSspKeyEnterprisePublicNonces } from '../../../store/ssp';
import { cryptos, publicPrivateNonce } from '../../../types';
import type { HomeActionContext } from './types';

export const handleVaultXpubAction = async (ctx: HomeActionContext) => {
  const {
    vaultXpubData,
    seedPhrase,
    identityChainState,
    identityChain,
    postAction,
    sspWalletKeyInternalIdentity,
    displayMessage,
    t,
    setVaultXpubData,
    clearVaultXpubRequest,
  } = ctx;
  if (!vaultXpubData) return;

  // Hoist sensitive vars outside try so they can be cleared in catch
  let pwForEncryption = '';
  let mnemonicPhrase = '';
  let xprivKeyDecrypted = '';

  try {
    // Get decryption keys from keychain
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });

    if (!passwordData || !encryptionKey) {
      throw new Error('Unable to decrypt stored data');
    }

    // Decrypt password
    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const passwordDecryptedString = passwordDecrypted.toString(
      CryptoJS.enc.Utf8,
    );
    pwForEncryption = encryptionKey.password + passwordDecryptedString;

    // Decrypt mnemonic seed phrase
    const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
    mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);

    if (!mnemonicPhrase) {
      throw new Error('Failed to decrypt mnemonic');
    }

    // Determine chain config for the requested chain
    const vaultChain = vaultXpubData.chain as keyof cryptos;
    const blockchainConfig = blockchains[vaultChain];
    if (!blockchainConfig) {
      throw new Error('Unsupported chain: ' + vaultXpubData.chain);
    }

    // For UTXO/EVM: BIP32 xpub at m/48'/coin'/orgIndex'/scriptType'. Backend
    // derives child pubkeys per addressIndex on demand.
    // For Solana: pre-derive 20 ed25519 pubkeys at /[vaultIndex]/0..19 from
    // the master xpriv and send as JSON array. vaultIndex (from the wallet's
    // relay payload) provides per-vault key separation — mirrors EVM/UTXO
    // behavior where vault.vaultIndex shifts the HD derivation.
    let vaultXpub: string;
    if (
      typeof vaultXpubData.vaultIndex !== 'number' ||
      !Number.isInteger(vaultXpubData.vaultIndex) ||
      vaultXpubData.vaultIndex < 0
    ) {
      throw new Error(
        'vaultXpub request missing valid vaultIndex (wallet must send a non-negative integer)',
      );
    }
    const solVaultTypeIndex = vaultXpubData.vaultIndex;
    if (blockchainConfig.chainType === 'sol') {
      const solVaultXpriv = getMasterXpriv(
        mnemonicPhrase,
        48,
        blockchainConfig.slip,
        vaultXpubData.orgIndex,
        blockchainConfig.scriptType,
        vaultChain,
      );
      const pubkeys = generateSolanaPubkeyArray(
        solVaultXpriv,
        vaultChain,
        solVaultTypeIndex,
      );
      vaultXpub = JSON.stringify(pubkeys);
    } else {
      vaultXpub = getMasterXpub(
        mnemonicPhrase,
        48,
        blockchainConfig.slip,
        vaultXpubData.orgIndex,
        blockchainConfig.scriptType,
        vaultChain,
      );
    }

    // Sign the keyXpub with identity key for verification
    const { xprivKey: idXprivKey } = identityChainState || {};
    if (!idXprivKey) {
      throw new Error('xprivKey not available');
    }
    const xprivDecrypted = CryptoJS.AES.decrypt(idXprivKey, pwForEncryption);
    xprivKeyDecrypted = xprivDecrypted.toString(CryptoJS.enc.Utf8);
    if (!xprivKeyDecrypted) {
      throw new Error('Failed to decrypt xprivKey');
    }
    const identityKeypair = generateAddressKeypair(
      xprivKeyDecrypted,
      10,
      0,
      identityChain,
    );
    const xpubMessage = `SSP_VAULT_XPUB:key:${vaultXpub}:${vaultXpubData.chain}:${String(vaultXpubData.orgIndex)}`;
    const keyXpubSignature = signMessage(
      xpubMessage,
      identityKeypair.privKey,
      identityChain,
    );

    // Clear sensitive key material
    identityKeypair.privKey = '';
    xprivKeyDecrypted = '';
    mnemonicPhrase = '';
    pwForEncryption = '';

    // Build response payload
    const responsePayload = {
      xpubKey: vaultXpub,
      keyXpubSignature,
      requestId: vaultXpubData.requestId,
      chain: vaultXpubData.chain,
      orgIndex: vaultXpubData.orgIndex,
    };

    // Post 'enterprisevaultxpubsigned' action to relay
    await postAction(
      'enterprisevaultxpubsigned',
      JSON.stringify(responsePayload),
      vaultXpubData.chain,
      '',
      sspWalletKeyInternalIdentity,
    );

    displayMessage('success', t('home:vault_xpub_success'));
  } catch (error) {
    // Clear sensitive key material on error path
    xprivKeyDecrypted = '';
    mnemonicPhrase = '';
    pwForEncryption = '';
    console.error('[Vault Xpub] Error:', error);
    displayMessage('error', t('home:err_vault_xpub_failed'));
  } finally {
    setVaultXpubData(null);
    clearVaultXpubRequest?.();
  }
};
export const handleVaultSignAction = async (ctx: HomeActionContext) => {
  const {
    vaultSigningData,
    solDecodeState,
    seedPhrase,
    enterprisePublicNonces,
    dispatch,
    postAction,
    displayMessage,
    t,
    sspWalletKeyInternalIdentity,
    clearVaultSigningState,
    clearVaultSigningRequest,
  } = ctx;
  if (!vaultSigningData) return;

  // Sign-time fail-closed recheck for Solana: the Approve button's
  // disabled prop is evaluated at press time, but the byte-decode verdict
  // can land while biometric auth is open (or the press can race the
  // async decode). NEVER partial-sign while the trustless decode is still
  // pending or after it flagged a mismatch. Keeps the request open — the
  // user sees the banner/disabled state instead of a silent dismissal.
  if (
    blockchains[vaultSigningData.chain as keyof cryptos]?.chainType === 'sol'
  ) {
    if (!solDecodeState) {
      // Decode still pending — Approve is disabled while pending, so this
      // is defensive-only; refuse to sign without a verdict.
      return;
    }
    if (solDecodeState.mismatch) {
      displayMessage('error', t('home:vault_sign_sol_decode_mismatch'), 8000);
      return;
    }
  }

  // Hoist sensitive vars outside try so they can be cleared in catch/finally
  let vaultXpriv = '';
  let pwForEncryption = '';
  let mnemonicPhrase = '';

  try {
    // Get decryption keys from keychain
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });

    if (!passwordData || !encryptionKey) {
      throw new Error('Unable to decrypt stored data');
    }

    // Decrypt password
    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const passwordDecryptedString = passwordDecrypted.toString(
      CryptoJS.enc.Utf8,
    );
    pwForEncryption = encryptionKey.password + passwordDecryptedString;

    // Decrypt mnemonic seed phrase
    const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
    mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);

    if (!mnemonicPhrase) {
      throw new Error('Failed to decrypt mnemonic');
    }

    // Determine chain config for the requested chain
    const vaultChain = vaultSigningData.chain as keyof cryptos;
    const blockchainConfig = blockchains[vaultChain];
    if (!blockchainConfig) {
      throw new Error('Unsupported chain: ' + vaultSigningData.chain);
    }

    // Derive xpriv at m/48'/coin'/orgIndex'/scriptType'
    vaultXpriv = getMasterXpriv(
      mnemonicPhrase,
      48,
      blockchainConfig.slip,
      vaultSigningData.orgIndex,
      blockchainConfig.scriptType,
      vaultChain,
    );

    // Clear mnemonic immediately — no longer needed
    mnemonicPhrase = '';
    // NOTE: pwForEncryption is still needed for nonce decryption/encryption below

    // Key's public key for this vault — set during signing
    let keyPubKey = '';

    // Solana enterprise: ed25519 partial-sign of the bundled tx.
    // No nonces, no Schnorr, no UTXO progressive — just one 64-byte sig
    // for Key's slot.
    if (blockchainConfig.chainType === 'sol') {
      // Read addressIndex from the synthesized inputDetails[0] entry the
      // wallet/enterprise-app forwards. Must match the index used to
      // derive the on-chain multisig PDA; otherwise the derived pubkey
      // wouldn't be a member and approve_transaction would reject.
      // Defensive: vaultSigningData.inputDetails may arrive as either a
      // JSON string (relay payload) or already-parsed Array — match the
      // existing UTXO path's accommodation.
      let solInputDetailsParsed: Array<{ addressIndex?: number }> = [];
      const rawInputDetails = vaultSigningData.inputDetails;
      if (typeof rawInputDetails === 'string') {
        try {
          solInputDetailsParsed = JSON.parse(rawInputDetails) as Array<{
            addressIndex?: number;
          }>;
        } catch {
          solInputDetailsParsed = [];
        }
      } else if (Array.isArray(rawInputDetails)) {
        solInputDetailsParsed = rawInputDetails;
      }
      const solAddressIndex =
        typeof solInputDetailsParsed[0]?.addressIndex === 'number'
          ? solInputDetailsParsed[0].addressIndex
          : 0;
      // Sign at HD path [vaultIndex][addressIndex]. Mirrors the per-vault
      // xpub flow (generateSolanaPubkeyArray now also derives at
      // typeIndex=vault.vaultIndex), so the wallet's signing pubkey
      // matches the multisig slot pubkey computed from the stored xpub
      // array. Identical to EVM/UTXO per-vault key separation.
      const signingKeypair = generateAddressKeypair(
        vaultXpriv,
        vaultSigningData.vaultIndex,
        solAddressIndex,
        vaultChain,
      );
      keyPubKey = signingKeypair.pubKey;

      const { Transaction: SolTransaction, Keypair: SolKeypair } =
        await import('@solana/web3.js');
      const secretKey = new Uint8Array(
        Buffer.from(signingKeypair.privKey, 'hex'),
      );
      const keyKeypair = SolKeypair.fromSecretKey(secretKey);
      let keySigBase64: string;
      try {
        // rawUnsignedTx carries the base64 bundled tx from the backend
        // (nonceAdvance + create + approve×threshold + execute + close).
        const tx = SolTransaction.from(
          Buffer.from(vaultSigningData.rawUnsignedTx, 'base64'),
        );
        tx.partialSign(keyKeypair);
        const sigEntry = tx.signatures.find((s) =>
          s.publicKey.equals(keyKeypair.publicKey),
        );
        if (!sigEntry?.signature) {
          throw new Error(
            'Solana partial-sign produced no signature at key slot',
          );
        }
        keySigBase64 = Buffer.from(sigEntry.signature).toString('base64');
      } finally {
        // Zero the raw 64-byte ed25519 secret-key buffer whether signing
        // succeeded or failed. Mirrors the wallet-side cleanup; without
        // this the Uint8Array can linger in V8/Hermes memory long after
        // the hex-string clear at signingKeypair.privKey below.
        secretKey.fill(0);
      }

      // Clear sensitive material
      signingKeypair.privKey = '';
      vaultXpriv = '';
      pwForEncryption = '';

      const responsePayload: Record<string, unknown> = {
        // Reuse signedHex convention for shipping the base64 sig back —
        // wallet-side EnterpriseVaultSignTx receiver doesn't care about
        // the field name; it forwards to the enterprise sign endpoint.
        keySignatureBase64: keySigBase64,
        keyPubKey,
        requestId: vaultSigningData.requestId,
      };

      await postAction(
        'enterprisevaultsigned',
        JSON.stringify(responsePayload),
        vaultSigningData.chain,
        '',
        sspWalletKeyInternalIdentity,
      );

      displayMessage('success', t('home:vault_sign_success'));
      return;
    }

    // EVM vault signing: use enterprise nonce for Schnorr partial signature
    const isEvmChain = blockchainConfig.chainType === 'evm';
    let usedEnterpriseNonce: publicPrivateNonce | null = null;

    // Wallet-only mode: Key's nonce is empty placeholder — skip nonce lookup
    const keyNonceIsPlaceholder =
      vaultSigningData.reservedNonce && !vaultSigningData.reservedNonce.kPublic;

    if (
      isEvmChain &&
      vaultSigningData.reservedNonce &&
      !keyNonceIsPlaceholder
    ) {
      // Load enterprise nonces from Redux store
      let enterpriseNonces: publicPrivateNonce[] = [];
      try {
        if (enterprisePublicNonces) {
          const decrypted = CryptoJS.AES.decrypt(
            enterprisePublicNonces,
            pwForEncryption,
          );
          enterpriseNonces = JSON.parse(
            decrypted.toString(CryptoJS.enc.Utf8),
          ) as publicPrivateNonce[];
        }
      } catch {
        throw new Error('Failed to decrypt enterprise nonces');
      }

      if (enterpriseNonces.length === 0) {
        throw new Error(
          'No enterprise nonces available. Please sync your SSP Key to generate nonces.',
        );
      }

      // Find the reserved nonce by matching public parts
      const reservedNonce = vaultSigningData.reservedNonce;
      let matchIdx = enterpriseNonces.findIndex(
        (n) =>
          n.kPublic === reservedNonce.kPublic &&
          n.kTwoPublic === reservedNonce.kTwoPublic,
      );
      if (matchIdx === -1 && enterpriseNonces.length > 0) {
        // Retry after short delay — storage may need a moment
        console.log(
          '[Vault Signing] Nonce not found on first try, retrying in 2s…',
        );
        await new Promise((r) => setTimeout(r, 2000));
        // Reload from Redux store
        try {
          if (enterprisePublicNonces) {
            const retryDecrypted = CryptoJS.AES.decrypt(
              enterprisePublicNonces,
              pwForEncryption,
            );
            enterpriseNonces = JSON.parse(
              retryDecrypted.toString(CryptoJS.enc.Utf8),
            ) as publicPrivateNonce[];
          }
        } catch {
          // Keep existing nonces from first attempt
        }
        matchIdx = enterpriseNonces.findIndex(
          (n) =>
            n.kPublic === reservedNonce.kPublic &&
            n.kTwoPublic === reservedNonce.kTwoPublic,
        );
      }
      if (matchIdx === -1) {
        const localPrefixes = enterpriseNonces
          .slice(0, 5)
          .map((n) => n.kPublic.slice(0, 8))
          .join(', ');
        console.log(
          `[Vault Signing] NONCE MISMATCH — looking for ${reservedNonce.kPublic.slice(0, 8)}, local pool (${enterpriseNonces.length}): [${localPrefixes}…]`,
        );
        throw new Error(
          'Reserved nonce not found locally. Nonces may be out of sync. Please sync nonces and recreate the proposal.',
        );
      }
      usedEnterpriseNonce = enterpriseNonces[matchIdx];

      // Delete used nonce from local store immediately (never reuse)
      enterpriseNonces.splice(matchIdx, 1);
      const encryptedNonces = CryptoJS.AES.encrypt(
        JSON.stringify(enterpriseNonces),
        pwForEncryption,
      ).toString();
      dispatch(setSspKeyEnterprisePublicNonces(encryptedNonces));
    }

    // Parse M-of-N signing arrays (sent as JSON strings from wallet)
    let parsedAllSignerKeys: string[] | undefined;
    let parsedAllSignerNonces:
      | Array<{ kPublic: string; kTwoPublic: string }>
      | undefined;
    if (vaultSigningData.allSignerKeys) {
      parsedAllSignerKeys =
        typeof vaultSigningData.allSignerKeys === 'string'
          ? (JSON.parse(vaultSigningData.allSignerKeys) as string[])
          : vaultSigningData.allSignerKeys;
    }
    if (vaultSigningData.allSignerNonces) {
      parsedAllSignerNonces =
        typeof vaultSigningData.allSignerNonces === 'string'
          ? (JSON.parse(vaultSigningData.allSignerNonces) as Array<{
              kPublic: string;
              kTwoPublic: string;
            }>)
          : vaultSigningData.allSignerNonces;
    }

    // Parse inputDetails from JSON string (wallet sends as serialized JSON in relay payload)
    const parsedInputDetails: Array<{
      index: number;
      addressIndex: number;
      witnessScript?: string;
      redeemScript?: string;
      amount?: string;
    }> =
      typeof vaultSigningData.inputDetails === 'string'
        ? (JSON.parse(vaultSigningData.inputDetails) as Array<{
            index: number;
            addressIndex: number;
            witnessScript?: string;
            redeemScript?: string;
            amount?: string;
          }>)
        : vaultSigningData.inputDetails;

    if (
      isEvmChain &&
      (usedEnterpriseNonce || keyNonceIsPlaceholder) &&
      vaultSigningData.sigOne != null &&
      parsedAllSignerKeys &&
      parsedAllSignerNonces
    ) {
      // EVM: Complete Schnorr multi-party signing.
      // TRUSTLESS BINDING (parity with the Solana vault path): the approval UI
      // decodes/displays evmUserOp (tx) or signMessage (personal_sign), but the
      // Schnorr sign consumes rawUnsignedTx — a hash the SDK's fromJson trusts
      // and never recomputes. Recompute it on-device from what was DISPLAYED
      // and refuse to sign on mismatch, so a compromised wallet can't show a
      // benign operation while the key co-signs a vault-draining one. The
      // recompute uses the same aa-core entry-point hash the wallet builds
      // with, so a legitimate operation always matches.
      if (vaultSigningData.signMessage !== undefined) {
        if (
          !messageDigestMatches(
            vaultSigningData.signMessage,
            vaultSigningData.rawUnsignedTx,
          )
        ) {
          throw new Error(t('home:err_vault_sign_mismatch'));
        }
      } else if (vaultSigningData.evmUserOp !== undefined) {
        const userOp =
          typeof vaultSigningData.evmUserOp === 'string'
            ? (JSON.parse(vaultSigningData.evmUserOp) as unknown)
            : vaultSigningData.evmUserOp;
        if (
          !userOpHashMatches(userOp, vaultChain, vaultSigningData.rawUnsignedTx)
        ) {
          throw new Error(t('home:err_vault_sign_mismatch'));
        }
      } else {
        // No decodable preimage accompanied the hash — cannot verify what we
        // would sign. Fail closed rather than blind-sign.
        throw new Error(t('home:err_vault_sign_unverifiable'));
      }
      // Derive keypair at the transaction's source address index
      const evmAddressIndex = parsedInputDetails[0]?.addressIndex ?? 0;
      const signingKeypair = generateAddressKeypair(
        vaultXpriv,
        vaultSigningData.vaultIndex,
        evmAddressIndex,
        vaultChain,
      );
      keyPubKey = signingKeypair.pubKey;

      let vaultSchnorrResult: {
        signerContribution: string;
        challenge: string;
      };

      if (vaultSigningData.signingMode === 'wallet_only') {
        // Wallet-only mode: Key doesn't participate in Schnorr signing.
        // Pass through wallet's contribution unchanged.
        console.log(
          '[Vault Signing] Wallet-only EVM mode — skipping Key Schnorr signing',
        );
        vaultSchnorrResult = {
          signerContribution: vaultSigningData.sigOne,
          challenge: '',
        };
      } else {
        // Dual or key_only: Key participates in Schnorr signing.
        // usedEnterpriseNonce is always set here (nonce lookup runs for non-placeholder nonces).
        if (!usedEnterpriseNonce) {
          throw new Error('Enterprise nonce required for EVM vault signing');
        }

        vaultSchnorrResult = continueVaultSigningSchnorrMultisig(
          vaultSigningData.rawUnsignedTx,
          signingKeypair,
          usedEnterpriseNonce,
          parsedAllSignerKeys,
          parsedAllSignerNonces,
          vaultSigningData.sigOne,
        );
      }

      // Clear EVM signing keypair private key
      signingKeypair.privKey = '';

      // Build response with signerContribution + challenge for wallet to forward
      const responsePayload: Record<string, unknown> = {
        signerContribution: vaultSchnorrResult.signerContribution,
        challenge: vaultSchnorrResult.challenge,
        keyPubKey,
        requestId: vaultSigningData.requestId,
      };

      if (usedEnterpriseNonce) {
        responsePayload.usedNonce = {
          kPublic: usedEnterpriseNonce.kPublic,
          kTwoPublic: usedEnterpriseNonce.kTwoPublic,
        };
      }

      await postAction(
        'enterprisevaultsigned',
        JSON.stringify(responsePayload),
        vaultSigningData.chain,
        '',
        sspWalletKeyInternalIdentity,
      );

      // Clear sensitive key material
      vaultXpriv = '';
      pwForEncryption = '';

      displayMessage('success', t('home:vault_sign_success'));
      return; // Early return — EVM vault response already sent (finally handles cleanup)
    } else if (isEvmChain) {
      // EVM chain but missing Schnorr data — cannot sign
      const missing = [];
      if (!usedEnterpriseNonce && !keyNonceIsPlaceholder) missing.push('nonce');
      if (vaultSigningData.sigOne == null) missing.push('sigOne');
      if (!parsedAllSignerKeys) missing.push('signerKeys');
      if (!parsedAllSignerNonces) missing.push('signerNonces');
      throw new Error(`Missing Schnorr signing data: ${missing.join(', ')}`);
    } else if (vaultSigningData.signingMode === 'wallet_only') {
      // UTXO wallet-only: Key doesn't sign, pass through walletSignedHex unchanged
      const walletSignedHex = vaultSigningData.walletSignedHex;
      if (!walletSignedHex) {
        throw new Error('Missing wallet-signed TX hex for UTXO vault signing');
      }

      console.log(
        '[Vault Signing] Wallet-only UTXO mode — skipping Key signing',
      );

      // Derive pubkey for response (no signing needed)
      const firstAddrIdx = parsedInputDetails[0]?.addressIndex ?? 0;
      const pubKeypair = generateAddressKeypair(
        vaultXpriv,
        vaultSigningData.vaultIndex,
        firstAddrIdx,
        vaultChain,
      );
      keyPubKey = pubKeypair.pubKey;
      pubKeypair.privKey = '';

      // Clear sensitive key material
      vaultXpriv = '';
      pwForEncryption = '';

      // Pass through wallet-signed hex unchanged
      const utxoResponsePayload: Record<string, unknown> = {
        signedHex: walletSignedHex,
        keyPubKey,
        requestId: vaultSigningData.requestId,
      };

      await postAction(
        'enterprisevaultsigned',
        JSON.stringify(utxoResponsePayload),
        vaultSigningData.chain,
        '',
        sspWalletKeyInternalIdentity,
      );

      displayMessage('success', t('home:vault_sign_success'));
      return;
    } else {
      // UTXO: SIGHASH-based signing via TransactionBuilder
      // Load the wallet-signed TX and add Key's signatures on top
      const walletSignedHex = vaultSigningData.walletSignedHex;
      if (!walletSignedHex) {
        throw new Error('Missing wallet-signed TX hex for UTXO vault signing');
      }

      const libID = getLibId(vaultChain);
      const network = utxolib.networks[libID];

      // Determine hashType (BCH uses SIGHASH_BITCOINCASHBIP143)
      let hashType = utxolib.Transaction.SIGHASH_ALL;
      if (blockchainConfig.hashType) {
        hashType =
          utxolib.Transaction.SIGHASH_ALL |
          utxolib.Transaction.SIGHASH_BITCOINCASHBIP143;
      }

      // Parse wallet-signed TX into TransactionBuilder
      const signedTx = utxolib.Transaction.fromHex(walletSignedHex, network);
      const txb = utxolib.TransactionBuilder.fromTransaction(signedTx, network);

      // TRUSTLESS BINDING (parity with the Solana vault path): the approval UI
      // decodes/displays rawUnsignedTx, but the key SIGNS the outputs of
      // walletSignedHex. A compromised wallet could show a benign
      // rawUnsignedTx and submit a walletSignedHex with attacker outputs.
      // Assert the OUTPUT SET (value + script) the key is about to commit to
      // matches exactly what was displayed, and refuse on any divergence.
      if (vaultSigningData.rawUnsignedTx) {
        type TxOut = { value: number; script: Buffer };
        const displayedOuts = (
          utxolib.Transaction.fromHex(
            vaultSigningData.rawUnsignedTx,
            network,
          ) as { outs: TxOut[] }
        ).outs;
        const signedOuts = (signedTx as { outs: TxOut[] }).outs;
        const sameOutputs =
          displayedOuts.length === signedOuts.length &&
          displayedOuts.every((out: TxOut, i: number) => {
            const signed = signedOuts[i];
            return (
              out.value === signed.value &&
              Buffer.compare(out.script, signed.script) === 0
            );
          });
        if (!sameOutputs) {
          throw new Error(t('home:err_vault_sign_mismatch'));
        }
      } else {
        // Nothing to verify the signed outputs against — fail closed.
        throw new Error(t('home:err_vault_sign_unverifiable'));
      }

      // Validate input details match TX inputs
      if (parsedInputDetails.length === 0) {
        throw new Error('No input details provided for UTXO vault signing');
      }
      if (parsedInputDetails.length !== txb.inputs.length) {
        throw new Error(
          `Input details count (${parsedInputDetails.length}) does not match transaction inputs (${txb.inputs.length})`,
        );
      }

      // Sign each input with Key's per-address keypair
      for (let i = 0; i < parsedInputDetails.length; i++) {
        const input = parsedInputDetails[i];
        const signingKeypair = generateAddressKeypair(
          vaultXpriv,
          vaultSigningData.vaultIndex,
          input.addressIndex,
          vaultChain,
        );

        if (!keyPubKey) {
          keyPubKey = signingKeypair.pubKey;
        }

        const keyPair = utxolib.ECPair.fromWIF(signingKeypair.privKey, network);

        const witnessScriptBuf = input.witnessScript
          ? Buffer.from(input.witnessScript, 'hex')
          : undefined;
        const redeemScriptBuf = input.redeemScript
          ? Buffer.from(input.redeemScript, 'hex')
          : undefined;
        const amount = input.amount ? Number(input.amount) : 0;

        txb.sign(
          i,
          keyPair,
          redeemScriptBuf,
          hashType,
          amount,
          witnessScriptBuf,
        );

        // Clear per-input private key material
        signingKeypair.privKey = '';
      }

      // Build with both wallet + key sigs (still incomplete if M>1)
      const signedHex = txb.buildIncomplete().toHex();

      // Clear sensitive key material
      vaultXpriv = '';
      pwForEncryption = '';

      // Build response payload with signedHex
      const utxoResponsePayload: Record<string, unknown> = {
        signedHex,
        keyPubKey,
        requestId: vaultSigningData.requestId,
      };

      // Post 'enterprisevaultsigned' action to relay
      await postAction(
        'enterprisevaultsigned',
        JSON.stringify(utxoResponsePayload),
        vaultSigningData.chain,
        '',
        sspWalletKeyInternalIdentity,
      );

      displayMessage('success', t('home:vault_sign_success'));
      return; // Early return — UTXO response already sent (finally handles cleanup)
    }
  } catch (error) {
    // Clear sensitive key material on error path
    vaultXpriv = '';
    pwForEncryption = '';
    mnemonicPhrase = '';
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Vault Signing] Error:', errMsg);
    displayMessage(
      'error',
      `${t('home:err_vault_sign_failed')}: ${errMsg}`,
      8000,
    );
  } finally {
    clearVaultSigningState(); // also discards any in-flight sol decode
    clearVaultSigningRequest?.();
  }
};
export const handleFluxNodeStart = async (
  ctx: HomeActionContext,
  request: Record<string, unknown>,
) => {
  const {
    seedPhrase,
    identityChain,
    postAction,
    sspWalletKeyInternalIdentity,
    displayMessage,
    t,
  } = ctx;
  let collateralPrivKey = '';
  let pwForEncryption = '';
  let mnemonicPhrase = '';
  let vaultXpriv = '';

  const requestId = (request.requestId as string) || '';
  const nodeChain = (request.chain as string) || '';

  try {
    const nodeOrgIndex = request.orgIndex as number;
    const nodeVaultIndex = request.vaultIndex as number;
    const nodeAddressIndex = (request.addressIndex as number) || 0;
    const identityPubKey = request.identityPubKey as string;
    const collateralTxid = request.collateralTxid as string;
    const nodeCollateralVout = request.collateralVout as number;
    const nodeRedeemScript = request.redeemScript as string;
    const nodeDelegates = (request.delegates as string[]) || [];

    if (!nodeChain || !collateralTxid || !identityPubKey || !nodeRedeemScript) {
      console.error('[Enterprise Flux Node] Missing required parameters');
      displayMessage('error', t('home:err_flux_node_missing_params'));
      await postAction(
        'enterprisefluxnodestarted',
        JSON.stringify({
          requestId,
          error: 'Missing required parameters',
        }),
        nodeChain || identityChain,
        '',
        sspWalletKeyInternalIdentity,
      );
      return;
    }

    // Derive Key's vault keypair — following same pattern as handleVaultSignAction
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });

    if (!passwordData || !encryptionKey) {
      throw new Error(t('home:err_flux_node_decrypt'));
    }

    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const passwordDecryptedString = passwordDecrypted.toString(
      CryptoJS.enc.Utf8,
    );
    pwForEncryption = encryptionKey.password + passwordDecryptedString;

    const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
    mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);

    if (!mnemonicPhrase) {
      throw new Error(t('home:err_flux_node_mnemonic'));
    }

    const vaultChain = nodeChain as keyof cryptos;
    const blockchainConfig = blockchains[vaultChain];
    if (!blockchainConfig) {
      throw new Error(t('home:err_flux_node_unsupported_chain'));
    }

    // Derive xpriv at m/48'/coin'/orgIndex'/scriptType'
    vaultXpriv = getMasterXpriv(
      mnemonicPhrase,
      48,
      blockchainConfig.slip,
      nodeOrgIndex,
      blockchainConfig.scriptType,
      vaultChain,
    );

    // Clear mnemonic immediately
    mnemonicPhrase = '';
    pwForEncryption = '';

    // Derive keypair at vaultIndex/addressIndex
    const keypair = generateAddressKeypair(
      vaultXpriv,
      nodeVaultIndex,
      nodeAddressIndex,
      vaultChain,
    );
    collateralPrivKey = keypair.privKey;
    vaultXpriv = '';

    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Build delegate data
    let delegateData;
    if (nodeDelegates.length > 0) {
      delegateData = {
        version: 1,
        type: 1,
        delegatePublicKeys: nodeDelegates,
      };
    }

    // Call startFluxNodev6WithPubKey — uses identity public key directly (no private key needed)
    const signedTxHex = fluxnode.startFluxNodev6WithPubKey(
      collateralTxid,
      nodeCollateralVout,
      collateralPrivKey,
      identityPubKey,
      timestamp,
      true,
      nodeRedeemScript,
      delegateData,
    );

    // Clear sensitive data
    collateralPrivKey = '';

    // Send response back to Wallet
    await postAction(
      'enterprisefluxnodestarted',
      JSON.stringify({ requestId, signedTxHex }),
      nodeChain,
      '',
      sspWalletKeyInternalIdentity,
    );

    displayMessage('success', t('home:flux_node_start_success'));
    console.log('[Enterprise Flux Node] Start signed and sent back');
  } catch (err) {
    collateralPrivKey = '';
    vaultXpriv = '';
    mnemonicPhrase = '';
    pwForEncryption = '';
    console.error('[Enterprise Flux Node] Error:', err);
    await postAction(
      'enterprisefluxnodestarted',
      JSON.stringify({
        requestId,
        error:
          err instanceof Error ? err.message : t('home:err_flux_node_failed'),
      }),
      nodeChain || identityChain,
      '',
      sspWalletKeyInternalIdentity,
    );
  }
};
