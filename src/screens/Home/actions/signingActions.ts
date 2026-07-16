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
  fetchUtxos,
  signAndBroadcastEVM,
  selectPublicNonce,
  cosignAndBroadcastSOLTransaction,
} from '../../../lib/constructTx';
import { continueSigningSchnorrMultisig } from '../../../lib/evmSigning';
import { signMessage } from '../../../lib/relayAuth';
import { setSspKeyPublicNonces } from '../../../store/ssp';
import { cryptos, utxo, publicNonce, publicPrivateNonce } from '../../../types';
import type { HomeActionContext } from './types';

export const generateAddressDetailsForSending = (
  chain: keyof cryptos,
  path: string,
  decryptedXpubWallet: string,
  decryptedXpubKey: string,
) => {
  const splittedDerPath = path.split('-');
  const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
  const addressIndex = Number(splittedDerPath[1]);
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

    const addressDetails = generateAddressDetailsForSending(
      chain,
      derivationPath,
      xpubKeyWalletDecrypted,
      xpubKeyDecrypted,
    );
    let utxos = suggestedUtxos;
    // if utxos are not provided, fetch them
    if (!(suggestedUtxos && suggestedUtxos.length > 0)) {
      utxos = await fetchUtxos(addressDetails.address, chain, 2); // in ssp key, we want to fetch both confirmed and unconfirmed utxos
    }

    const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
    const xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);

    const splittedDerPath = derivationPath.split('-');
    const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
    const addressIndex = Number(splittedDerPath[1]);

    const keyPair = generateAddressKeypair(
      xprivKeyDecrypted,
      typeIndex,
      addressIndex,
      chain,
    );
    let ttxid = '';
    if (blockchains[chain].chainType === 'evm') {
      const pNs = CryptoJS.AES.decrypt(publicNonces, pwForEncryption);
      const pNsDecrypted = pNs.toString(CryptoJS.enc.Utf8);
      const pubNonces = JSON.parse(pNsDecrypted) as publicPrivateNonce[];
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
      dispatch(setSspKeyPublicNonces(encryptedNonces));
      // sign and broadcast
      ttxid = await signAndBroadcastEVM(
        rawTransaction,
        chain,
        keyPair.privKey as `0x${string}`,
        publicNonceKey,
      );
    } else if (blockchains[chain].chainType === 'sol') {
      // Wallet pre-signed the outer tx with its leaf. Key adds its own
      // leaf sig + broadcasts directly. The tx may include a permissionless
      // initialize_multisig ix at the head for first-send-per-vault — Key
      // doesn't need to know; it just signs and broadcasts.
      // SPL sends arrive JSON-wrapped (`{ unsignedTxBase64, tokenMint, ...}`)
      // so the approval screen can show the real token symbol; unwrap
      // here so we sign the raw proposal bytes, not the JSON string.
      let serializedTxBase64 = rawTransaction;
      try {
        const parsed = JSON.parse(rawTransaction) as {
          unsignedTxBase64?: string;
        };
        if (parsed && typeof parsed.unsignedTxBase64 === 'string') {
          serializedTxBase64 = parsed.unsignedTxBase64;
        }
      } catch {
        // Not JSON — bare base64 from older wallet, use as-is.
      }
      ttxid = await cosignAndBroadcastSOLTransaction({
        chain,
        serializedTxBase64,
        keyPubkeyBase58: keyPair.pubKey,
        keyPrivKeyHex: keyPair.privKey,
        relayHost: sspConfig().relay,
      });
    } else {
      const signedTx = signTransaction(
        rawTransaction,
        chain,
        keyPair.privKey,
        addressDetails.redeemScript ?? '',
        addressDetails.witnessScript ?? '',
        utxos,
      );
      const finalTx = finaliseTransaction(signedTx, chain);
      console.log(finalTx);
      ttxid = await broadcastTx(finalTx, chain);
    }
    console.log(ttxid);
    setRawTx('');
    setTxPath('');
    setTxUtxos([]);
    await postAction(
      'txid',
      ttxid,
      chain,
      derivationPath,
      sspWalletKeyInternalIdentity,
    );
    setTxid(ttxid);
  } catch (error) {
    const txErrMsg =
      error instanceof Error ? error.message : t('home:err_tx_failed');
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
    const { xprivKey: idXprivKey } = identityChainState || {};
    if (!idXprivKey) {
      throw new Error('xprivKey not available');
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
    displayMessage('error', t('home:err_signing_failed'));
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

    // Use the same nonce management as normal transactions
    const pNs = CryptoJS.AES.decrypt(publicNonces, pwForEncryption);
    const pNsDecrypted = pNs.toString(CryptoJS.enc.Utf8);
    const pubNonces = JSON.parse(pNsDecrypted) as publicPrivateNonce[];

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
    dispatch(setSspKeyPublicNonces(encryptedNonces));

    const xpk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
    xprivKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);

    const splittedDerPath = evmSigningData.walletInUse.split('-');
    if (!splittedDerPath) {
      throw new Error('Invalid walletInUse');
    }
    const typeIndex = Number(splittedDerPath[0]) as 0 | 1;
    const addressIndex = Number(splittedDerPath[1]);

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
      evmSigningData.data || '',
      keyPair,
      publicKeyWallet,
      evmSigningData.pubNoncesOne || {
        kPublic: '',
        kTwoPublic: '',
      }, // public wallet nonces
      noncesToUse, // our key nonces with pks
      evmSigningData.sigOne || '',
      evmSigningData.challenge || '',
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
