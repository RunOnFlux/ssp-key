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
  cosignAndBroadcastKASTransaction,
  KasMaybeBroadcastError,
  cosignAndBroadcastTRON,
  TronBroadcastUnknownError,
  TronRelayRefusedError,
  TronSelfPayBalanceError,
} from '../../../lib/constructTx';
import {
  TRON_SELF_PAY_MIN_BALANCE_SUN,
  TRX_DECIMALS,
  formatTronUnits,
  tronNetwork,
  type TronApprovedSummary,
} from '../../../lib/tron';
import {
  kasMaxFeeForUsdRate,
  kasVaultSpend,
  type KasApprovedSummary,
} from '../../../lib/kaspa';
import { openKasLedger } from '../../../lib/kaspaLedger';
import { handleKasLedgerError } from '../../../lib/kaspaLedgerRecovery';
import { getCryptoUsdRate } from '../../../lib/rates';
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
  // Kaspa: what the approval screen displayed (TransactionRequest). Required
  // for kas — the co-sign refuses unless its own re-description matches.
  kasApproved?: KasApprovedSummary,
  // TRON: the chain / vault / Op digest the approval screen displayed.
  // Required for tron — the co-sign re-verifies and refuses on any change.
  tronApproved?: TronApprovedSummary,
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

    const isKas = blockchains[chain].chainType === 'kas';
    // TRON never touches utxolib or the relay's `utxos`: its co-sign derives
    // and verifies the vault itself (lib/tron.ts).
    const isTron = blockchains[chain].chainType === 'tron';
    const addressDetails = isTron
      ? null
      : generateAddressDetailsForSending(
          chain,
          derivationPath,
          xpubKeyWalletDecrypted,
          xpubKeyDecrypted,
        );
    let utxos = suggestedUtxos;
    // if utxos are not provided, fetch them. Kaspa never uses these: its
    // co-sign path always does its own lookup (see below).
    if (
      addressDetails &&
      !isKas &&
      !(suggestedUtxos && suggestedUtxos.length > 0)
    ) {
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
    // Kaspa: set when the submission MAY have landed (never definite).
    let kasMaybeBroadcast = false;
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
    } else if (isKas) {
      // Kaspa: the payload is the wallet's half-signed SigningBundle JSON.
      // The relay-supplied `utxos` are IGNORED — the co-sign opens the bundle
      // against this device's own UTXO lookup of the vault address derived
      // from the stored xpubs + path (KASPA_SSP_CONTRACT.md §4.1). The key
      // stays the broadcaster, then posts `txid` like the UTXO chains.
      if (!kasApproved) {
        keyPair.privKey = '';
        throw new Error(t('home:err_kas_not_displayed'));
      }
      const vaultSpend = kasVaultSpend(
        xpubKeyWalletDecrypted,
        xpubKeyDecrypted,
        typeIndex,
        addressIndex,
        chain,
      );
      try {
        // min($100-equivalent, 5 KAS) — 5 KAS alone when no rate is known
        const maxFee = kasMaxFeeForUsdRate(await getCryptoUsdRate(chain));
        ttxid = await cosignAndBroadcastKASTransaction({
          chain,
          bundleJson: rawTransaction,
          vaultSpend,
          keyPrivKeyHex: keyPair.privKey,
          ledger: openKasLedger(),
          approved: kasApproved,
          maxFee,
        });
      } catch (error) {
        if (!(error instanceof KasMaybeBroadcastError)) {
          throw error;
        }
        // The transaction ID is known and it may be on the network: tell
        // the wallet about it (it tracks it like any sent txid) and tell the
        // user to check the explorer — never re-sign something else.
        ttxid = error.txid;
        kasMaybeBroadcast = true;
      } finally {
        keyPair.privKey = '';
      }
    } else if (isTron) {
      // TRON (TRON_SSP_CONTRACT.md §6): the payload is the wallet's signed
      // `ssp-tron-op`. The co-sign re-runs every §5 check against the vault
      // derived from the stored xpubs + path, signs only the digest that was
      // displayed, then either hands both signatures to the relay sponsor
      // (fee > 0) or submits from this device's own leaf account (self-pay).
      if (!tronApproved) {
        keyPair.privKey = '';
        throw new Error(t('home:err_tron_not_displayed'));
      }
      try {
        ttxid = await cosignAndBroadcastTRON({
          chain,
          rawTx: rawTransaction,
          approved: tronApproved,
          xpubWallet: xpubKeyWalletDecrypted,
          xpubKey: xpubKeyDecrypted,
          path: derivationPath,
          keyPrivKeyHex: keyPair.privKey,
          network: tronNetwork(chain),
          relayHost: sspConfig().relay,
        });
      } catch (error) {
        if (error instanceof TronRelayRefusedError) {
          // A definite refusal: nothing was broadcast. Tell SSP Wallet so it
          // stops waiting, and show the relay's reason.
          setRawTx('');
          setTxPath('');
          setTxUtxos([]);
          await postAction(
            'txrejected',
            rawTransaction,
            chain,
            derivationPath,
            sspWalletKeyInternalIdentity,
          ).catch((postError: unknown) => console.log(postError));
          throw new Error(
            t('home:err_tron_relay_refused', { message: error.message }),
          );
        }
        if (error instanceof TronBroadcastUnknownError) {
          // It may still land: keep the request (a retry of the same signed
          // Op is deduplicated) and never report it as rejected.
          throw new Error(
            t('home:err_tron_broadcast_unknown', {
              message: error.relayMessage || error.message,
            }),
          );
        }
        if (error instanceof TronSelfPayBalanceError) {
          throw new Error(
            t('home:err_tron_self_pay_balance', {
              address: error.address,
              minimum: formatTronUnits(
                TRON_SELF_PAY_MIN_BALANCE_SUN,
                TRX_DECIMALS,
              ),
            }),
          );
        }
        throw error;
      } finally {
        keyPair.privKey = '';
      }
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
      if (!addressDetails) {
        throw new Error('Missing vault address details');
      }
      const signedTx = signTransaction(
        rawTransaction,
        chain,
        keyPair.privKey,
        addressDetails.redeemScript ?? '',
        addressDetails.witnessScript ?? '',
        utxos,
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
    if (kasMaybeBroadcast) {
      displayMessage(
        'error',
        t('home:err_kas_maybe_broadcast', { txid: ttxid }),
        10000,
      );
      return;
    }
    setTxid(ttxid);
  } catch (error) {
    // Kaspa ledger unreadable / full: fail closed; a corrupt ledger also
    // offers the explicit (warned) reset.
    if (handleKasLedgerError(error, t, displayMessage)) {
      console.log(error);
      return;
    }
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
