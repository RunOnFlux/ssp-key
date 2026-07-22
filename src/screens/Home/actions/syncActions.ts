import axios from 'axios';
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { sspConfig } from '@storage/ssp';
import { blockchains } from '@storage/blockchains';
import {
  getMasterXpriv,
  getMasterXpub,
  generateMultisigAddress,
  generateInternalIdentityAddress,
  generateAddressKeypair,
  generatePublicNonce,
  generateSolanaPubkeyArray,
} from '../../../lib/wallet';
import {
  setXpubKey,
  setXprivKey,
  setXpubWallet,
  setXpubWalletIdentity,
  store,
} from '../../../store';
import {
  setSspWalletKeyInternalIdentity,
  setSspWalletKeyInternalIdentityWitnessScript,
  setSspWalletKeyInternalIdentityPubKey,
  setSspWalletInternalIdentity,
  setSspKeyInternalIdentity,
  setSspKeyPublicNonces,
} from '../../../store/ssp';
import { getFCMToken } from '../../../lib/fcmHelper';
import {
  sessionVerificationWords,
  type VerifyEntry,
} from '../../../lib/pairingVerification';
import { CHAIN_SYNC_POST_SPACING_MS } from '../../../lib/chainSyncRequest';
import { cryptos, syncSSPRelay, publicNonce } from '../../../types';
import type { HomeActionContext } from './types';

// Shared per-chain sync core: decrypts the key xpub for the chain, runs the
// Solana on-the-fly migration when needed, generates + verifies the first
// multisig address, stores the wallet xpub, and posts the standard
// syncSSPRelay payload to POST /v1/sync. Used by the single-chain sync flow
// (generateAddressesForActiveChain) and looped over by the batch chain sync
// (processChainSyncBatch) — same crypto calls, same sync POST, unchanged
// endpoint so old wallets keep working.
export const syncChainToRelay = async (
  ctx: HomeActionContext,
  chain: keyof cryptos,
  suppliedXpubWallet: string,
  pwForEncryption: string,
  xpubKeyEncrypted: string,
  xprivKeyEncrypted: string,
) => {
  const {
    sspWalletInternalIdentity,
    sspWalletKeyInternalIdentity,
    sspKeyInternalIdentity,
    dispatch,
  } = ctx;
  const xpk = CryptoJS.AES.decrypt(xpubKeyEncrypted, pwForEncryption);
  let xpubKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
  // For Solana chains, "xpub" is actually a JSON-stringified array of
  // 20 base58 Ed25519 leaf pubkeys (Ed25519 has no non-hardened
  // public-key derivation). If the stored xpubKey for this chain is
  // still in regular xpub form (e.g., chain was set up before Solana
  // support), derive the 20-pubkey array on the fly from xprivKey.
  if (
    blockchains[chain].chainType === 'sol' &&
    !xpubKeyDecrypted.startsWith('[')
  ) {
    const xprk = CryptoJS.AES.decrypt(xprivKeyEncrypted, pwForEncryption);
    const xprivKeyDecrypted = xprk.toString(CryptoJS.enc.Utf8);
    // Consumer wallet on-the-fly migration: derive at typeIndex=0
    // (receiving slot). Enterprise vaults take a different code path
    // (handleVaultXpubAction) which passes vault.vaultIndex.
    const keyPubkeys = generateSolanaPubkeyArray(xprivKeyDecrypted, chain, 0);
    xpubKeyDecrypted = JSON.stringify(keyPubkeys);
    // Persist the JSON-encoded form back to encrypted storage so
    // subsequent calls don't need to re-derive.
    const reEncryptedXpubKey = CryptoJS.AES.encrypt(
      xpubKeyDecrypted,
      pwForEncryption,
    ).toString();
    setXpubKey(chain, reEncryptedXpubKey);
  }
  const addrInfo = generateMultisigAddress(
    suppliedXpubWallet,
    xpubKeyDecrypted,
    0,
    0,
    chain,
  );
  if (!addrInfo || !addrInfo.address) {
    throw new Error('Could not generate multisig address');
  }
  CryptoJS.AES.encrypt(
    addrInfo.redeemScript || addrInfo.witnessScript || '',
    pwForEncryption,
  ).toString(); // just to test all is fine
  const encryptedXpubWallet = CryptoJS.AES.encrypt(
    suppliedXpubWallet,
    pwForEncryption,
  ).toString();
  setXpubWallet(chain, encryptedXpubWallet);
  // tell ssp relay that we are synced, post data to ssp sync
  // sspKeyInternalIdentity is already set from identity chain sync
  // Note: may be undefined for SSPs synced before this field was stored
  const syncData: syncSSPRelay = {
    chain,
    walletIdentity: sspWalletInternalIdentity,
    keyXpub: xpubKeyDecrypted,
    wkIdentity: sspWalletKeyInternalIdentity,
    generatedAddress: addrInfo.address,
    keyToken: await getFCMToken(),
    // Include additional fields for verification
    walletXpub: suppliedXpubWallet,
    keyIdentity: sspKeyInternalIdentity,
    // Scripts from first address (index 0) - not strictly needed but extra assurance
    redeemScript: addrInfo.redeemScript,
    witnessScript: addrInfo.witnessScript,
  };
  // == EVM ==
  if (blockchains[chain].chainType === 'evm') {
    const ppNonces = [];
    // generate and replace nonces
    for (let i = 0; i < 50; i += 1) {
      // max 50 txs
      const nonce = generatePublicNonce();
      ppNonces.push(nonce);
    }
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
    syncData.publicNonces = pNs;
  }
  // == EVM end
  await axios.post(`https://${sspConfig().relay}/v1/sync`, syncData);
  // Return this device's decrypted view of the pair so the batch flow can
  // derive the out-of-band verification code. Display-only — never logged.
  return {
    chain,
    walletXpub: suppliedXpubWallet,
    keyXpub: xpubKeyDecrypted,
  };
};
export const generateAddressesForActiveChain = (
  ctx: HomeActionContext,
  suppliedXpubWallet: string,
  chain: keyof cryptos,
) => {
  const {
    xpubKey,
    xprivKey,
    identityChain,
    setSyncReq,
    setSyncSuccessOpen,
    setActiveChain,
    displayMessage,
    t,
  } = ctx;
  Keychain.getGenericPassword({
    service: 'enc_key',
  })
    .then(async (idData) => {
      // clean up password from encrypted storage
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });
      if (!passwordData || !idData) {
        throw new Error('Unable to decrypt stored data');
      }
      // decrypt passwordData.password with idData.password
      const password = CryptoJS.AES.decrypt(
        passwordData.password,
        idData.password,
      );
      const passwordDecrypted = password.toString(CryptoJS.enc.Utf8);
      const pwForEncryption = idData.password + passwordDecrypted;
      await syncChainToRelay(
        ctx,
        chain,
        suppliedXpubWallet,
        pwForEncryption,
        xpubKey,
        xprivKey,
      );
      setSyncReq('');
      setSyncSuccessOpen(true);
    })
    .catch((error) => {
      setSyncReq('');
      setActiveChain(identityChain);
      console.log(error);
      setTimeout(() => {
        displayMessage('error', t('home:err_sync_failed'));
      }, 200);
    });
};
export const generateAddressesForSyncIdentity = (
  ctx: HomeActionContext,
  suppliedXpubWallet: string,
) => {
  const {
    xpubKey,
    xprivKey,
    identityChain,
    dispatch,
    identityVerifyEntryRef,
    setSyncReq,
    setSyncSuccessOpen,
    setActiveChain,
    displayMessage,
    t,
  } = ctx;
  Keychain.getGenericPassword({
    service: 'enc_key',
  })
    .then(async (idData) => {
      // clean up password from encrypted storage
      const passwordData = await Keychain.getGenericPassword({
        service: 'sspkey_pw',
      });
      if (!passwordData || !idData) {
        throw new Error('Unable to decrypt stored data');
      }
      // decrypt passwordData.password with idData.password
      const password = CryptoJS.AES.decrypt(
        passwordData.password,
        idData.password,
      );
      const passwordDecrypted = password.toString(CryptoJS.enc.Utf8);
      const pwForEncryption = idData.password + passwordDecrypted;
      const xpk = CryptoJS.AES.decrypt(xpubKey, pwForEncryption);
      const xpubKeyDecrypted = xpk.toString(CryptoJS.enc.Utf8);
      const xprk = CryptoJS.AES.decrypt(xprivKey, pwForEncryption);
      const xprivKeyDecrypted = xprk.toString(CryptoJS.enc.Utf8);
      const addrInfo = generateMultisigAddress(
        suppliedXpubWallet,
        xpubKeyDecrypted,
        0,
        0,
        identityChain,
      );
      if (!addrInfo || !addrInfo.address) {
        throw new Error('Could not generate multisig address');
      }
      CryptoJS.AES.encrypt(
        addrInfo.redeemScript || addrInfo.witnessScript || '',
        pwForEncryption,
      ).toString(); // just to test all is ok
      const encryptedXpubWallet = CryptoJS.AES.encrypt(
        suppliedXpubWallet,
        pwForEncryption,
      ).toString();
      setXpubWalletIdentity(encryptedXpubWallet);
      const generatedSspWalletKeyInternalIdentity = generateMultisigAddress(
        suppliedXpubWallet,
        xpubKeyDecrypted,
        10,
        0,
        identityChain,
      );
      if (
        !generatedSspWalletKeyInternalIdentity ||
        !generatedSspWalletKeyInternalIdentity.address ||
        !generatedSspWalletKeyInternalIdentity.witnessScript
      ) {
        throw new Error('Could not generate SSP Wallet Key internal identity');
      }
      // Generate identity keypair predictively from xprivKey
      const identityKeypair = generateAddressKeypair(
        xprivKeyDecrypted,
        10,
        0,
        identityChain,
      );
      dispatch(
        setSspWalletKeyInternalIdentity(
          generatedSspWalletKeyInternalIdentity.address,
        ),
      );
      dispatch(
        setSspWalletKeyInternalIdentityWitnessScript(
          generatedSspWalletKeyInternalIdentity.witnessScript,
        ),
      );
      dispatch(setSspWalletKeyInternalIdentityPubKey(identityKeypair.pubKey));
      // generate ssp wallet identity
      const generatedSspWalletInternalIdentity =
        generateInternalIdentityAddress(suppliedXpubWallet, identityChain);
      if (!generatedSspWalletInternalIdentity) {
        throw new Error('Could not generate SSP Wallet internal identity');
      }
      dispatch(
        setSspWalletInternalIdentity(generatedSspWalletInternalIdentity),
      );
      // Generate key's internal identity (single-sig from key's xpub)
      const keyInternalIdentity = generateInternalIdentityAddress(
        xpubKeyDecrypted,
        identityChain,
      );
      if (keyInternalIdentity) {
        dispatch(setSspKeyInternalIdentity(keyInternalIdentity));
      }
      // tell ssp relay that we are synced, post data to ssp sync
      const syncData: syncSSPRelay = {
        chain: identityChain,
        walletIdentity: generatedSspWalletInternalIdentity,
        keyXpub: xpubKeyDecrypted,
        wkIdentity: generatedSspWalletKeyInternalIdentity.address,
        generatedAddress: addrInfo.address,
        keyToken: await getFCMToken(),
        // Include additional fields for verification
        walletXpub: suppliedXpubWallet,
        keyIdentity: keyInternalIdentity,
        // Scripts from first address (index 0) - not strictly needed but extra assurance
        redeemScript: addrInfo.redeemScript,
        witnessScript: addrInfo.witnessScript,
      };
      await axios.post(`https://${sspConfig().relay}/v1/sync`, syncData);
      // Capture the identity chain's verification entry so it can be folded
      // into the ONE unified session code (with any batch chains). The words
      // themselves are derived on demand from this device's own key view.
      identityVerifyEntryRef.current = {
        chain: identityChain,
        walletXpub: suppliedXpubWallet,
        keyXpub: xpubKeyDecrypted,
      };
      setSyncReq('');
      setSyncSuccessOpen(true);
    })
    .catch((error) => {
      setSyncReq('');
      setActiveChain(identityChain);
      console.log(error.message);
      setTimeout(() => {
        displayMessage('error', t('home:err_sync_failed'));
      }, 200);
    });
};
export const processChainSyncBatch = async (ctx: HomeActionContext) => {
  const {
    chainSyncData,
    seedPhrase,
    setChainSyncProgress,
    setActivityStatus,
    setChainSyncData,
    setBatchVerifyWords,
    identityVerifyEntryRef,
    displayMessage,
    t,
  } = ctx;
  const request = chainSyncData;
  if (!request) {
    return;
  }
  setActivityStatus(true);
  let mnemonicPhrase = '';
  try {
    const idData = await Keychain.getGenericPassword({
      service: 'enc_key',
    });
    const passwordData = await Keychain.getGenericPassword({
      service: 'sspkey_pw',
    });
    if (!passwordData || !idData) {
      throw new Error('Unable to decrypt stored data');
    }
    const password = CryptoJS.AES.decrypt(
      passwordData.password,
      idData.password,
    );
    const passwordDecrypted = password.toString(CryptoJS.enc.Utf8);
    const pwForEncryption = idData.password + passwordDecrypted;
    const total = request.chains.length;
    let failedChains = 0;
    const verifyEntries: {
      chain: string;
      walletXpub: string;
      keyXpub: string;
    }[] = [];
    for (let i = 0; i < total; i += 1) {
      const entry = request.chains[i];
      setChainSyncProgress({
        current: i + 1,
        total,
        chain: entry.chain,
      });
      // let the progress UI paint before the synchronous ~3s derivation
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        let { xpubKey: chainXpubKey, xprivKey: chainXprivKey } =
          store.getState()[entry.chain];
        if (!chainXpubKey || !chainXprivKey) {
          // chain keys were never prepared on this device — derive them
          // now, exactly as checkXpubXpriv does for the active chain
          if (!mnemonicPhrase) {
            const mmm = CryptoJS.AES.decrypt(seedPhrase, pwForEncryption);
            mnemonicPhrase = mmm.toString(CryptoJS.enc.Utf8);
          }
          const chainConfig = blockchains[entry.chain];
          const xpriv = getMasterXpriv(
            mnemonicPhrase,
            48,
            chainConfig.slip,
            0,
            chainConfig.scriptType,
            entry.chain,
          ); // takes ~3 secs
          const xpub = getMasterXpub(
            mnemonicPhrase,
            48,
            chainConfig.slip,
            0,
            chainConfig.scriptType,
            entry.chain,
          ); // takes ~3 secs
          chainXprivKey = CryptoJS.AES.encrypt(
            xpriv,
            pwForEncryption,
          ).toString();
          chainXpubKey = CryptoJS.AES.encrypt(xpub, pwForEncryption).toString();
          setXprivKey(entry.chain, chainXprivKey);
          setXpubKey(entry.chain, chainXpubKey);
        }
        const synced = await syncChainToRelay(
          ctx,
          entry.chain,
          entry.xpubWallet,
          pwForEncryption,
          chainXpubKey,
          chainXprivKey,
        );
        verifyEntries.push(synced);
      } catch (error) {
        failedChains += 1;
        console.log('[Chain Sync] Failed for chain', entry.chain, error);
      }
      if (i < total - 1) {
        // spacing so the wallet's 1s sync poll catches every chain
        // (relay sync doc is last-write-wins per walletIdentity)
        await new Promise((resolve) =>
          setTimeout(resolve, CHAIN_SYNC_POST_SPACING_MS),
        );
      }
    }
    if (failedChains > 0) {
      displayMessage('error', t('home:err_sync_failed'));
    } else {
      displayMessage('success', t('home:chainsync_success'));
    }
    // Show the ONE unified verification code covering every chain synced this
    // session so the user can confirm it matches SSP Wallet. The identity
    // chain (if paired this session) is folded in as just another entry — a
    // relay swap on ANY chain changes the code.
    const sessionEntries: VerifyEntry[] = [];
    if (identityVerifyEntryRef.current) {
      sessionEntries.push(identityVerifyEntryRef.current);
    }
    sessionEntries.push(...verifyEntries);
    if (sessionEntries.length > 0) {
      setBatchVerifyWords(sessionVerificationWords(sessionEntries));
    }
  } catch (error) {
    console.log(error);
    displayMessage('error', t('home:err_sync_failed'));
  } finally {
    mnemonicPhrase = '';
    setChainSyncData(null);
    setChainSyncProgress(null);
    setActivityStatus(false);
  }
};
