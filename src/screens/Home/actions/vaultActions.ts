import * as CryptoJS from 'crypto-js';
import * as Keychain from '../../../lib/keychain';
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
import {
  EnterpriseRequestError,
  assertEnterpriseDerivation,
  checkVaultEvmUserOp,
  fluxNodeAddressIndex,
  inputAddressIndexes,
  parseInputDetails,
  primaryAddressIndex,
  validateFluxNodeStartRequest,
  validateVaultSigningRequest,
  validateVaultXpubRequest,
} from '../../../lib/enterpriseGuards';
import {
  consumeVaultApproval,
  vaultRequestDigest,
} from '../../../lib/vaultApprovalBinding';
import {
  EnterpriseNonceError,
  burnEnterpriseNonce,
  findEnterpriseNonce,
} from '../../../lib/enterpriseNoncePool';
import { isNonceTombstoned } from '../../../lib/enterpriseNonceLedger';
import {
  VaultDescriptorError,
  checkFluxNodeCollateral,
  checkVaultEvmAccount,
  checkVaultUtxoTransaction,
  commitVaultPin,
  fluxNodeRejectionPayload,
  requireVaultDescriptor,
  vaultRejectionCode,
  vaultSignRejectionPayload,
  vaultSolBinding,
  type OwnVaultIdentity,
} from '../../../lib/vaultDescriptorGate';
import { verifyVaultUtxoAmounts } from '../../../lib/vaultUtxoAmounts';
import { cryptos, publicPrivateNonce } from '../../../types';
import type { HomeActionContext } from './types';

/** This device's identity for the vault descriptor checks (VD-3). */
const ownVaultIdentity = (
  ctx: HomeActionContext,
  accountXpub: string | null,
): OwnVaultIdentity => ({
  wkIdentity: ctx.sspWalletKeyInternalIdentity,
  identityPubKey: ctx.sspWalletKeyInternalIdentityPubKey || null,
  accountXpub,
});

/** User-facing text for a refused vault descriptor (VD-3 / VD-4). */
export const vaultDescriptorErrorMessage = (
  error: VaultDescriptorError,
  t: HomeActionContext['t'],
): string => {
  switch (error.code) {
    case 'missing':
      return t('home:err_vault_descriptor_missing');
    case 'mismatch':
      return t('home:err_vault_descriptor_changed');
    case 'unconfirmed':
      return t('home:err_vault_descriptor_unconfirmed');
    default:
      return `${t('home:err_vault_descriptor_invalid')} (${error.message})`;
  }
};

/**
 * This device's own account "xpub" for the vault, computed from its seed:
 * the xpub at m/48'/coin'/orgIndex'/script' (UTXO/EVM, exactly what the xpub
 * request exported), or the JSON array of its 20 ed25519 leaves at
 * [vaultIndex][0..19] (Solana).
 */
const ownVaultAccountXpub = (
  mnemonicPhrase: string,
  vaultXpriv: string,
  chain: keyof cryptos,
  orgIndex: number,
  vaultIndex: number,
): string => {
  const config = blockchains[chain];
  if (config.chainType === 'sol') {
    return JSON.stringify(
      generateSolanaPubkeyArray(vaultXpriv, chain, vaultIndex),
    );
  }
  return getMasterXpub(
    mnemonicPhrase,
    48,
    config.slip,
    orgIndex,
    config.scriptType,
    chain,
  );
};

/** txid:vout:sequence of every input — the spends a signature commits to. */
const inputOutpoints = (tx: {
  ins: Array<{ hash: Buffer; index: number; sequence: number }>;
}): string[] =>
  tx.ins.map(
    (input) =>
      `${Buffer.from(input.hash).toString('hex')}:${input.index}:${input.sequence}`,
  );

/** User-facing text for a nonce-pool failure that aborted a signature. */
const nonceErrorMessage = (
  error: EnterpriseNonceError,
  t: HomeActionContext['t'],
): string => {
  switch (error.code) {
    case 'already_used':
      return t('home:err_vault_nonce_already_used');
    case 'persist_failed':
      return t('home:err_vault_nonce_persist_failed');
    case 'not_found':
      return 'Reserved nonce not found locally. Nonces may be out of sync. Please sync nonces and recreate the proposal.';
    default:
      return error.message;
  }
};

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
    // H-1: the receipt guard again, before anything is decrypted or derived.
    // Only organisation accounts 100'–99999' may be exported — never the
    // consumer account 0' or the recovery account 99'.
    const requestProblem = validateVaultXpubRequest(vaultXpubData);
    if (requestProblem) {
      throw new EnterpriseRequestError(requestProblem);
    }

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
    // H-1, right before derivation: integer org index in [100, 99999] and an
    // integer vault index in [0, 2^31).
    assertEnterpriseDerivation(
      vaultXpubData.orgIndex,
      vaultXpubData.vaultIndex,
    );
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
    displayMessage(
      'error',
      error instanceof EnterpriseRequestError
        ? t('home:err_vault_request_invalid')
        : t('home:err_vault_xpub_failed'),
    );
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
    postAction,
    displayMessage,
    t,
    sspWalletKeyInternalIdentity,
    clearVaultSigningState,
    clearVaultSigningRequest,
  } = ctx;
  if (!vaultSigningData) return;

  // CHN-5: sign only the exact request the user approved on screen. The
  // approval screen arms the digest of the request it displayed; a request
  // the relay swapped in while authentication was open has a different
  // digest and is refused here. The new request stays open for review.
  const requestDigest = vaultRequestDigest(vaultSigningData);
  if (!consumeVaultApproval(requestDigest)) {
    displayMessage('error', t('home:err_vault_request_changed'), 8000);
    return;
  }

  // Sign-time fail-closed recheck for Solana: the Approve button's
  // disabled prop is evaluated at press time, but the byte-decode verdict
  // can land while biometric auth is open (or the press can race the
  // async decode). NEVER partial-sign while the trustless decode is still
  // pending, after it flagged a mismatch, when the bytes were undecodable,
  // or when the verdict belongs to a different request. Keeps the request
  // open — the user sees the banner/disabled state instead of a silent
  // dismissal.
  if (
    blockchains[vaultSigningData.chain as keyof cryptos]?.chainType === 'sol'
  ) {
    if (!solDecodeState) {
      // Decode still pending — Approve is disabled while pending, so this
      // is defensive-only; refuse to sign without a verdict.
      return;
    }
    if (solDecodeState.requestDigest !== requestDigest) {
      displayMessage('error', t('home:err_vault_request_changed'), 8000);
      return;
    }
    if (solDecodeState.mismatch) {
      displayMessage('error', t('home:vault_sign_sol_decode_mismatch'), 8000);
      return;
    }
    if (solDecodeState.kind === 'undecodable') {
      displayMessage('error', t('home:vault_sign_sol_undecodable'), 8000);
      return;
    }
  }

  // Hoist sensitive vars outside try so they can be cleared in catch/finally
  let vaultXpriv = '';
  let pwForEncryption = '';
  let mnemonicPhrase = '';

  try {
    // H-1 / CHN-5: the receipt guard again at sign time — organisation index
    // in [100, 99999], integer vault/address indices, message signing on EVM
    // vaults only. Nothing below runs for a request that fails it.
    const requestProblem = validateVaultSigningRequest(vaultSigningData);
    if (requestProblem) {
      throw new EnterpriseRequestError(requestProblem);
    }
    // Every address index the request will sign at, validated.
    const addressIndexes = inputAddressIndexes(vaultSigningData.inputDetails);
    // VD-3, before anything is decrypted: the request carries the vault
    // descriptor, it verifies, it names this vault, and the vault is pinned
    // (or its pin was confirmed on screen). Throws otherwise.
    requireVaultDescriptor(vaultSigningData, ownVaultIdentity(ctx, null));

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

    // H-1, right before derivation.
    assertEnterpriseDerivation(
      vaultSigningData.orgIndex,
      vaultSigningData.vaultIndex,
      addressIndexes,
    );

    // Derive xpriv at m/48'/coin'/orgIndex'/scriptType'
    vaultXpriv = getMasterXpriv(
      mnemonicPhrase,
      48,
      blockchainConfig.slip,
      vaultSigningData.orgIndex,
      blockchainConfig.scriptType,
      vaultChain,
    );

    // VD-3 in full: this device's own vault xpub (computed from its seed)
    // must be the one the descriptor lists for it. A pin the user confirmed
    // on screen is saved only after EVERY transaction check below passed,
    // right before the nonce burn / signature (commitPinBeforeSigning).
    const vaultCheck = requireVaultDescriptor(
      vaultSigningData,
      ownVaultIdentity(
        ctx,
        ownVaultAccountXpub(
          mnemonicPhrase,
          vaultXpriv,
          vaultChain,
          vaultSigningData.orgIndex,
          vaultSigningData.vaultIndex,
        ),
      ),
    );
    const commitPinBeforeSigning = () =>
      commitVaultPin(vaultCheck, vaultSigningData.vaultName);
    const vaultDescriptor = vaultCheck.descriptor;

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
      // wallet/enterprise-app forwards (validated integer; 0 when the
      // request carries no input details). Must match the index used to
      // derive the on-chain multisig PDA; otherwise the derived pubkey
      // wouldn't be a member and approve_transaction would reject.
      const solAddressIndex = primaryAddressIndex(
        vaultSigningData.inputDetails,
      );
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
      // VD-4: the bytes act on the multisig derived from the pinned vault
      // descriptor at this address index, and this device's own leaf is one
      // of its members.
      const solBinding = vaultSolBinding(vaultDescriptor, solAddressIndex);
      if (solDecodeState?.multisigPda !== solBinding.multisigPda) {
        signingKeypair.privKey = '';
        throw new VaultDescriptorError(
          'invalid',
          'the transaction does not act on this vault',
        );
      }
      if (!solBinding.members.includes(signingKeypair.pubKey)) {
        signingKeypair.privKey = '';
        throw new Error(t('home:err_vault_sign_not_member'));
      }
      // SOL-7: when the decode verified the multisig member set (request
      // members re-derived to the PDA, or read from chain for approve-only),
      // this device's own leaf must be one of them.
      if (
        solDecodeState?.members &&
        !solDecodeState.members.includes(signingKeypair.pubKey)
      ) {
        signingKeypair.privKey = '';
        throw new Error(t('home:err_vault_sign_not_member'));
      }

      // Every check passed: save a pin confirmed on screen, then sign.
      try {
        commitPinBeforeSigning();
      } catch (error) {
        signingKeypair.privKey = '';
        throw error;
      }
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
    // Removes the reserved nonce from the local pool for good. Deliberately
    // deferred until the trustless binding check has passed: burning it up
    // front turned every rejected request into a permanently lost nonce, so
    // the next attempt failed with "nonce not found / out of sync" instead of
    // the real error. K4: it resolves only after the used-nonce ledger and
    // the shrunken pool are on disk, and the partial signature is produced
    // only after it resolves; any failure aborts the signature.
    let consumeReservedNonce: (() => Promise<publicPrivateNonce>) | null = null;

    // Wallet-only mode: Key's nonce is empty placeholder — skip nonce lookup
    const keyNonceIsPlaceholder =
      vaultSigningData.reservedNonce && !vaultSigningData.reservedNonce.kPublic;

    if (
      isEvmChain &&
      vaultSigningData.reservedNonce &&
      !keyNonceIsPlaceholder
    ) {
      const reservedNonce = vaultSigningData.reservedNonce;
      // A nonce this device already signed with is never used again, even
      // if a stale pool write brought it back (K2).
      if (isNonceTombstoned(reservedNonce.kPublic)) {
        throw new Error(t('home:err_vault_nonce_already_used'));
      }

      // K2: read the pool from the store NOW, not the render-time snapshot.
      let localNonce = findEnterpriseNonce(reservedNonce, pwForEncryption);
      if (!localNonce) {
        // Retry after short delay — a replenish may be writing the pool
        console.log(
          '[Vault Signing] Nonce not found on first try, retrying in 2s…',
        );
        await new Promise((r) => setTimeout(r, 2000));
        localNonce = findEnterpriseNonce(reservedNonce, pwForEncryption);
      }
      if (!localNonce) {
        console.log(
          `[Vault Signing] NONCE MISMATCH — looking for ${reservedNonce.kPublic.slice(0, 8)}`,
        );
        throw new Error(
          'Reserved nonce not found locally. Nonces may be out of sync. Please sync nonces and recreate the proposal.',
        );
      }

      const noncePassword = pwForEncryption;
      consumeReservedNonce = () =>
        burnEnterpriseNonce(reservedNonce, noncePassword);
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

    // Input details (JSON string or array in the relay payload); every
    // addressIndex was validated above.
    const parsedInputDetails = parseInputDetails(
      vaultSigningData.inputDetails,
    ).map((entry, i) => ({
      addressIndex: addressIndexes[i],
      witnessScript:
        typeof entry.witnessScript === 'string'
          ? entry.witnessScript
          : undefined,
      redeemScript:
        typeof entry.redeemScript === 'string' ? entry.redeemScript : undefined,
      amount:
        typeof entry.amount === 'string' || typeof entry.amount === 'number'
          ? String(entry.amount)
          : undefined,
    }));

    if (
      isEvmChain &&
      (consumeReservedNonce || keyNonceIsPlaceholder) &&
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
      let evmSender: unknown;
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
        // EVM call-safety (C-4): one flat operation, `execute` only, no call
        // to the vault account itself, no upgrade selector, no payable
        // contract call. The hash is then checked over that same object —
        // with this device's own EntryPoint and chainId (userOpVerify).
        const safety = checkVaultEvmUserOp(vaultSigningData.evmUserOp);
        if (!safety.ok) {
          throw new Error(
            `${t('home:err_vault_sign_unsafe_call')}: ${safety.reason}`,
          );
        }
        if (
          !userOpHashMatches(
            safety.userOp,
            vaultChain,
            vaultSigningData.rawUnsignedTx,
          )
        ) {
          throw new Error(t('home:err_vault_sign_mismatch'));
        }
        evmSender = safety.userOp.sender;
      } else {
        // No decodable preimage accompanied the hash — cannot verify what we
        // would sign. Fail closed rather than blind-sign.
        throw new Error(t('home:err_vault_sign_unverifiable'));
      }
      // VD-4: the operation's sender is the vault account derived from the
      // pinned descriptor at this address index, and every Schnorr signer
      // key is one of that vault's keys (message signing: the keys).
      const evmAddressIndex = primaryAddressIndex(
        vaultSigningData.inputDetails,
      );
      // Derive keypair at the transaction's source address index
      const signingKeypair = generateAddressKeypair(
        vaultXpriv,
        vaultSigningData.vaultIndex,
        evmAddressIndex,
        vaultChain,
      );
      keyPubKey = signingKeypair.pubKey;
      // When this device signs (not wallet-only), its OWN key must be one of
      // the request's signer keys — every one of which is a key of the
      // pinned vault, without duplicates (wallet parity).
      const evmVaultProblem = checkVaultEvmAccount(
        vaultDescriptor,
        evmAddressIndex,
        evmSender,
        parsedAllSignerKeys,
        vaultSigningData.signingMode === 'wallet_only'
          ? undefined
          : signingKeypair.pubKey,
      );
      if (evmVaultProblem) {
        signingKeypair.privKey = '';
        throw new VaultDescriptorError('invalid', evmVaultProblem);
      }
      // Every check passed: save a pin confirmed on screen before the nonce
      // is burned and anything is signed.
      try {
        commitPinBeforeSigning();
        // Binding verified — burn the reserved nonce now (durably: ledger
        // entry + flushed pool), before any partial signature is produced
        // with it. A failure here aborts: nothing is signed or sent.
        if (consumeReservedNonce) {
          usedEnterpriseNonce = await consumeReservedNonce();
        }
      } catch (error) {
        signingKeypair.privKey = '';
        throw error;
      }

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
      if (!consumeReservedNonce && !keyNonceIsPlaceholder) {
        missing.push('nonce');
      }
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
      // VD-4: even a pass-through approval is only given for a transaction
      // that spends this vault's addresses.
      const passThroughCheck = checkVaultUtxoTransaction(
        vaultDescriptor,
        vaultSigningData.rawUnsignedTx,
        vaultSigningData.inputDetails,
      );
      if (!passThroughCheck.ok) {
        throw new VaultDescriptorError('invalid', passThroughCheck.reason);
      }
      // ...with verified input amounts and a capped fee (item 2).
      const passThroughAmounts = await verifyVaultUtxoAmounts(
        vaultChain,
        vaultSigningData.rawUnsignedTx,
        vaultSigningData.inputDetails,
        passThroughCheck.inputs,
      );
      if (!passThroughAmounts.ok) {
        throw new Error(passThroughAmounts.reason);
      }
      commitPinBeforeSigning();

      console.log(
        '[Vault Signing] Wallet-only UTXO mode — skipping Key signing',
      );

      // Derive pubkey for response (no signing needed)
      const firstAddrIdx = addressIndexes[0] ?? 0;
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

      // VD-4: every input spends a vault address derived from the pinned
      // descriptor (its scripts are re-derived, never taken from the relay),
      // and every non-change output is one the screen showed as a recipient.
      const utxoCheck = checkVaultUtxoTransaction(
        vaultDescriptor,
        vaultSigningData.rawUnsignedTx,
        vaultSigningData.inputDetails,
      );
      if (!utxoCheck.ok) {
        throw new VaultDescriptorError('invalid', utxoCheck.reason);
      }
      // Again at sign time: every input amount verified (hash-checked
      // previous transactions on DOGE/RVN) and the fee within the vault cap.
      // The key signs with exactly these amounts.
      const amountCheck = await verifyVaultUtxoAmounts(
        vaultChain,
        vaultSigningData.rawUnsignedTx,
        vaultSigningData.inputDetails,
        utxoCheck.inputs,
      );
      if (!amountCheck.ok) {
        throw new Error(amountCheck.reason);
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
        type TxIn = { hash: Buffer; index: number; sequence: number };
        const displayedTx = utxolib.Transaction.fromHex(
          vaultSigningData.rawUnsignedTx,
          network,
        ) as { outs: TxOut[]; ins: TxIn[] };
        const displayedOuts = displayedTx.outs;
        const signedOuts = (signedTx as { outs: TxOut[] }).outs;
        // The key also commits to the inputs: the wallet-signed transaction
        // must spend exactly the displayed (and verified) outpoints — extra or
        // different vault inputs would turn into an unseen fee.
        if (
          inputOutpoints(displayedTx).join(',') !==
          inputOutpoints(signedTx as { ins: TxIn[] }).join(',')
        ) {
          throw new Error(t('home:err_vault_sign_mismatch'));
        }
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

      // Every check passed: save a pin confirmed on screen, then sign.
      commitPinBeforeSigning();

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

        // Scripts re-derived from the pinned descriptor (VD-4), equal to the
        // relay's inputDetails by the check above.
        const derivedScripts = utxoCheck.inputs[i];
        const witnessScriptBuf = derivedScripts.witnessScript
          ? Buffer.from(derivedScripts.witnessScript, 'hex')
          : undefined;
        const redeemScriptBuf = derivedScripts.redeemScript
          ? Buffer.from(derivedScripts.redeemScript, 'hex')
          : undefined;
        const amount = amountCheck.amounts[i];

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
    const errMsg =
      error instanceof EnterpriseNonceError
        ? nonceErrorMessage(error, t)
        : error instanceof VaultDescriptorError
          ? vaultDescriptorErrorMessage(error, t)
          : error instanceof EnterpriseRequestError
            ? `${t('home:err_vault_request_invalid')} (${error.message})`
            : error instanceof Error
              ? error.message
              : 'Unknown error';
    console.error('[Vault Signing] Error:', errMsg);
    displayMessage(
      'error',
      `${t('home:err_vault_sign_failed')}: ${errMsg}`,
      8000,
    );
    // A vault descriptor refusal is answered with a machine-readable code so
    // SSP Wallet can tell the app why (instead of waiting for a timeout).
    if (error instanceof VaultDescriptorError) {
      try {
        await postAction(
          'enterprisevaultsignrejected',
          JSON.stringify(
            vaultSignRejectionPayload(
              vaultSigningData.requestId,
              vaultRejectionCode(error.code),
              errMsg,
            ),
          ),
          ctx.identityChain,
          '',
          sspWalletKeyInternalIdentity,
        );
      } catch (postError) {
        console.error('[Vault Signing] Rejection not delivered:', postError);
      }
    }
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
    const identityPubKey = request.identityPubKey as string;
    const collateralTxid = request.collateralTxid as string;
    const nodeRedeemScript = request.redeemScript as string;

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

    // H-1: organisation index in [100, 99999], integer vault/address
    // indices, integer collateral output — before anything is decrypted. An
    // org index of 0 or 99 would sign the start with the consumer or
    // recovery account's collateral key.
    const requestProblem = validateFluxNodeStartRequest(request);
    if (requestProblem) {
      console.error('[Enterprise Flux Node] Refused:', requestProblem);
      displayMessage('error', t('home:err_vault_request_invalid'));
      await postAction(
        'enterprisefluxnodestarted',
        JSON.stringify({
          requestId,
          error: `Request refused: ${requestProblem}`,
        }),
        nodeChain,
        '',
        sspWalletKeyInternalIdentity,
      );
      return;
    }
    const nodeOrgIndex = request.orgIndex as number;
    const nodeVaultIndex = request.vaultIndex as number;
    const nodeAddressIndex = fluxNodeAddressIndex(request);
    const nodeCollateralVout = request.collateralVout as number;
    const nodeDelegates = Array.isArray(request.delegates)
      ? (request.delegates as string[])
      : [];

    // VD-3 / VD-4 before anything is decrypted: the request carries the
    // pinned (or on-screen confirmed) vault descriptor, and the collateral
    // script and address are the vault address derived from it.
    try {
      const nodeVault = requireVaultDescriptor(
        request,
        ownVaultIdentity(ctx, null),
      );
      const collateralProblem = checkFluxNodeCollateral(
        nodeVault.descriptor,
        nodeAddressIndex,
        nodeRedeemScript,
        request.collateralAddress,
      );
      if (collateralProblem) {
        throw new VaultDescriptorError('invalid', collateralProblem);
      }
    } catch (error) {
      const message =
        error instanceof VaultDescriptorError
          ? vaultDescriptorErrorMessage(error, t)
          : t('home:err_vault_request_invalid');
      console.error('[Enterprise Flux Node] Refused:', message);
      displayMessage('error', message, 8000);
      await postAction(
        'enterprisefluxnodestarted',
        JSON.stringify(
          fluxNodeRejectionPayload(
            requestId,
            `Request refused: ${message}`,
            vaultRejectionCode(
              error instanceof VaultDescriptorError ? error.code : 'invalid',
            ),
          ),
        ),
        nodeChain,
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

    // H-1, right before derivation.
    assertEnterpriseDerivation(nodeOrgIndex, nodeVaultIndex, [
      nodeAddressIndex,
    ]);

    // Derive xpriv at m/48'/coin'/orgIndex'/scriptType'
    vaultXpriv = getMasterXpriv(
      mnemonicPhrase,
      48,
      blockchainConfig.slip,
      nodeOrgIndex,
      blockchainConfig.scriptType,
      vaultChain,
    );

    // VD-3 in full (own vault xpub). A pin confirmed on screen is saved
    // only right before the collateral key signs. The signing path
    // m/48'/coin'/orgIndex'/script'/vaultIndex/addressIndex is then a key of
    // the pinned vault.
    const nodeVaultCheck = requireVaultDescriptor(
      request,
      ownVaultIdentity(
        ctx,
        ownVaultAccountXpub(
          mnemonicPhrase,
          vaultXpriv,
          vaultChain,
          nodeOrgIndex,
          nodeVaultIndex,
        ),
      ),
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

    // Every check passed: save a pin confirmed on screen, then sign.
    commitVaultPin(
      nodeVaultCheck,
      typeof request.vaultName === 'string' ? request.vaultName : undefined,
    );

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
    if (err instanceof VaultDescriptorError) {
      displayMessage('error', vaultDescriptorErrorMessage(err, t), 8000);
    }
    await postAction(
      'enterprisefluxnodestarted',
      JSON.stringify(
        fluxNodeRejectionPayload(
          requestId,
          err instanceof VaultDescriptorError
            ? `Request refused: ${vaultDescriptorErrorMessage(err, t)}`
            : err instanceof Error
              ? err.message
              : t('home:err_flux_node_failed'),
          err instanceof VaultDescriptorError
            ? vaultRejectionCode(err.code)
            : null,
        ),
      ),
      nodeChain || identityChain,
      '',
      sspWalletKeyInternalIdentity,
    );
  }
};
