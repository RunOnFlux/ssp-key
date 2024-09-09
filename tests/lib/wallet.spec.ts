// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import { describe, it } from 'mocha';

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

const { assert } = chai;

const mnemonic =
  'silver trouble mountain crouch angry park film strong escape theory illegal bunker cargo taxi tuna real drift alert state match great escape option explain';

describe('Wallet Lib', () => {
  describe('Verifies wallet', () => {
    it('should return getLibId data when value is flux', () => {
      const res = getLibId('flux');
      assert.equal(res, 'flux');
    });

    it('should return getLibId data when value is evm', () => {
      const res = getLibId('sepolia');
      assert.equal(res, 'sepolia');
    });

    it('should return getScriptType data when value is p2sh', () => {
      const res = getScriptType('p2sh');
      assert.equal(res, 0);
    });

    it('should return getScriptType data when value is p2sh-p2wsh', () => {
      const res = getScriptType('p2sh-p2wsh');
      assert.equal(res, 1);
    });

    it('should return getScriptType data when value is p2wsh', () => {
      const res = getScriptType('p2wsh');
      assert.equal(res, 2);
    });

    it('should return getScriptType data when value is empty', () => {
      const res = getScriptType('');
      assert.equal(res, 0);
    });

    it('should return generateMnemonic data when value is valid 256', () => {
      const res = generateMnemonic(256);
      const response = validateMnemonic(res);
      const arr = res.split(' ');
      assert.equal(response, true);
      assert.equal(arr.length, 24);
    });

    it('should return generateMnemonic data when value is valid 128', () => {
      const res = generateMnemonic(128);
      const response = validateMnemonic(res);
      const arr = res.split(' ');
      assert.equal(response, true);
      assert.equal(arr.length, 12);
    });

    it('should return getMasterXpub data when value is valid', () => {
      const res = getMasterXpub(mnemonic, 48, 1, 0, 'p2sh', 'flux');
      assert.equal(
        res,
        'xpub6DrK6ePttTnvR7NRoCkLEYRdNHb8y5oRbzJLeDCv8dCcGJ3yamC9y37iKpAdUnyjmeb6wphWTTRpWFHPdTe8hUDkCUN7YXM5M834FmHr9K5',
      );
    });

    it('should return getMasterXpriv data when value is valid', () => {
      const res = getMasterXpriv(mnemonic, 48, 1, 0, 'p2sh', 'flux');
      assert.equal(
        res,
        'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY',
      );
    });

    it('should return generateMultisigAddressEVM data when value is valid', () => {
      const res = generateMultisigAddressEVM(
        'xpub6DrK6ePttTnvR7NRoCkLEYRdNHb8y5oRbzJLeDCv8dCcGJ3yamC9y37iKpAdUnyjmeb6wphWTTRpWFHPdTe8hUDkCUN7YXM5M834FmHr9K5',
        'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY',
        0,
        1,
        'sepolia',
      );
      assert.deepEqual(res, {
        address: '0x28FF9c641b4294bb4Dab37Dc983dB8fD6ABfBA61',
      });
    });

    it('should return generateAddressKeypairEVM data when value is valid', () => {
      const res = generateAddressKeypairEVM(
        'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY',
        0,
        1,
        'sepolia',
      );
      assert.deepEqual(res, {
        privKey:
          '0x29c6fbfe8f749d4d122a3a8422e63977aaf943fb3674a927fb88f1a2833a53ad',
        pubKey:
          '0313b0012725426394a61c44a0ec4be91be554d1625d97ee6565db61b30500f8da',
      });
    });

    it('should return generateAddressKeypair data when value is valid', () => {
      const res = generateAddressKeypair(
        'xprv9zrxh8s146EdCdHxhBDKsQUtpFkeZd5aEmNjqpoJaHfdPViq3DsuREoEUX4hdmp6E4mMR2CbN5xBVYnx1jfhAADwwm1jrtMVicif7TEWjQY',
        0,
        1,
        'flux',
      );
      assert.deepEqual(res, {
        privKey: 'KxcvLgMARzhsH9ttJvxFC56aCNeYviVwN3GKXamhJb5PCPyYy6eU',
        pubKey:
          '0313b0012725426394a61c44a0ec4be91be554d1625d97ee6565db61b30500f8da',
      });
    });

    it('should return generateInternalIdentityAddress data when value is valid', () => {
      const res = generateInternalIdentityAddress(
        'xpub6DrK6ePttTnvR7NRoCkLEYRdNHb8y5oRbzJLeDCv8dCcGJ3yamC9y37iKpAdUnyjmeb6wphWTTRpWFHPdTe8hUDkCUN7YXM5M834FmHr9K5',
        'flux',
      );
      assert.equal(res, 't1UMukPYoA7hUn9GftBmHYF78Nwx6KErRBC');
    });

    it.skip('should return generatePublicNonce data when value is valid', () => {
      generatePublicNonce();
    });
  });
});
