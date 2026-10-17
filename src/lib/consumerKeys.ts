/**
 * Decrypt the per-chain key material a consumer approval screen needs to
 * verify a request against the key's OWN derivation (wallet xpub stored at
 * pairing + own xpub), without touching any private key.
 */
import * as Keychain from 'react-native-keychain';
import * as CryptoJS from 'crypto-js';
import type { ConsumerKeyMaterial } from './consumerUtxo';

export async function loadConsumerKeyMaterial(
  encryptedXpubWallet: string | undefined,
  encryptedXpubKey: string | undefined,
  path: string | undefined,
): Promise<ConsumerKeyMaterial> {
  if (!encryptedXpubWallet || !encryptedXpubKey) {
    throw new Error('This chain is not synchronised with SSP Wallet');
  }
  if (!path) {
    throw new Error('Request has no derivation path');
  }
  const encryptionKey = await Keychain.getGenericPassword({
    service: 'enc_key',
  });
  const passwordData = await Keychain.getGenericPassword({
    service: 'sspkey_pw',
  });
  if (!encryptionKey || !passwordData) {
    throw new Error('Unable to decrypt stored data');
  }
  const password = CryptoJS.AES.decrypt(
    passwordData.password,
    encryptionKey.password,
  ).toString(CryptoJS.enc.Utf8);
  const pwForEncryption = encryptionKey.password + password;
  const xpubWallet = CryptoJS.AES.decrypt(
    encryptedXpubWallet,
    pwForEncryption,
  ).toString(CryptoJS.enc.Utf8);
  const xpubKey = CryptoJS.AES.decrypt(
    encryptedXpubKey,
    pwForEncryption,
  ).toString(CryptoJS.enc.Utf8);
  if (!xpubWallet || !xpubKey) {
    throw new Error('Unable to decrypt stored data');
  }
  return { path, xpubWallet, xpubKey };
}
