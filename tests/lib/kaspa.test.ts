import * as K from '@runonflux/kaspa-core';
import {
  generateAddressKeypair,
  generateMultisigAddress,
} from '../../src/lib/wallet';
import {
  generateVaultMultisigAddressKAS,
  isKasBundlePayload,
  isValidKasAddress,
  kasBundleTxid,
} from '../../src/lib/kaspa';
import {
  KAS_LEDGER_STORAGE_KEY,
  kasSignedAmountLedger,
} from '../../src/lib/kaspaLedger';
import { storage } from '../../src/store/index';
import { blockchains } from '../../src/storage/blockchains';
import { backends } from '../../src/storage/backends';
import {
  KAS,
  MNEMONIC_KK,
  MNEMONIC_S3,
  MNEMONIC_W,
  MNEMONIC_Z,
  kasXpriv,
  kasXpub,
} from './kaspaFixtures';

/**
 * KASPA_SSP_CONTRACT.md §2 test vectors. SSP Wallet, the relay and the
 * enterprise backend reproduce the same values — a divergence here means
 * SSP Key would derive a different vault than the wallet shows.
 */

const CONSUMER = {
  walletXpub:
    'xpub6DwmUozY2BmaakpAvJfzgSGEhHS16hHtGr4pD4oQHVDgPKXJ5qPgZiz6VnEzZagxGyNs1J2m3WG2ozrXW8hFWA49pdhuYsHtch82YuDCfMv',
  keyXpub:
    'xpub6DdfuUroHv5Pxor7HHZcGiZxWUWwdCWXr62PxYUv2uSrDTJtcFreJMktPuN2TUiwsgNPD4jmWaAEgerDQUo4qSVyFUrhdXxw1FxRhARFB7k',
  leaves: [
    {
      type: 0 as const,
      index: 0,
      address:
        'kaspa:prfu8rp4ek453lkhcewmn7w9acdqms9q2pegav5vhx6zscu73xh4ux2mdv2wp',
      redeemScript:
        '5220419c6700d68f2eca22b92ddde3b4dad5923129493f497b81732b25a951e1378d20c6fbbe518f3c0d33bbfae2726e42220c36e274eaba84065d01b72543c1f2b06252ae',
    },
    {
      type: 0 as const,
      index: 1,
      address:
        'kaspa:prqacpva8h4tyslt7xe9srkrwjtsdnvss0xqy5u6uy00qwpacdrjwa2uegg0n',
      redeemScript:
        '52206196e92a4e203a5ed42756df5098b8b720f83b7bd4e7e49c138b67875fc6a7e620bcabbd9ff69b53dcfe57343ae8e7b73ef8890f145267e921f4901cff83cc9be952ae',
    },
    {
      type: 1 as const,
      index: 0,
      address:
        'kaspa:pzdvhnjd29lzfqwkg55wx36pq2ryhxn9m5ldqgjhrq39c558ac86xtjug0cee',
      redeemScript:
        '52203be7ced316198d9a2aa16da709163652ead22031710b2ffbcb1a4d7e86bea49920f4bc37170d7b5b7d35f8a969ffdab90383f08164ea848cfb6031488ddfa4038352ae',
    },
  ],
};

const ENTERPRISE_XPUBS = {
  W: 'xpub6DkDQbdPx7UVVTeqdCdSZz3Mh2V2g7qGTUsGzPN5QhsfYrmEzpkYTz6U7dnndcYBrS1EuCHcCvK3FQfWhkdJyCpC9ckAXxVYdREzvC12LaC',
  Kk: 'xpub6E73xs4aQVGrr9kyhfKAHoXN1zvKxWLwdPQaS8tqjiS9oQA1r1JjDeHGkrReH9ubYprZHwiHZK1JVFavmKLv9eNZG9iay5hDCrCVXBpRQUt',
  S3: 'xpub6Dx5wA7Btx3nUma536j4Ut6tLzMospbUMsJxtzV1YbMHr1eVZwBGEZz1ytZgfJZsDCipfuweS4EkHVSQ3cGKfttpcRLv2gZE8Nrje3H3Hmg',
  Z: 'xpub6FA3kXS5roZ948ZnUmXeURNQ2AeQdXHfp7qVRFhmJ27D847hgasgb39yVVnzC8wtMMwcRqvtCkhjPd8V121N154kRawHMXmdFqnm3SGjKg6',
};

const SINGLE_2_OF_3 = {
  address:
    'kaspa:pzk5xpfj8uf5nxm3nyqnqngg98zszv8tumtgd8k20fuac865c98529gzctrgm',
  redeemScript:
    '52203c39416674d208da840b53c98b9df6ad296fec9a3a65d1a5cad6ada0c8fb41f120681d0062b4cdf201ab1c99d1de32f20222e44b6e21d18684e294544924447e0220dc64db8c6bcce69e3bb95e880b8e5e3e3faacd70d59251b283cd08eb689dd3e853ae',
};

const DUAL_4_OF_4 = {
  address:
    'kaspa:prg4hv5wahzhnffk8q9fz3082xf9l3lewnm6shsz09vsqry9evl02fv844dxz',
  redeemScript:
    '54203c39416674d208da840b53c98b9df6ad296fec9a3a65d1a5cad6ada0c8fb41f120681d0062b4cdf201ab1c99d1de32f20222e44b6e21d18684e294544924447e0220b826d54f95c796c2bc0ef1b22e592635c9cf7561d44ff2f74c7cd7c56496480820dc64db8c6bcce69e3bb95e880b8e5e3e3faacd70d59251b283cd08eb689dd3e854ae',
};

describe('kas chain registry (contract §1)', () => {
  it('matches the cross-repo chain identity', () => {
    const kas = blockchains[KAS];
    expect(kas.chainType).toBe('kas');
    expect(kas.libid).toBe('kaspa');
    expect(kas.symbol).toBe('KAS');
    expect(kas.decimals).toBe(8);
    expect(kas.slip).toBe(111111);
    expect(kas.scriptType).toBe('p2sh');
    expect(kas.bip32).toEqual({ public: 0x0488b21e, private: 0x0488ade4 });
    expect(kas.backend).toBe('kaspa-rest');
    expect(backends()[KAS].node).toBe('api-kaspa.sspwallet.io');
    expect(backends()[KAS].explorer).toBe('explorer.kaspa.org');
  });
});

describe('consumer 2-of-2 vectors (contract §2)', () => {
  it('derives the contract account xpubs from the mnemonics', () => {
    expect(kasXpub(MNEMONIC_W, 0)).toBe(CONSUMER.walletXpub);
    expect(kasXpub(MNEMONIC_KK, 0)).toBe(CONSUMER.keyXpub);
  });

  it.each(CONSUMER.leaves)(
    'derives address + redeem script at $type-$index',
    ({ type, index, address, redeemScript }) => {
      const r = generateMultisigAddress(
        CONSUMER.walletXpub,
        CONSUMER.keyXpub,
        type,
        index,
        KAS,
      );
      expect(r.address).toBe(address);
      expect(r.redeemScript).toBe(redeemScript);
      expect(r.witnessScript).toBeUndefined();
      // key order does not matter: the library sorts
      expect(
        generateMultisigAddress(
          CONSUMER.keyXpub,
          CONSUMER.walletXpub,
          type,
          index,
          KAS,
        ).address,
      ).toBe(address);
      expect(isValidKasAddress(address, KAS)).toBe(true);
    },
  );

  it("the key's own signing key at 0-0 is in the vault redeem script", () => {
    const kp = generateAddressKeypair(kasXpriv(MNEMONIC_KK, 0), 0, 0, KAS);
    expect(kp.privKey).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.pubKey).toMatch(/^[0-9a-f]{64}$/);
    expect(CONSUMER.leaves[0].redeemScript).toContain(kp.pubKey);
  });
});

describe('enterprise vectors (contract §2)', () => {
  it('derives the org-100 signer xpubs', () => {
    expect(kasXpub(MNEMONIC_W, 100)).toBe(ENTERPRISE_XPUBS.W);
    expect(kasXpub(MNEMONIC_KK, 100)).toBe(ENTERPRISE_XPUBS.Kk);
    expect(kasXpub(MNEMONIC_S3, 100)).toBe(ENTERPRISE_XPUBS.S3);
    expect(kasXpub(MNEMONIC_Z, 100)).toBe(ENTERPRISE_XPUBS.Z);
  });

  it('single-device 2-of-3 from the xpubs', () => {
    expect(
      generateVaultMultisigAddressKAS(
        [ENTERPRISE_XPUBS.W, ENTERPRISE_XPUBS.Kk, ENTERPRISE_XPUBS.S3],
        2,
        0,
        0,
        KAS,
      ),
    ).toEqual(SINGLE_2_OF_3);
  });

  it("single-device 2-of-3 from each signer's own vault signing key", () => {
    // What handleVaultSignAction derives: xpriv at m/48'/111111'/100'/0',
    // leaf vaultIndex/addressIndex.
    const keys = [MNEMONIC_W, MNEMONIC_KK, MNEMONIC_S3].map((m) =>
      K.hexToBytes(generateAddressKeypair(kasXpriv(m, 100), 0, 0, KAS).pubKey),
    );
    const spend = K.multisigSpend(keys, 2);
    if (spend.kind !== 'p2sh-multisig') throw new Error('unreachable');
    expect(K.bytesToHex(spend.redeem)).toBe(SINGLE_2_OF_3.redeemScript);
    expect(
      K.scriptPublicKeyToAddress(K.spendScriptPublicKey(spend), 'kaspa'),
    ).toBe(SINGLE_2_OF_3.address);
  });

  it('dual 2-of-2 signers → 4-of-4 keys', () => {
    expect(
      generateVaultMultisigAddressKAS(
        [
          ENTERPRISE_XPUBS.W,
          ENTERPRISE_XPUBS.Kk,
          ENTERPRISE_XPUBS.S3,
          ENTERPRISE_XPUBS.Z,
        ],
        4,
        0,
        0,
        KAS,
      ),
    ).toEqual(DUAL_4_OF_4);
  });
});

describe('bundle helpers', () => {
  it('recognises only kaspa-core signing bundles', () => {
    expect(isKasBundlePayload('{"format":"kaspa-core-signing-bundle"}')).toBe(
      false, // wrong version
    );
    expect(isKasBundlePayload('deadbeef')).toBe(false);
    expect(() => kasBundleTxid('{}')).toThrow('not a signing bundle');
  });
});

describe('persistent signed-amount ledger', () => {
  const outpoint = `${'ab'.repeat(32)}:3`;

  it('persists to MMKV and reads back as bigint', () => {
    expect(kasSignedAmountLedger.get(outpoint)).toBeUndefined();
    kasSignedAmountLedger.set(outpoint, 123456789n);
    expect(kasSignedAmountLedger.get(outpoint)).toBe(123456789n);
    // stored durably under its own MMKV key, not in memory
    const raw = JSON.parse(
      storage.getString(KAS_LEDGER_STORAGE_KEY) as string,
    ) as Record<string, string>;
    expect(raw[outpoint]).toBe('123456789');
  });

  it('refuses a corrupt ledger instead of treating it as empty', () => {
    const saved = storage.getString(KAS_LEDGER_STORAGE_KEY) as string;
    storage.set(KAS_LEDGER_STORAGE_KEY, '[1,2]');
    expect(() => kasSignedAmountLedger.get(outpoint)).toThrow('corrupt');
    storage.set(KAS_LEDGER_STORAGE_KEY, saved);
  });

  it('refuses malformed outpoints', () => {
    expect(() => kasSignedAmountLedger.set('nope', 1n)).toThrow();
  });
});
