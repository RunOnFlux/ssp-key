import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { sspConfig } from '@storage/ssp';
import { blockchains } from '@storage/blockchains';
import {
  generateMultisigAddress,
  generateAddressKeypair,
  generatePublicNonce,
  deriveEVMPublicKey,
} from '../../../lib/wallet';
import {
  signTransaction,
  finaliseTransaction,
  broadcastTx,
  signAndBroadcastEVM,
  selectPublicNonce,
  cosignAndBroadcastSOLTransaction,
  RelayAuthUnavailableError,
} from '../../../lib/constructTx';
import { continueSigningSchnorrMultisig } from '../../../lib/evmSigning';
import { parseTypedData, typedDataMatchesChain } from '../../../lib/typedData';
import {
  consumeEvmSigningApproval,
  evmSigningRequestDigest,
} from '../../../lib/evmSigningApproval';
import { signMessage } from '../../../lib/relayAuth';
import {
  checkWkSigningRequest,
  deriveIdentityPubKeyFromXpub,
} from '../../../lib/wkMessage';
import { getCryptoUsdRate } from '../../../lib/rates';
import {
  buildEip191Preimage,
  parseConsumerDerivationPath,
  parseEip191Preimage,
} from '../../../lib/consumerGuards';
import { verifyConsumerUtxoTransaction } from '../../../lib/consumerUtxo';
import {
  parseConsumerSolanaPayload,
  resolveConsumerSolanaLeaves,
} from '../../../lib/consumerSolana';
import {
  assertConsumerEvmFeeWithinCap,
  verifyConsumerEvmRequest,
} from '../../../lib/consumerEvm';
import {
  consumerUtxoDeps,
  decodeEVMTransactionForApproval,
} from '../../../lib/transactions';
import { setSspKeyPublicNonces } from '../../../store/ssp';
import { persistor } from '../../../store';
import {
  recordUsedNonce,
  withoutTombstoned,
} from '../../../lib/enterpriseNonceLedger';
import { cryptos, utxo, publicNonce, publicPrivateNonce } from '../../../types';
import type { HomeActionContext } from './types';

/**
 * K4: make a consumer Schnorr nonce burn durable BEFORE any partial signature
 * is computed with it. MuSig2 leaks the key once one nonce pair signs three
 * messages, so a burn that only lives in memory (lost on a crash or kill
 * between signing and redux-persist's next write) is not a burn.
 *
 * Order: tombstone in the used-nonce ledger (synchronous, read-back
 * verified), shrink the pool, then flush redux-persist to MMKV. Any failure
 * throws, so the caller never signs or sends.
 */
async function burnConsumerNonce(
  dispatch: HomeActionContext['dispatch'],
  kPublic: string,
  remainingPoolCiphertext: string,
): Promise<void> {
  recordUsedNonce(kPublic);
  dispatch(setSspKeyPublicNonces(remainingPoolCiphertext));
  await persistor.flush();
}

export const generateAddressDetailsForSending = (
  chain: keyof cryptos,
  path: string,
  decryptedXpubWallet: string,
  decryptedXpubKey: string,
) => {
  // KEY-8: only the receive (0) / change (1) branches are consumer paths.
  const { typeIndex, addressIndex } = parseConsumerDerivationPath(path);
  const addrInfo = generateMultisigAddress(
    decryptedXpubWallet,
    decryptedXpubKey,
    typeIndex,
    addressIndex,
    chain,
  );
  const addrDetails = {
    address: addrInfo.address,
    redeemScript: addrInfo.redeemScript,
    witnessScript: addrInfo.witnessScript,
  };
  return addrDetails;
};
export const approvePublicNoncesAction = async (
  ctx: HomeActionContext,
  chain: keyof cryptos,
) => {
  const {
    dispatch,
    postAction,
    displayMessage,
    sspWalletKeyInternalIdentity,
    setPNonces,
    setPublicNoncesReq,
    setPublicNoncesShared,
  } = ctx;
  try {
    const ppNonces = [];
    // generate and replace nonces
    for (let i = 0; i < 50; i += 1) {
      // max 50 txs
      const nonce = generatePublicNonce();
      ppNonces.push(nonce);
    }
    // get from keychain
    // encryption key
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });
    if (!passwordData || !encryptionKey) {
      throw new Error('Unable to decrypt stored data');
    }
    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const passwordDecryptedString = passwordDecrypted.toString(
      CryptoJS.enc.Utf8,
    );
    const pwForEncryption = encryptionKey.password + passwordDecryptedString;
    const stringifiedNonces = JSON.stringify(ppNonces);
    const encryptedNonces = CryptoJS.AES.encrypt(
      stringifiedNonces,
      pwForEncryption,
    ).toString();
    dispatch(setSspKeyPublicNonces(encryptedNonces));
    // on publicNonces delete k and kTwo, leave only public parts
    const pNs: publicNonce[] = ppNonces.map((nonce) => ({
      kPublic: nonce.kPublic,
      kTwoPublic: nonce.kTwoPublic,
    }));
    try {
      await postAction(
        'publicnonces',
        JSON.stringify(pNs),
        chain,
        '',
        sspWalletKeyInternalIdentity,
      );
    } catch (error) {
      // we can ignore this error and show success message as user can copy the nonces
      displayMessage(
        'error',
        // @ts-expect-error 'error' is of type 'unknown'
        error.message ?? 'home:err_sharing_public_nonces',
      );
      console.log(error);
    }
    setPNonces(JSON.stringify(pNs));
    setPublicNoncesReq('');
    setTimeout(() => {
      setPublicNoncesShared(true); // display
    }, 100);
  } catch (error) {
    displayMessage(
      'error',
      // @ts-expect-error 'error' is of type 'unknown'
      error.message ?? 'home:err_generating_public_nonces',
    );
    console.log(error);
  }
};
export const approveTransaction = async (
  ctx: HomeActionContext,
  rawTransaction: string,
  chain: keyof cryptos,
  derivationPath: string,
  suggestedUtxos: utxo[],
) => {
  const {
    xpubKey,
    xpubWallet,
    xprivKey,
    publicNonces,
    dispatch,
    postAction,
    createWkAuth,
    displayMessage,
    t,
    sspWalletKeyInternalIdentity,
    setSubmittingTransaction,
    setRawTx,
    setTxPath,
    setTxUtxos,
    setTxid,
  } = ctx;
  try {
    console.log('tx request');
    setSubmittingTransaction(true);
    // get from keychain
    // encryption key
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });
    if (!passwordData || !encryptionKey) {
      throw new Error('Unable to decrypt stored data');
    }
    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const passwordDecryptedString = passwordDecrypted.toString(
      CryptoJS.enc.Utf8,
    );
    const pwForEncryption = encryptionKey.password + passwordDecryptedString;

    const xpubk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
    const xpubKeyDecrypted = xpubk.toString(CryptoJS.enc.Utf8);
    const xpubw = CryptoJS.AES.decrypt(xpubWallet, pwForEncryption);
    const xpubKeyWalletDecrypted = xpubw.toString(CryptoJS.enc.Utf8);
    if (!xpubKeyDecrypted || !xpubKeyWalletDecrypted) {
      throw new Error('Unable to decrypt stored data');
    }
    // Everything below is bound to the key's OWN derivation for this path
    // (wallet xpub stored at pairing + own xpub). The request's `utxos`,
    // embedded scripts, public keys and hashes are never trusted.
    const keyMaterial = {
      path: derivationPath,
      xpubWallet: xpubKeyWalletDecrypted,
      xpubKey: xpubKeyDecrypted,
    };
    // Request-supplied UTXO values are deliberately unused (H-2 / UTXO-4):
    // fee and signing values come from the key's own lookup.
    void suggestedUtxos;

    // KEY-8: refuses typeIndex other than 0 / 1 before any key is derived.
    const { typeIndex, addressIndex } =
      parseConsumerDerivationPath(derivationPath);

    const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
    const xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);

    const keyPair = generateAddressKeypair(
      xprivKeyDecrypted,
      typeIndex,
      addressIndex,
      chain,
    );
    let ttxid = '';
    if (blockchains[chain].chainType === 'evm') {
      // EVM-8 / K5: recompute the userOp hash from the displayed operation
      // with this device's EntryPoint + chainId, and bind the signer set and
      // sender to the stored xpubs — BEFORE a nonce is burned.
      const verifiedEvm = verifyConsumerEvmRequest(
        rawTransaction,
        chain,
        keyMaterial,
      );
      // Item 7: the same fee cap the approval screen applied, before a nonce
      // is burned.
      assertConsumerEvmFeeWithinCap(
        rawTransaction,
        chain,
        await getCryptoUsdRate(chain).catch(() => 0),
      );
      // C-4: the same call-safety rules the approval screen applied.
      const decodedEvm = await decodeEVMTransactionForApproval(
        rawTransaction,
        chain,
      );
      if (decodedEvm.amount === 'decodingError') {
        throw new Error(decodedEvm.error ?? t('home:err_tx_decode'));
      }
      const pNs = CryptoJS.AES.decrypt(publicNonces, pwForEncryption);
      const pNsDecrypted = pNs.toString(CryptoJS.enc.Utf8);
      // Nonces already recorded as used never sign again, even if a stale
      // pool write brought them back.
      const pubNonces = withoutTombstoned(
        JSON.parse(pNsDecrypted) as publicPrivateNonce[],
      );
      const publicNonceKey = selectPublicNonce(rawTransaction, pubNonces);
      // crucial delete nonce from publicNonces
      const newPublicNonces = pubNonces.filter(
        (nonce: publicPrivateNonce) => nonce.kPublic !== publicNonceKey.kPublic,
      );
      // encrypt and save new publicNonces
      const stringifiedNonces = JSON.stringify(newPublicNonces);
      const encryptedNonces = CryptoJS.AES.encrypt(
        stringifiedNonces,
        pwForEncryption,
      ).toString();
      // K4: the burn is on disk before any partial signature exists.
      await burnConsumerNonce(
        dispatch,
        publicNonceKey.kPublic,
        encryptedNonces,
      );
      // sign and broadcast
      ttxid = await signAndBroadcastEVM(
        rawTransaction,
        chain,
        keyPair.privKey as `0x${string}`,
        publicNonceKey,
        verifiedEvm,
      );
    } else if (blockchains[chain].chainType === 'sol') {
      // Wallet pre-signed the outer tx with its leaf. The key re-runs the
      // fail-closed consumer decode on the exact bytes (bound to its own
      // vault, both leaves derived from stored keys) inside
      // cosignAndBroadcastSOLTransaction, then adds its leaf signature.
      // SPL sends arrive JSON-wrapped (`{ unsignedTxBase64, tokenMint,
      // splRecipientOwner, splMint, ...}`); bare base64 from older wallets.
      const payload = parseConsumerSolanaPayload(rawTransaction);
      const leaves = resolveConsumerSolanaLeaves(
        xpubKeyWalletDecrypted,
        xpubKeyDecrypted,
        derivationPath,
      );
      const usdRate = await getCryptoUsdRate(chain);
      ttxid = await cosignAndBroadcastSOLTransaction({
        chain,
        payload,
        leaves,
        keyPrivKeyHex: keyPair.privKey,
        relayHost: sspConfig().relay,
        usdRate,
        wkIdentity: sspWalletKeyInternalIdentity,
        createAuth: (body) =>
          createWkAuth('action', sspWalletKeyInternalIdentity, body),
      });
    } else {
      // C-2 / H-2 / UTXO-5 / UTXO-8: re-verify scripts, values, fee cap and
      // the wallet's signatures against the key's own data, then sign with
      // exactly those values.
      const verifiedUtxo = await verifyConsumerUtxoTransaction(
        rawTransaction,
        chain,
        keyMaterial,
        consumerUtxoDeps,
      );
      const signedTx = signTransaction(
        rawTransaction,
        chain,
        keyPair.privKey,
        verifiedUtxo,
      );
      const finalTx = finaliseTransaction(signedTx, chain);
      ttxid = await broadcastTx(finalTx, chain);
    }
    setRawTx('');
    setTxPath('');
    setTxUtxos([]);
    try {
      await postAction(
        'txid',
        ttxid,
        chain,
        derivationPath,
        sspWalletKeyInternalIdentity,
      );
    } catch (error) {
      // The transaction is already broadcast at this point — a failed relay
      // notification must never make a successful transfer look failed.
      // SSP Wallet picks the transaction up from the chain on its own sync.
      console.log(error);
      displayMessage('info', t('home:warn_tx_sent_notify_failed'), 6000);
    }
    setTxid(ttxid);
  } catch (error) {
    const txErrMsg =
      error instanceof RelayAuthUnavailableError
        ? t('home:err_relay_auth_unavailable')
        : error instanceof Error
          ? error.message
          : t('home:err_tx_failed');
    displayMessage('error', txErrMsg);
    console.log(error);
  } finally {
    setSubmittingTransaction(false);
  }
};
export const handleSignWkAction = async (ctx: HomeActionContext) => {
  const {
    wkSigningData,
    identityChainState,
    identityChain,
    sspWalletKeyInternalIdentityPubKey,
    postAction,
    sspWalletKeyInternalIdentity,
    displayMessage,
    t,
    setWkSigningData,
    clearWkSigningRequest,
  } = ctx;
  if (!wkSigningData) return;

  let refused = false;
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
    const pwForEncryption = encryptionKey.password + passwordDecryptedString;

    // Get the identity chain state
    const { xprivKey: idXprivKey, xpubWallet: idXpubWallet } =
      identityChainState || {};
    if (!idXprivKey) {
      throw new Error('xprivKey not available');
    }

    // H-7 / KEY-1: re-check right before signing — the message must classify
    // as an SSP login / critical action / generic sign-in (never a vault-xpub,
    // chain-sync or recovery attestation, never relay-auth JSON), and it must
    // carry a valid signature by the PAIRED wallet's identity key, which this
    // device derives itself from the wallet identity xpub stored at pairing.
    const walletIdentityXpub = idXpubWallet
      ? CryptoJS.AES.decrypt(idXpubWallet, pwForEncryption).toString(
          CryptoJS.enc.Utf8,
        )
      : '';
    const check = checkWkSigningRequest({
      request: wkSigningData,
      ownWkIdentity: sspWalletKeyInternalIdentity,
      pairedWalletIdentityPubKey: deriveIdentityPubKeyFromXpub(
        walletIdentityXpub,
        blockchains[identityChain].bip32,
      ),
      messagePrefix: blockchains[identityChain].messagePrefix,
    });
    if (!check.ok) {
      refused = true;
      throw new Error(`WK signing request refused: ${check.reason}`);
    }

    // Decrypt xpriv for signing
    const xprivDecrypted = CryptoJS.AES.decrypt(idXprivKey, pwForEncryption);
    const xprivKeyDecrypted = xprivDecrypted.toString(CryptoJS.enc.Utf8);
    if (!xprivKeyDecrypted) {
      throw new Error('Failed to decrypt xprivKey');
    }

    // Generate identity keypair for signing (typeIndex=10 for internal identity)
    const identityKeypair = generateAddressKeypair(
      xprivKeyDecrypted,
      10,
      0,
      identityChain,
    );

    // Sign the message using Bitcoin message signing
    const signature = signMessage(
      wkSigningData.message,
      identityKeypair.privKey,
      identityChain,
    );

    // Create the response payload
    const responsePayload = {
      keySignature: signature,
      keyPubKey: sspWalletKeyInternalIdentityPubKey,
      requestId: wkSigningData.requestId,
      message: wkSigningData.message,
    };

    // Post 'wksigned' action to relay
    await postAction(
      'wksigned',
      JSON.stringify(responsePayload),
      identityChain,
      '',
      sspWalletKeyInternalIdentity,
    );

    displayMessage('success', t('home:wk_signing_success'));
  } catch (error) {
    console.error('[WK Signing] Error:', error);
    if (refused) {
      displayMessage('error', t('home:err_wk_request_refused'));
      // Tell the wallet right away instead of letting it wait out its timeout.
      postAction(
        'wksigningrejected',
        '{}',
        identityChain,
        '',
        sspWalletKeyInternalIdentity,
      ).catch((postError) => console.log(postError));
    } else {
      displayMessage('error', t('home:err_signing_failed'));
    }
  } finally {
    setWkSigningData(null);
    clearWkSigningRequest?.();
  }
};
export const handleSignEVMAction = async (ctx: HomeActionContext) => {
  const {
    evmSigningData,
    publicNonces,
    xprivKey,
    xpubWallet,
    dispatch,
    postAction,
    displayMessage,
    t,
    sspWalletKeyInternalIdentity,
    setEvmSigningSignature,
    setActiveChain,
    identityChain,
    setEvmSigningData,
    evmSigningRequest,
    clearEvmSigningRequest,
  } = ctx;
  // Handle both socket-received and scanned/manual EVM signing requests requests
  if (!evmSigningData) return;

  // Item 4: sign only the exact request the user approved on screen. A
  // request swapped in while authentication was open has another digest and
  // is refused here, before any nonce is touched; it stays open for review.
  if (!consumeEvmSigningApproval(evmSigningRequestDigest(evmSigningData))) {
    displayMessage('error', t('home:err_vault_request_changed'), 8000);
    return;
  }

  // Hoist sensitive vars so they can be cleared in catch/finally
  let pwForEncryption = '';
  let xprivKeyDecrypted = '';

  try {
    console.log(
      '[EVM Signing] handleSignEVMAction for chain:',
      evmSigningData.chain,
    );
    // EVM signing with nonce management - same as approveTransaction
    const encryptionKey = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });

    if (!passwordData || !encryptionKey) {
      throw new Error('Unable to decrypt stored data');
    }

    const passwordDecrypted = CryptoJS.AES.decrypt(
      passwordData.password,
      encryptionKey.password,
    );
    const passwordDecryptedString = passwordDecrypted.toString(
      CryptoJS.enc.Utf8,
    );
    pwForEncryption = encryptionKey.password + passwordDecryptedString;

    // KEY-8: consumer signing keys live on branch 0 / 1 only.
    const { typeIndex, addressIndex } = parseConsumerDerivationPath(
      evmSigningData.walletInUse,
    );
    if (
      blockchains[evmSigningData.chain as keyof cryptos]?.chainType !== 'evm'
    ) {
      throw new Error('Not an EVM chain');
    }
    // AA-2: the accepted payloads are an EIP-191 personal message (the
    // preimage is rebuilt from the text the approval screen displayed) and,
    // when the request says so, EIP-712 typed data (the digest is recomputed
    // from the typed data the screen displayed). Anything else (raw strings,
    // `\x19\x01…` bytes, an unknown messageType) is refused BEFORE a nonce
    // is burned — never a signature over a digest taken from the request.
    const messageType = evmSigningData.messageType;
    if (messageType !== undefined && messageType !== 'eip712') {
      throw new Error('Unsupported message type');
    }
    let dataToSign: string;
    if (messageType === 'eip712') {
      // chainId exists only on EVM chain configs (checked above).
      const chainConfig = blockchains[
        evmSigningData.chain as keyof cryptos
      ] as { chainId?: string };
      if (
        !typedDataMatchesChain(
          parseTypedData(evmSigningData.data),
          chainConfig.chainId,
        )
      ) {
        throw new Error('Typed data is for another chain');
      }
      dataToSign = evmSigningData.data;
    } else {
      dataToSign = buildEip191Preimage(
        parseEip191Preimage(evmSigningData.data),
      );
    }

    // Use the same nonce management as normal transactions
    const pNs = CryptoJS.AES.decrypt(publicNonces, pwForEncryption);
    const pNsDecrypted = pNs.toString(CryptoJS.enc.Utf8);
    // Nonces recorded as used never sign again (resurrection backstop).
    const pubNonces = withoutTombstoned(
      JSON.parse(pNsDecrypted) as publicPrivateNonce[],
    );

    // const EVMSigningRequest = {
    //   sigOne: result.sigOne,
    //   challenge: result.challenge,
    //   pubNoncesOne: result.pubNoncesOne, // this is wallet
    //   pubNoncesTwo: result.pubNoncesTwo, // this is key
    //   data: message,
    //   chain: activeChain,
    //   walletInUse: walletInUse,
    //   requestId: requestId,
    // };

    const publicNonceKey = evmSigningData.pubNoncesTwo;
    console.log(`publicNonceKey:`, publicNonceKey);

    const noncesToUse = pubNonces.find(
      (nonce) =>
        nonce.kPublic === publicNonceKey?.kPublic &&
        nonce.kTwoPublic === publicNonceKey?.kTwoPublic,
    );
    console.log('[EVM Signing] nonce matched:', !!noncesToUse);

    if (!noncesToUse) {
      throw new Error('Nonces not found');
    }

    // crucial delete nonce from publicNonces - same as normal transactions
    const newPublicNonces = pubNonces.filter(
      (nonce: publicPrivateNonce) => nonce.kPublic !== publicNonceKey?.kPublic,
    );

    // encrypt and save new publicNonces
    const stringifiedNonces = JSON.stringify(newPublicNonces);
    const encryptedNonces = CryptoJS.AES.encrypt(
      stringifiedNonces,
      pwForEncryption,
    ).toString();
    // K4: the burn is on disk before the partial signature is computed.
    await burnConsumerNonce(dispatch, noncesToUse.kPublic, encryptedNonces);

    const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
    xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);

    const keyPair = generateAddressKeypair(
      xprivKeyDecrypted,
      typeIndex,
      addressIndex,
      evmSigningData.chain as keyof cryptos,
    );

    // Clear private key immediately after use
    xprivKeyDecrypted = '';

    const xpubw = CryptoJS.AES.decrypt(xpubWallet, pwForEncryption);
    const xpubKeyWalletDecrypted = xpubw.toString(CryptoJS.enc.Utf8);

    // Clear encryption password — no longer needed
    pwForEncryption = '';

    const publicKeyWallet = deriveEVMPublicKey(
      xpubKeyWalletDecrypted,
      typeIndex,
      addressIndex,
      evmSigningData.chain as keyof cryptos,
    ); // ssp wallet

    const result = continueSigningSchnorrMultisig(
      dataToSign,
      keyPair,
      publicKeyWallet,
      evmSigningData.pubNoncesOne || {
        kPublic: '',
        kTwoPublic: '',
      }, // public wallet nonces
      noncesToUse, // our key nonces with pks
      evmSigningData.sigOne || '',
      evmSigningData.challenge || '',
      messageType === 'eip712' ? 'eip712' : 'personal',
    );

    // Clear private key from keypair
    keyPair.privKey = '';

    setEvmSigningSignature(result);

    const dataToSend = {
      signature: result,
      requestId: evmSigningData.requestId,
      chain: evmSigningData.chain,
      walletInUse: evmSigningData.walletInUse,
      data: evmSigningData.data,
    };

    try {
      await postAction(
        'evmsigned',
        JSON.stringify(dataToSend),
        evmSigningData.chain,
        evmSigningData.walletInUse,
        sspWalletKeyInternalIdentity,
      );
    } catch (error) {
      // we can ignore this error and show success message as user can copy the nonces
      displayMessage(
        'error',
        // @ts-expect-error 'error' is of type 'unknown'
        error.message ?? 'home:err_sharing_public_nonces',
      );
      console.log(error);
    }

    // Send successful response - try API first, fallback to socket
    // result is the signature.
    // todo if this is wallet connect there should be some id attached
  } catch (error) {
    xprivKeyDecrypted = '';
    pwForEncryption = '';
    console.error('[EVM Signing] Error handling request:', error);
    displayMessage('error', t('home:err_invalid_request'));
  } finally {
    xprivKeyDecrypted = '';
    pwForEncryption = '';
    setActiveChain(identityChain);
    setEvmSigningData(null);

    // Clear the appropriate request
    if (evmSigningRequest) {
      clearEvmSigningRequest?.();
    }
  }
};
