/**
 * Pins the recovery account's derivation path and the wallet-side contract it
 * has to satisfy.
 *
 * The path is BIP-48 with no special casing:
 *
 *   m/48' / coin_type' / account' / script_type' / change / address_index
 *   m/48' /        0'   /    99'   /       2'     /   0    /      i        (btc)
 *
 * `account' = 99'` sits in the gap SSP leaves between the consumer account (0')
 * and the enterprise org indices (100'-99999'); `script_type'` keeps the
 * chain's own value, so the same helper the signing account uses produces this
 * one. `change` and `address_index` stay non-hardened, which is what lets the
 * wallet derive pk_r(i) from the published account xpub and use a fresh i per
 * envelope.
 */
import { HDKey } from '@scure/bip32';
import { Buffer } from 'buffer';

// Override the global jest.setup.js mock for `react-native-quick-crypto` with
// real Node crypto — the global mock only stubs randomBytes+createHash, and
// buildRecoveryResponse needs ECDH + AES-GCM. Same shim as
// tests/lib/recoveryHandler.test.ts.
jest.mock('react-native-quick-crypto', () => {
  // The `react-native` preset aliases `crypto` to react-native-quick-crypto,
  // so requireActual('crypto') would recurse into the module being mocked.
  const nodeCrypto = jest.requireActual('node:crypto');
  return {
    __esModule: true,
    default: {
      randomBytes: nodeCrypto.randomBytes,
      createHash: nodeCrypto.createHash,
      createECDH: nodeCrypto.createECDH,
      createCipheriv: nodeCrypto.createCipheriv,
      createDecipheriv: nodeCrypto.createDecipheriv,
    },
  };
});

import { blockchains } from '@storage/blockchains';
import {
  deriveRecoveryAccount,
  RECOVERY_ACCOUNT_INDEX,
  RECOVERY_CHANGE_INDEX,
} from '../../src/lib/recoveryAccount';
import {
  buildRecoveryResponse,
  resetAnsweredNonces,
} from '../../src/lib/recoveryHandler';
import {
  getMasterXpriv,
  getMasterXpub,
  getScriptType,
} from '../../src/lib/wallet';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PK_EPH = '02' + 'ab'.repeat(32);

describe('recovery account derivation path', () => {
  beforeEach(() => {
    resetAnsweredNonces();
  });

  it("is m/48'/0'/99'/2' on btc", () => {
    expect(RECOVERY_ACCOUNT_INDEX).toBe(99);
    expect(RECOVERY_CHANGE_INDEX).toBe(0);
    // btc's own BIP-48 values, unmodified: coin_type 0, script_type p2wsh = 2.
    expect(blockchains.btc.slip).toBe(0);
    expect(getScriptType(blockchains.btc.scriptType)).toBe(2);

    const account = deriveRecoveryAccount(MNEMONIC, 'btc');
    expect(account.xpriv).toBe(
      getMasterXpriv(MNEMONIC, 48, 0, 99, 'p2wsh', 'btc'),
    );
    expect(account.xpub).toBe(
      getMasterXpub(MNEMONIC, 48, 0, 99, 'p2wsh', 'btc'),
    );

    // Derived straight from the master seed too, so the path is pinned
    // independently of the wallet helpers.
    const bip39 = jest.requireActual('@scure/bip39');
    const master = HDKey.fromMasterSeed(
      bip39.mnemonicToSeedSync(MNEMONIC),
      blockchains.btc.bip32,
    );
    expect(account.xpub).toBe(
      master.derive("m/48'/0'/99'/2'").publicExtendedKey,
    );
  });

  it("sits at its own account' index, hardened", () => {
    const account = deriveRecoveryAccount(MNEMONIC, 'btc');
    const signing = getMasterXpub(MNEMONIC, 48, 0, 0, 'p2wsh', 'btc');
    expect(account.xpub).not.toBe(signing);

    // 99' is hardened: not derivable from the signing account's xpub.
    const signingPub = HDKey.fromExtendedKey(signing, blockchains.btc.bip32);
    expect(() => signingPub.deriveChild(99 + 0x80000000)).toThrow();
  });

  it('publishes an xpub from which the wallet derives pk_r(i) itself', () => {
    const account = deriveRecoveryAccount(MNEMONIC, 'btc');
    const bip32 = blockchains.btc.bip32;

    for (const index of [0, 1, 42, 0x7ffffffe]) {
      const fromXpub = HDKey.fromExtendedKey(account.xpub, bip32)
        .deriveChild(RECOVERY_CHANGE_INDEX)
        .deriveChild(index);
      const fromXpriv = HDKey.fromExtendedKey(account.xpriv, bip32)
        .deriveChild(RECOVERY_CHANGE_INDEX)
        .deriveChild(index);

      // Same key, and the published half carries no private material.
      expect(Buffer.from(fromXpub.publicKey!).toString('hex')).toBe(
        Buffer.from(fromXpriv.publicKey!).toString('hex'),
      );
      expect(fromXpub.privateKey).toBeNull();
    }
  });

  it('the handler releases sk_r from this account at the requested index', () => {
    const account = deriveRecoveryAccount(MNEMONIC, 'btc');
    const bip32 = blockchains.btc.bip32;

    const response = buildRecoveryResponse({
      xprivRecovery: account.xpriv,
      xprivKeyIdentity: getMasterXpriv(MNEMONIC, 48, 0, 0, 'p2wsh', 'btc'),
      request: {
        pkEph: PK_EPH,
        nonce: 'cd'.repeat(16),
        timestamp: Date.now(),
        recoveryIndex: 3,
      },
      identityChain: 'btc',
    });

    expect(response.version).toBe(2);
    expect(response.recoveryIndex).toBe(3);

    // The wallet seals to pk_r(3) derived from the account xpub; that must be
    // the public half of the key the handler released.
    const pkR3 = HDKey.fromExtendedKey(account.xpub, bip32)
      .deriveChild(RECOVERY_CHANGE_INDEX)
      .deriveChild(3);
    const skR3 = HDKey.fromExtendedKey(account.xpriv, bip32)
      .deriveChild(RECOVERY_CHANGE_INDEX)
      .deriveChild(3);
    expect(Buffer.from(skR3.publicKey!).toString('hex')).toBe(
      Buffer.from(pkR3.publicKey!).toString('hex'),
    );
  });
});
