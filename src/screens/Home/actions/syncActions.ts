import axios from 'axios';
import * as CryptoJS from 'crypto-js';
import * as Keychain from '../../../lib/keychain';
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
import { isDerivableSeedPhrase } from '../../../lib/seedPhrase';
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
import { signRecoveryXpub } from '../../../lib/recoveryPublish';
import {
  CHAIN_SYNC_POST_SPACING_MS,
  chainSyncAttestationMessage,
  classifyPairingChange,
  type PairingChange,
  type ParsedChainSyncRequest,
} from '../../../lib/chainSyncRequest';
import {
  computeBodyHash,
  createMultisigAuth,
  signMessage,
} from '../../../lib/relayAuth';
import { cryptos, syncSSPRelay, publicNonce } from '../../../types';
import type { HomeActionContext } from './types';

/**
 * CS-3: a pending re-pair that needs the user's explicit confirmation before
 * anything is saved. Raised instead of silently overwriting a stored wallet
 * xpub with a different one.
 */
export interface RePairRequest {
  kind: 'single' | 'batch';
  /** Chains whose existing pairing would be replaced. */
  chains: (keyof cryptos)[];
  /**
   * The session verification words of the NEW pairing, computed from this
   * device's own view before anything is stored — the same words this device
   * shows once the sync completes, and that SSP Wallet must show.
   */
  words: string[];
  /** single: the chain and the wallet xpub that was scanned / requested. */
  chain?: keyof cryptos;
  xpubWallet?: string;
  /** batch: the whole chain-sync request, replayed on confirmation. */
  request?: ParsedChainSyncRequest;
}

export interface SyncFlowOptions {
  /** The user explicitly confirmed replacing existing pairings (CS-3). */
  confirmedRePair?: boolean;
  /**
   * Called — instead of saving anything — when the sync would replace an
   * existing pairing and confirmedRePair is not set. Without it such a sync
   * fails closed.
   */
  onRePairRequired?: (request: RePairRequest) => void;
  /** batch only: the request to process (defaults to ctx.chainSyncData). */
  request?: ParsedChainSyncRequest;
}

/** Identity leaf m/48'/coin'/0'/scriptType'/10/0. */
const IDENTITY_TYPE_INDEX = 10;

/** AES-decrypt a stored blob; '' when it does not decrypt (never throws). */
const decryptOrEmpty = (blob: string, pwForEncryption: string): string => {
  try {
    return CryptoJS.AES.decrypt(blob, pwForEncryption).toString(
      CryptoJS.enc.Utf8,
    );
  } catch {
    return '';
  }
};

/**
 * CS-3: compare a supplied wallet xpub with what this device stores for the
 * chain. A stored blob that no longer decrypts counts as a different pairing
 * (fail closed: it is never overwritten without confirmation).
 */
export const storedPairingChange = (
  chain: keyof cryptos,
  suppliedXpubWallet: string,
  pwForEncryption: string,
): PairingChange => {
  const stored = store.getState()[chain]?.xpubWallet;
  if (!stored) return classifyPairingChange(null, suppliedXpubWallet);
  return classifyPairingChange(
    decryptOrEmpty(stored, pwForEncryption),
    suppliedXpubWallet,
  );
};

/** Plaintext identity-chain xpriv, or '' when unavailable. */
const identityXpriv = (ctx: HomeActionContext, pwForEncryption: string) => {
  const blob = ctx.identityChainState?.xprivKey;
  return blob ? decryptOrEmpty(blob, pwForEncryption) : '';
};

/** Message prefix chain for identity-key signatures (utxo identity chains). */
const identitySigningChain = (identityChain: keyof cryptos): keyof cryptos =>
  blockchains[identityChain].chainType === 'utxo' ? identityChain : 'btc';

/**
 * CS-1: sign `SSP_CHAIN_SYNC:<chain>:<walletXpub>:<keyXpub>` with the Key's
 * identity key — the same /10/0 key and signing helper WK signing uses.
 * Returns undefined when the identity key is unavailable; SSP Wallet then
 * requires the out-of-band verification code for this chain (CS-2).
 */
export const signChainSyncAttestation = (
  xprivKeyIdentity: string,
  identityChain: keyof cryptos,
  chain: string,
  walletXpub: string,
  keyXpub: string,
): string | undefined => {
  if (!xprivKeyIdentity) return undefined;
  try {
    const identityKeypair = generateAddressKeypair(
      xprivKeyIdentity,
      IDENTITY_TYPE_INDEX,
      0,
      identityChain,
    );
    return signMessage(
      chainSyncAttestationMessage(chain, walletXpub, keyXpub),
      identityKeypair.privKey,
      identitySigningChain(identityChain),
    );
  } catch (error) {
    console.log('[Chain Sync] Could not sign chain attestation', error);
    return undefined;
  }
};

/**
 * Body + wkIdentity auth for POST /v1/sync (RA-2). The relay's multisig auth
 * reads the identity witness script from the body's `witnessScript` field, so
 * the address-level script the sync document carries travels as
 * `chainWitnessScript` instead; the relay stores it back as the document's
 * `witnessScript` (SSP Wallet compares it when present). Throws instead of
 * ever posting an unsigned sync.
 */
const signSyncBody = async (
  syncData: syncSSPRelay,
  sign: (
    body: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null,
): Promise<Record<string, unknown>> => {
  const body: Record<string, unknown> = { ...syncData };
  if (body.witnessScript) {
    body.chainWitnessScript = body.witnessScript;
  }
  delete body.witnessScript;
  const auth = await sign(body);
  if (!auth) {
    throw new Error('Relay authentication unavailable for sync');
  }
  return { ...body, ...auth };
};

/**
 * The recovery account xpub for the sync payload, with this Key's signature
 * over it. SSP Wallet verifies that signature against the identity key it
 * derives from the xpub it already holds, so the value it caches does not
 * depend on trusting whatever delivered it.
 *
 * Returns empty fields until the recovery account is provisioned; the wallet
 * then simply has nothing to cache yet.
 */
const recoveryFieldsForSync = (
  xpubRecovery: string,
  xprivKeyIdentity: string,
  wkIdentity: string,
  identityChain: keyof cryptos,
  pwForEncryption: string,
): { recoveryXpub?: string; xpubSignature?: string } => {
  if (!xpubRecovery || !wkIdentity || !xprivKeyIdentity) return {};
  try {
    const recoveryXpub = CryptoJS.AES.decrypt(
      xpubRecovery,
      pwForEncryption,
    ).toString(CryptoJS.enc.Utf8);
    if (!recoveryXpub) return {};
    return {
      recoveryXpub,
      xpubSignature: signRecoveryXpub({
        xprivKeyIdentity,
        wkIdentity,
        recoveryXpub,
        identityChain,
      }),
    };
  } catch (error) {
    // Never block a sync on this: the wallet asks again on the next one.
    console.log('[recovery] could not attach recovery xpub to sync', error);
    return {};
  }
};

// Generate a fresh Schnorr public-nonce pool, store it (encrypted) and return
// just the public parts for the wallet.
//
// The pool is PER-INSTALL, not per-chain: one redux slot here (store/ssp
// publicNonces), one localForage key in SSP Wallet — every EVM chain draws
// from the same pool. So a batch sync must generate it exactly ONCE and report
// the SAME public parts for every EVM chain it answers; regenerating per chain
// would leave this device holding only the last chain's pool while the wallet
// kept an earlier one, and every EVM send would then use a nonce the other
// side never had (the wallet waits forever, no error).
const generateKeyPublicNonces = (
  dispatch: HomeActionContext['dispatch'],
  pwForEncryption: string,
): publicNonce[] => {
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
  return ppNonces.map((nonce) => ({
    kPublic: nonce.kPublic,
    kTwoPublic: nonce.kTwoPublic,
  }));
};

// Shared per-chain sync core: decrypts the key xpub for the chain, runs the
// Solana on-the-fly migration when needed, generates + verifies the first
// multisig address, stores the wallet xpub, and posts the standard
// syncSSPRelay payload to POST /v1/sync. Used by the single-chain sync flow
// (generateAddressesForActiveChain) and looped over by the batch chain sync
// (processChainSyncBatch) — same crypto calls, same sync POST, unchanged
// endpoint so old wallets keep working.
//
// sharedPublicNonces: returns the batch flow's ONE pool for the whole batch,
// generating it on first use (see generateKeyPublicNonces). Omitted by the
// single-chain flow, which generates its own pool exactly as before.
/**
 * The Key xpub exactly as it is posted for `chain`. For Solana chains the
 * "xpub" is a JSON-stringified array of 20 base58 Ed25519 leaf pubkeys
 * (Ed25519 has no non-hardened public-key derivation); a chain set up before
 * Solana support still stores a regular xpub, so the array is derived on the
 * fly from xprivKey and persisted back.
 */
const resolveKeyXpubForSync = (
  chain: keyof cryptos,
  pwForEncryption: string,
  xpubKeyEncrypted: string,
  xprivKeyEncrypted: string,
): string => {
  const xpubKeyDecrypted = decryptOrEmpty(xpubKeyEncrypted, pwForEncryption);
  if (
    blockchains[chain].chainType !== 'sol' ||
    xpubKeyDecrypted.startsWith('[')
  ) {
    return xpubKeyDecrypted;
  }
  const xprivKeyDecrypted = decryptOrEmpty(xprivKeyEncrypted, pwForEncryption);
  // Consumer wallet on-the-fly migration: derive at typeIndex=0 (receiving
  // slot). Enterprise vaults take a different code path
  // (handleVaultXpubAction) which passes vault.vaultIndex.
  const keyPubkeys = generateSolanaPubkeyArray(xprivKeyDecrypted, chain, 0);
  const asArray = JSON.stringify(keyPubkeys);
  // Persist the JSON-encoded form so subsequent calls don't re-derive.
  setXpubKey(chain, CryptoJS.AES.encrypt(asArray, pwForEncryption).toString());
  return asArray;
};

// Shared per-chain sync core: decrypts the key xpub for the chain, runs the
// Solana on-the-fly migration when needed, generates + verifies the first
// multisig address, stores the wallet xpub, and posts the standard
// syncSSPRelay payload to POST /v1/sync. Used by the single-chain sync flow
// (generateAddressesForActiveChain) and looped over by the batch chain sync
// (processChainSyncBatch) — same crypto calls, same sync POST, unchanged
// endpoint so old wallets keep working.
//
// The caller has already established (CS-3) that storing suppliedXpubWallet
// is either a new pairing, the same pairing, or a re-pair the user confirmed.
//
// sharedPublicNonces: returns the batch flow's ONE pool for the whole batch,
// generating it on first use (see generateKeyPublicNonces). Omitted by the
// single-chain flow, which generates its own pool exactly as before.
export const syncChainToRelay = async (
  ctx: HomeActionContext,
  chain: keyof cryptos,
  suppliedXpubWallet: string,
  pwForEncryption: string,
  xpubKeyEncrypted: string,
  xprivKeyEncrypted: string,
  sharedPublicNonces?: () => publicNonce[],
) => {
  const {
    sspWalletInternalIdentity,
    sspWalletKeyInternalIdentity,
    sspKeyInternalIdentity,
    xpubRecovery,
    identityChain,
    dispatch,
  } = ctx;
  // The identity xpriv (NOT this chain's) signs both attestations.
  const xprivKeyIdentity = identityXpriv(ctx, pwForEncryption);
  const recoveryFields = recoveryFieldsForSync(
    xpubRecovery,
    xprivKeyIdentity,
    sspWalletKeyInternalIdentity,
    identityChain,
    pwForEncryption,
  );
  const xpubKeyDecrypted = resolveKeyXpubForSync(
    chain,
    pwForEncryption,
    xpubKeyEncrypted,
    xprivKeyEncrypted,
  );
  if (!xpubKeyDecrypted) {
    throw new Error('Could not decrypt key xpub');
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
    // Script from first address (index 0) - not strictly needed but extra
    // assurance. The witnessScript rides as chainWitnessScript (signSyncBody).
    redeemScript: addrInfo.redeemScript,
    witnessScript: addrInfo.witnessScript,
    ...recoveryFields,
  };
  // CS-1: the Key attests this exact (chain, walletXpub, keyXpub) triple.
  const keyXpubSignature = signChainSyncAttestation(
    xprivKeyIdentity,
    identityChain,
    chain,
    suppliedXpubWallet,
    xpubKeyDecrypted,
  );
  if (keyXpubSignature) {
    syncData.keyXpubSignature = keyXpubSignature;
  }
  // == EVM ==
  if (blockchains[chain].chainType === 'evm') {
    // one pool per install: reuse the batch's pool when the caller supplied
    // one, otherwise generate (and store) a fresh one for this single chain
    syncData.publicNonces = sharedPublicNonces
      ? sharedPublicNonces()
      : generateKeyPublicNonces(dispatch, pwForEncryption);
  }
  // == EVM end
  const body = await signSyncBody(syncData, (unsigned) =>
    ctx.createWkAuth('sync', sspWalletKeyInternalIdentity, unsigned),
  );
  await axios.post(`https://${sspConfig().relay}/v1/sync`, body);
  // Return this device's decrypted view of the pair so the batch flow can
  // derive the out-of-band verification code. Display-only — never logged.
  return {
    chain,
    walletXpub: suppliedXpubWallet,
    keyXpub: xpubKeyDecrypted,
  };
};

/** The identity entry of this pairing session, if identity paired this session. */
const sessionIdentityEntries = (ctx: HomeActionContext): VerifyEntry[] =>
  ctx.identityVerifyEntryRef.current
    ? [ctx.identityVerifyEntryRef.current]
    : [];

/** Decrypted stored password + enc_key, i.e. the AES passphrase for blobs. */
const loadPwForEncryption = async (): Promise<string> => {
  const idData = await Keychain.getGenericPassword({
    service: 'enc_key',
  });
  const passwordData = await Keychain.getGenericPassword({
    service: 'sspkey_pw',
  });
  if (!passwordData || !idData) {
    throw new Error('Unable to decrypt stored data');
  }
  const password = CryptoJS.AES.decrypt(passwordData.password, idData.password);
  return idData.password + password.toString(CryptoJS.enc.Utf8);
};

export const generateAddressesForActiveChain = (
  ctx: HomeActionContext,
  suppliedXpubWallet: string,
  chain: keyof cryptos,
  options: SyncFlowOptions = {},
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
  return loadPwForEncryption()
    .then(async (pwForEncryption) => {
      // CS-3: never silently replace an existing pairing for this chain.
      const change = storedPairingChange(
        chain,
        suppliedXpubWallet,
        pwForEncryption,
      );
      if (change === 'replace' && !options.confirmedRePair) {
        if (!options.onRePairRequired) {
          throw new Error('Re-pairing an already paired chain was refused');
        }
        const keyXpub = resolveKeyXpubForSync(
          chain,
          pwForEncryption,
          xpubKey,
          xprivKey,
        );
        if (!keyXpub) {
          throw new Error('Could not decrypt key xpub');
        }
        options.onRePairRequired({
          kind: 'single',
          chains: [chain],
          chain,
          xpubWallet: suppliedXpubWallet,
          words: sessionVerificationWords([
            ...sessionIdentityEntries(ctx),
            { chain, walletXpub: suppliedXpubWallet, keyXpub },
          ]),
        });
        return;
      }
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
  options: SyncFlowOptions = {},
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
  return loadPwForEncryption()
    .then(async (pwForEncryption) => {
      const xpubKeyDecrypted = decryptOrEmpty(xpubKey, pwForEncryption);
      const xprivKeyDecrypted = decryptOrEmpty(xprivKey, pwForEncryption);
      if (!xpubKeyDecrypted || !xprivKeyDecrypted) {
        throw new Error('Could not decrypt identity keys');
      }
      // CS-3: scanning a DIFFERENT wallet's identity QR re-pairs this Key with
      // another wallet. Never do that silently.
      const change = storedPairingChange(
        identityChain,
        suppliedXpubWallet,
        pwForEncryption,
      );
      if (change === 'replace' && !options.confirmedRePair) {
        if (!options.onRePairRequired) {
          throw new Error('Re-pairing the identity chain was refused');
        }
        options.onRePairRequired({
          kind: 'single',
          chains: [identityChain],
          chain: identityChain,
          xpubWallet: suppliedXpubWallet,
          words: sessionVerificationWords([
            {
              chain: identityChain,
              walletXpub: suppliedXpubWallet,
              keyXpub: xpubKeyDecrypted,
            },
          ]),
        });
        return;
      }
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
      // generate ssp wallet identity
      const generatedSspWalletInternalIdentity =
        generateInternalIdentityAddress(suppliedXpubWallet, identityChain);
      if (!generatedSspWalletInternalIdentity) {
        throw new Error('Could not generate SSP Wallet internal identity');
      }
      // Generate key's internal identity (single-sig from key's xpub)
      const keyInternalIdentity = generateInternalIdentityAddress(
        xpubKeyDecrypted,
        identityChain,
      );
      // Everything derived — only now persist the pairing.
      const encryptedXpubWallet = CryptoJS.AES.encrypt(
        suppliedXpubWallet,
        pwForEncryption,
      ).toString();
      setXpubWalletIdentity(encryptedXpubWallet);
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
      dispatch(
        setSspWalletInternalIdentity(generatedSspWalletInternalIdentity),
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
        // Script from first address (index 0) - not strictly needed but
        // extra assurance. The witnessScript rides as chainWitnessScript
        // (signSyncBody).
        redeemScript: addrInfo.redeemScript,
        witnessScript: addrInfo.witnessScript,
        ...recoveryFieldsForSync(
          ctx.xpubRecovery,
          xprivKeyDecrypted,
          generatedSspWalletKeyInternalIdentity.address,
          identityChain,
          pwForEncryption,
        ),
      };
      // RA-2: signed as the wkIdentity this pairing just produced. The
      // store values the hook signs with are not updated yet in this render,
      // so the auth is built from the freshly derived material directly.
      const body = await signSyncBody(
        syncData,
        (unsigned) =>
          createMultisigAuth(
            'sync',
            generatedSspWalletKeyInternalIdentity.address,
            xprivKeyDecrypted,
            generatedSspWalletKeyInternalIdentity.witnessScript as string,
            identityKeypair.pubKey,
            identitySigningChain(identityChain),
            computeBodyHash(unsigned),
          ) as unknown as Record<string, unknown>,
      );
      await axios.post(`https://${sspConfig().relay}/v1/sync`, body);
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
export const processChainSyncBatch = async (
  ctx: HomeActionContext,
  options: SyncFlowOptions = {},
) => {
  const {
    chainSyncData,
    seedPhrase,
    setChainSyncProgress,
    setActivityStatus,
    setChainSyncData,
    setBatchVerifyWords,
    identityVerifyEntryRef,
    dispatch,
    displayMessage,
    t,
  } = ctx;
  const request = options.request ?? chainSyncData;
  if (!request) {
    return;
  }
  setActivityStatus(true);
  let mnemonicPhrase = '';
  try {
    const pwForEncryption = await loadPwForEncryption();
    const total = request.chains.length;

    // Make sure this device holds its OWN keys for a chain, deriving them the
    // way checkXpubXpriv does for the active chain when they were never
    // prepared. Only the Key's own key cache is written here — no pairing.
    const prepareChainKeys = async (index: number) => {
      const entry = request.chains[index];
      setChainSyncProgress({
        current: index + 1,
        total,
        chain: entry.chain,
      });
      // let the progress UI paint before the synchronous ~3s derivation
      await new Promise((resolve) => setTimeout(resolve, 50));
      let { xpubKey: chainXpubKey, xprivKey: chainXprivKey } =
        store.getState()[entry.chain];
      if (!chainXpubKey || !chainXprivKey) {
        if (!mnemonicPhrase) {
          mnemonicPhrase = decryptOrEmpty(seedPhrase, pwForEncryption);
        }
        // KEY-3: never derive (and store) keys from a seed that did not
        // decrypt — '' or garbage under a wrong / rotated enc_key. Not a
        // BIP-39 check: a restored non-standard phrase is valid.
        if (!isDerivableSeedPhrase(mnemonicPhrase)) {
          throw new Error('Unable to decrypt stored data');
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
        chainXprivKey = CryptoJS.AES.encrypt(xpriv, pwForEncryption).toString();
        chainXpubKey = CryptoJS.AES.encrypt(xpub, pwForEncryption).toString();
        setXprivKey(entry.chain, chainXprivKey);
        setXpubKey(entry.chain, chainXpubKey);
      }
      return { entry, chainXpubKey, chainXprivKey };
    };

    // CS-3: a relay-delivered batch must not silently replace a chain that is
    // already paired with a different wallet xpub. Detect that BEFORE anything
    // is saved; the user confirms on a warning screen that shows the new
    // pairing's verification words first, or cancels and nothing is stored.
    const replacing = request.chains
      .filter(
        (entry) =>
          storedPairingChange(
            entry.chain,
            entry.xpubWallet,
            pwForEncryption,
          ) === 'replace',
      )
      .map((entry) => entry.chain);
    if (replacing.length > 0 && !options.confirmedRePair) {
      if (!options.onRePairRequired) {
        throw new Error('Re-pairing already paired chains was refused');
      }
      const preview: VerifyEntry[] = [];
      for (let i = 0; i < total; i += 1) {
        try {
          const { entry, chainXpubKey, chainXprivKey } =
            await prepareChainKeys(i);
          const keyXpub = resolveKeyXpubForSync(
            entry.chain,
            pwForEncryption,
            chainXpubKey,
            chainXprivKey,
          );
          if (keyXpub) {
            preview.push({
              chain: entry.chain,
              walletXpub: entry.xpubWallet,
              keyXpub,
            });
          }
        } catch (error) {
          console.log('[Chain Sync] Could not prepare chain', error);
        }
      }
      options.onRePairRequired({
        kind: 'batch',
        chains: replacing,
        request,
        words: sessionVerificationWords([
          ...sessionIdentityEntries(ctx),
          ...preview,
        ]),
      });
      return;
    }

    let failedChains = 0;
    const verifyEntries: {
      chain: string;
      walletXpub: string;
      keyXpub: string;
    }[] = [];
    // ONE nonce pool for the whole batch — every EVM chain of this batch
    // reports the same public parts, so the wallet ends up on exactly the pool
    // this device kept no matter which of the batch's sync docs it observed
    // (see generateKeyPublicNonces). Created on first use so a batch with no
    // EVM chain — or one that never gets as far as posting — leaves the
    // existing pool alone.
    let pool: publicNonce[] | undefined;
    const batchPublicNonces = () => {
      pool ??= generateKeyPublicNonces(dispatch, pwForEncryption);
      return pool;
    };
    for (let i = 0; i < total; i += 1) {
      try {
        const { entry, chainXpubKey, chainXprivKey } =
          await prepareChainKeys(i);
        const synced = await syncChainToRelay(
          ctx,
          entry.chain,
          entry.xpubWallet,
          pwForEncryption,
          chainXpubKey,
          chainXprivKey,
          batchPublicNonces,
        );
        verifyEntries.push(synced);
      } catch (error) {
        failedChains += 1;
        console.log(
          '[Chain Sync] Failed for chain',
          request.chains[i].chain,
          error,
        );
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
