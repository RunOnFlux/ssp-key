import {
  getLibId,
  getScriptType,
  generateMnemonic,
  validateMnemonic,
  getMasterXpub,
  getMasterXpriv,
  generateMultisigAddressEVM,
  generateAddressKeypairEVM,
  generateAddressKeypair,
  generateInternalIdentityAddress,
  generatePublicNonce,
} from '../../src/lib/wallet';

const mnemonic =
  'silver trouble mountain crouch angry park film strong escape theory illegal bunker cargo taxi tuna real drift alert state match great escape option explain';

describe('Wallet Lib', () => {
  describe('Verifies wallet', () => {
    test('should return getLibId data when value is flux', () => {
      const res = getLibId('flux');
      expect(res).toBe('flux');
    });

    test('should return getLibId data when value is evm', () => {
      const res = getLibId('sepolia');
      expect(res).toBe('sepolia');
    });

    test('should return getLibId data when value is blockbook', () => {
      const res = getLibId('bch');
      expect(res).toBe('bitcoincash');
    });

    test('should return getScriptType data when value is p2sh', () => {
      const res = getScriptType('p2sh');
      expect(res).toBe(0);
    });

    test('should return getScriptType data when value is p2sh-p2wsh', () => {
      const res = getScriptType('p2sh-p2wsh');
      expect(res).toBe(1);
    });

    test('should return getScriptType data when value is p2wsh', () => {
      const res = getScriptType('p2wsh');
      expect(res).toBe(2);
    });

    test('should return getScriptType data when value is empty', () => {
      const res = getScriptType('');
      expect(res).toBe(0);
    });

    test('should return generateMnemonic data when value is valid 256', () => {
      const res = generateMnemonic(256);
      const response = validateMnemonic(res);
      const arr = res.split(' ');
      expect(response).toBe(true);
      expect(arr.length).toBe(24);
    });

    test('should return generateMnemonic data when value is valid 128', () => {
      const res = generateMnemonic(128);
      const response = validateMnemonic(res);
      const arr = res.split(' ');
      expect(response).toBe(true);
      expect(arr.length).toBe(12);
    });

    test('should return getMasterXpub data when value is valid', () => {
      const res = getMasterXpub(mnemonic, 48, 1, 0, 'p2sh', 'flux');
      expect(res).toBe(
        'xpub6DrK6ePttTnvR7NRoCkLEYRdNHb8y5oRbzJLeDCv8dCcGJ3yamC9y37iKpAdUnyjmeb6wphWTTRpWFHPdTe8hUDkCUN7YXM5M834FmHr9K5',
      );
    });

    test('should return getMasterXpriv data when value is valid', () => {
      const res = getMasterXpriv(mnemonic, 48, 1, 0, 'p2sh', 'flux');
      expect(res).toBe(
        'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY',
      );
    });

    test('refuses to derive keys from an empty mnemonic (undecryptable seed)', () => {
      expect(() => getMasterXpriv('', 48, 1, 0, 'p2sh', 'flux')).toThrow(
        /Invalid mnemonic/,
      );
      expect(() => getMasterXpub('', 48, 1, 0, 'p2sh', 'flux')).toThrow(
        /Invalid mnemonic/,
      );
    });

    test('derives keys from a restored non-standard phrase (bad checksum)', () => {
      const words = mnemonic.split(' ');
      words[words.length - 1] = 'abandon';
      const badChecksum = words.join(' ');
      expect(validateMnemonic(badChecksum)).toBe(false);
      const xpub = getMasterXpub(badChecksum, 48, 1, 0, 'p2sh', 'flux');
      expect(xpub).toMatch(/^xpub/);
      expect(xpub).not.toBe(getMasterXpub(mnemonic, 48, 1, 0, 'p2sh', 'flux'));
      expect(getMasterXpub(badChecksum, 48, 1, 0, 'p2sh', 'flux')).toBe(xpub);
    });

    test('derives keys from a phrase outside the English word list', () => {
      // Spanish BIP-39 words (accented, NFKD-normalised on derivation)
      const spanish =
        'ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco abierto';
      expect(validateMnemonic(spanish)).toBe(false);
      expect(getMasterXpub(spanish, 48, 1, 0, 'p2sh', 'flux')).toMatch(/^xpub/);
    });

    test('refuses to derive keys from garbage (undecryptable seed)', () => {
      for (const garbage of [
        'ab#cd',
        'one two three',
        `${mnemonic} extra`,
        mnemonic.replace(' ', '  '),
        mnemonic.replace('a', '1'),
      ]) {
        expect(() => getMasterXpriv(garbage, 48, 1, 0, 'p2sh', 'flux')).toThrow(
          /Invalid mnemonic/,
        );
      }
    });

    test('should return generateMultisigAddressEVM data when value is valid', () => {
      const res = generateMultisigAddressEVM(
        'xpub6DrK6ePttTnvR7NRoCkLEYRdNHb8y5oRbzJLeDCv8dCcGJ3yamC9y37iKpAdUnyjmeb6wphWTTRpWFHPdTe8hUDkCUN7YXM5M834FmHr9K5',
        'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY',
        0,
        1,
        'sepolia',
      );
      expect(res).toEqual({
        address: '0x388FBa75f0b18566CfeFf56d641e1A30f1655076',
      });
    });

    test('should return generateAddressKeypairEVM data when value is valid', () => {
      const res = generateAddressKeypairEVM(
        'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY',
        0,
        1,
        'sepolia',
      );
      expect(res).toEqual({
        privKey:
          '0x29c6fbfe8f749d4d122a3a8422e63977aaf943fb3674a927fb88f1a2833a53ad',
        pubKey:
          '0313b0012725426394a61c44a0ec4be91be554d1625d97ee6565db61b30500f8da',
      });
    });

    test('should return generateAddressKeypair data when value is valid', () => {
      const res = generateAddressKeypair(
        'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY',
        0,
        1,
        'flux',
      );
      expect(res).toEqual({
        privKey: 'KxcvLgMARzhsH9ttJvxFC56aCNeYviVwN3GKXamhJb5PCPyYy6eU',
        pubKey:
          '0313b0012725426394a61c44a0ec4be91be554d1625d97ee6565db61b30500f8da',
      });
    });

    test('should return generateInternalIdentityAddress data when value is valid', () => {
      const res = generateInternalIdentityAddress(
        'xpub6DrK6ePttTnvR7NRoCkLEYRdNHb8y5oRbzJLeDCv8dCcGJ3yamC9y37iKpAdUnyjmeb6wphWTTRpWFHPdTe8hUDkCUN7YXM5M834FmHr9K5',
        'flux',
      );
      expect(res).toBe('t1UMukPYoA7hUn9GftBmHYF78Nwx6KErRBC');
    });

    test('should return generatePublicNonce data when value is valid', () => {
      const res = generatePublicNonce();
      expect(res).toHaveProperty('k');
      expect(res).toHaveProperty('kTwo');
      expect(res).toHaveProperty('kPublic');
      expect(res).toHaveProperty('kTwoPublic');
      expect(typeof res.k).toBe('string');
      expect(typeof res.kTwo).toBe('string');
      expect(typeof res.kPublic).toBe('string');
      expect(typeof res.kTwoPublic).toBe('string');
      // Verify hex strings have content
      expect(res.k.length).toBeGreaterThan(0);
      expect(res.kTwo.length).toBeGreaterThan(0);
      expect(res.kPublic.length).toBeGreaterThan(0);
      expect(res.kTwoPublic.length).toBeGreaterThan(0);
    });
  });
});
