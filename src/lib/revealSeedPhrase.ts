import * as Keychain from 'react-native-keychain';
import * as CryptoJS from 'crypto-js';

/**
 * Decrypt the redux-persisted, encrypted SSP Key mnemonic to its plaintext
 * words — READ-ONLY. This is the exact same reveal path SSKeyDetails and
 * AddressDetails already use (enc_key + sspkey_pw from the keychain derive the
 * per-install encryption password, which AES-decrypts the stored blob); it is
 * lifted here verbatim so the backup-verify flow reuses it rather than inventing
 * a second scheme.
 *
 * Invariant: no crypto/derivation change — same algorithm, same keys, no writes.
 * Callers must already have passed the Authentication (password/biometric) gate;
 * this helper performs no auth of its own.
 *
 * @param encryptedSeedPhrase the `state.ssp.seedPhrase` blob (AES ciphertext).
 * @returns the plaintext mnemonic, or '' if the stored data can't be read.
 */
export async function revealSeedPhrase(
  encryptedSeedPhrase: string,
): Promise<string> {
  if (!encryptedSeedPhrase) {
    throw new Error('No seed phrase stored');
  }
  const idData = await Keychain.getGenericPassword({ service: 'enc_key' });
  const passwordData = await Keychain.getGenericPassword({
    service: 'sspkey_pw',
  });
  if (!passwordData || !idData) {
    throw new Error('Unable to decrypt stored data');
  }
  // decrypt passwordData.password with idData.password
  const password = CryptoJS.AES.decrypt(passwordData.password, idData.password);
  const passwordDecrypted = password.toString(CryptoJS.enc.Utf8);
  const pwForEncryption = idData.password + passwordDecrypted;
  const mmm = CryptoJS.AES.decrypt(encryptedSeedPhrase, pwForEncryption);
  return mmm.toString(CryptoJS.enc.Utf8);
}
