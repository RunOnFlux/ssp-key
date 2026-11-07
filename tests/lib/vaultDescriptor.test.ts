/**
 * Vault descriptor v1 (VD-1 / VD-3 / VD-4) against the shared cross-
 * implementation vectors generated from the real relay-enterprise code
 * (vaultService.submitXpub, vaultDescriptorService, vaultAddressService).
 *
 * The vectors are copied into tests/lib/fixtures/vd-vectors.json so the suite
 * runs without the coordination checkout; when the shared file is present it
 * must be identical to the copy.
 */
import fs from 'fs';
import path from 'path';

import {
  canonicalDescriptorJson,
  deriveVaultAddress,
  vaultDescriptorHash,
  verifyVaultDescriptor,
  wkIdentityOf,
  type VaultDescriptor,
} from '../../src/lib/vaultDescriptor';
import {
  generateAddressKeypair,
  generateSolanaPubkeyArray,
  getMasterXpriv,
  getMasterXpub,
} from '../../src/lib/wallet';
import { blockchains } from '../../src/storage/blockchains';
import type { cryptos } from '../../src/types';

interface VectorMember {
  name: string;
  walletMnemonic: string;
  keyMnemonic: string;
  walletPubKey: string;
  keyPubKey: string;
  wkWitnessScript: string;
  wkIdentity: string;
}

interface DerivedVector {
  typeIndex: number;
  addressIndex: number;
  address: string;
  childPubKeys?: Array<{ wkIdentity: string; device: string; pubKey: string }>;
  witnessScript?: string | null;
  redeemScript?: string | null;
  scriptPubKey?: string;
  multisigPda?: string;
  vaultPda?: string;
  solanaMembersSorted?: string[];
  solanaThreshold?: number;
}

interface Vector {
  name: string;
  descriptor: VaultDescriptor;
  canonicalJson: string;
  descriptorHash: string;
  derived: DerivedVector[];
}

interface Vectors {
  members: VectorMember[];
  vectors: Vector[];
  negativeHashVectors: Array<{
    what: string;
    canonicalJson: string;
    descriptorHash: string;
  }>;
}

const FIXTURE = path.join(__dirname, 'fixtures', 'vd-vectors.json');
const SHARED = path.join(__dirname, '..', '..', '..', 'vd-vectors.json');
const raw = fs.readFileSync(FIXTURE, 'utf8');
const V = JSON.parse(raw) as Vectors;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const memberByWk = (wk: string) =>
  V.members.find((m) => m.wkIdentity === wk) as VectorMember;

/** The account "xpub" this device would compute itself for a vault. */
function ownAccountXpub(mnemonic: string, descriptor: VaultDescriptor): string {
  const chain = descriptor.chain as keyof cryptos;
  const config = blockchains[chain];
  if ((config as { chainType?: string }).chainType === 'sol') {
    const xpriv = getMasterXpriv(
      mnemonic,
      48,
      config.slip,
      descriptor.orgIndex,
      config.scriptType,
      chain,
    );
    return JSON.stringify(
      generateSolanaPubkeyArray(xpriv, chain, descriptor.vaultIndex),
    );
  }
  return getMasterXpub(
    mnemonic,
    48,
    config.slip,
    descriptor.orgIndex,
    config.scriptType,
    chain,
  );
}

/** Re-hashes a tampered descriptor so only the targeted check can fail. */
const rehashed = (descriptor: VaultDescriptor) => ({
  descriptor,
  hash: vaultDescriptorHash(descriptor),
});

describe('shared vectors file', () => {
  it('the in-repo copy equals the shared vd-vectors.json when it is present', () => {
    if (!fs.existsSync(SHARED)) {
      return;
    }
    expect(JSON.parse(fs.readFileSync(SHARED, 'utf8'))).toEqual(V);
  });

  it('covers UTXO, EVM and Solana vectors', () => {
    const chains = V.vectors.map((v) => v.descriptor.chain);
    expect(chains).toEqual(
      expect.arrayContaining(['btc', 'flux', 'eth', 'solMainnet']),
    );
  });
});

describe('canonical JSON + hash (VD-1)', () => {
  it.each(V.vectors.map((v) => [v.name, v] as const))(
    '%s: canonical JSON and hash match the server byte for byte',
    (_name, vector) => {
      expect(canonicalDescriptorJson(vector.descriptor)).toBe(
        vector.canonicalJson,
      );
      expect(vaultDescriptorHash(vector.descriptor)).toBe(
        vector.descriptorHash,
      );
    },
  );

  it('negative vectors hash as the server says and differ from the original', () => {
    for (const negative of V.negativeHashVectors) {
      const parsed = JSON.parse(negative.canonicalJson) as VaultDescriptor;
      expect(canonicalDescriptorJson(parsed)).toBe(negative.canonicalJson);
      expect(vaultDescriptorHash(parsed)).toBe(negative.descriptorHash);
      expect(negative.descriptorHash).not.toBe(V.vectors[0].descriptorHash);
    }
  });

  it('ignores unknown keys, writes null for missing values and refuses non-scalars', () => {
    const d = clone(V.vectors[0].descriptor) as unknown as Record<
      string,
      unknown
    >;
    expect(canonicalDescriptorJson({ ...d, extra: 'x' })).toBe(
      V.vectors[0].canonicalJson,
    );
    const withoutMode = { ...d };
    delete withoutMode.signingMode;
    expect(canonicalDescriptorJson(withoutMode)).toContain(
      '"signingMode":null',
    );
    expect(() => canonicalDescriptorJson({ ...d, orgIndex: true })).toThrow();
    expect(() =>
      canonicalDescriptorJson({ ...d, chain: { nested: 'btc' } }),
    ).toThrow();
  });
});

describe('WK identity (VD-3 item 3)', () => {
  it.each(V.members.map((m) => [m.name, m] as const))(
    '%s: the 2-of-2 P2WSH of the identity keys is the WK identity',
    (_name, member) => {
      expect(wkIdentityOf(member.walletPubKey, member.keyPubKey, false)).toBe(
        member.wkIdentity,
      );
      // order-independent (sorted like the WK identity is built)
      expect(wkIdentityOf(member.keyPubKey, member.walletPubKey, false)).toBe(
        member.wkIdentity,
      );
    },
  );
});

describe('verifyVaultDescriptor (VD-3)', () => {
  const cases = V.vectors.flatMap((vector) =>
    vector.descriptor.members.map(
      (m) =>
        [
          `${vector.name} as ${memberByWk(m.wkIdentity).name}`,
          vector,
          m,
        ] as const,
    ),
  );

  it.each(cases)(
    '%s: verifies for the Key with its own account xpub',
    (_label, vector, member) => {
      const own = memberByWk(member.wkIdentity);
      const result = verifyVaultDescriptor(
        vector.descriptor,
        vector.descriptorHash,
        own.wkIdentity,
        'key',
        ownAccountXpub(own.keyMnemonic, vector.descriptor),
        { ownIdentityPubKey: own.keyPubKey },
      );
      expect(result).toMatchObject({ ok: true, ownXpubChecked: true });
    },
  );

  it.each(cases)(
    '%s: verifies for the wallet role with the wallet account xpub',
    (_label, vector, member) => {
      const own = memberByWk(member.wkIdentity);
      const result = verifyVaultDescriptor(
        vector.descriptor,
        vector.descriptorHash,
        own.wkIdentity,
        'wallet',
        ownAccountXpub(own.walletMnemonic, vector.descriptor),
        { ownIdentityPubKey: own.walletPubKey },
      );
      expect(result.ok).toBe(true);
    },
  );

  const base = V.vectors[0];
  const alice = memberByWk(base.descriptor.members[0].wkIdentity);
  const aliceXpub = ownAccountXpub(alice.keyMnemonic, base.descriptor);
  const verifyAsAlice = (descriptor: unknown, hash: unknown) =>
    verifyVaultDescriptor(
      descriptor,
      hash,
      alice.wkIdentity,
      'key',
      aliceXpub,
      {
        ownIdentityPubKey: alice.keyPubKey,
      },
    );

  it('refuses a descriptor whose hash does not match', () => {
    const d = clone(base.descriptor);
    d.requiredSigners = 1;
    expect(verifyAsAlice(d, base.descriptorHash)).toEqual({
      ok: false,
      reason: 'descriptor hash does not match',
    });
    expect(verifyAsAlice(base.descriptor, undefined).ok).toBe(false);
    expect(verifyAsAlice(base.descriptor, 'ab').ok).toBe(false);
  });

  it('refuses unsorted members even when the hash matches (negative vector)', () => {
    const reversed = V.negativeHashVectors.find((n) =>
      n.what.includes('reversed'),
    );
    expect(reversed).toBeDefined();
    const parsed = JSON.parse(reversed!.canonicalJson) as unknown;
    const result = verifyAsAlice(parsed, reversed!.descriptorHash);
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(/sorted/);
  });

  it('refuses a duplicate signer', () => {
    const d = clone(base.descriptor);
    d.members = [d.members[0], d.members[0], d.members[1]];
    const { hash } = rehashed(d);
    expect(verifyAsAlice(d, hash).ok).toBe(false);
  });

  it('refuses shapes outside the server limits', () => {
    const tweaks: Array<(d: VaultDescriptor) => void> = [
      (d) => {
        d.orgIndex = 99; // recovery account
      },
      (d) => {
        d.orgIndex = 0; // consumer account
      },
      (d) => {
        d.vaultIndex = -1;
      },
      (d) => {
        d.requiredSigners = 4; // > N
      },
      (d) => {
        d.requiredSigners = 0;
      },
      (d) => {
        (d as unknown as Record<string, unknown>).v = 2;
      },
      (d) => {
        (d as unknown as Record<string, unknown>).signingMode = 'sol_dual';
      },
      (d) => {
        d.chain = 'dogeish';
      },
      (d) => {
        // 8 dual UTXO signers > 7
        d.members = Array.from({ length: 8 }, (_, i) => ({
          ...d.members[0],
          wkIdentity: `bc1q${String(i).padStart(3, '0')}`,
        }));
      },
    ];
    for (const tweak of tweaks) {
      const d = clone(base.descriptor);
      tweak(d);
      const { hash } = rehashed(d);
      expect(verifyAsAlice(d, hash).ok).toBe(false);
    }
  });

  it('refuses a member whose identity keys do not build its WK identity', () => {
    const d = clone(base.descriptor);
    d.members[1].keyPubKey = d.members[2].keyPubKey;
    const { hash } = rehashed(d);
    const result = verifyAsAlice(d, hash);
    expect(result.ok ? '' : result.reason).toMatch(/WK identity/);
  });

  it('refuses identical wallet and key identity keys (H-5 sibling)', () => {
    const d = clone(base.descriptor);
    d.members[1].keyPubKey = d.members[1].walletPubKey;
    const { hash } = rehashed(d);
    const result = verifyAsAlice(d, hash);
    expect(result.ok ? '' : result.reason).toMatch(/same key/);
  });

  it('refuses an invalid compressed key', () => {
    const d = clone(base.descriptor);
    d.members[1].walletPubKey = `02${'00'.repeat(32)}`;
    const { hash } = rehashed(d);
    expect(verifyAsAlice(d, hash).ok).toBe(false);
  });

  it('refuses a swapped xpub: the attestation no longer verifies', () => {
    const d = clone(base.descriptor);
    // bob's key xpub replaced by carol's (attested by carol, not bob)
    d.members[1].xpubKey = d.members[2].xpubKey;
    const { hash } = rehashed(d);
    const result = verifyAsAlice(d, hash);
    expect(result.ok ? '' : result.reason).toMatch(/attestation/);
  });

  it('refuses swapped wallet/key identity keys (same WK identity, attestations fail)', () => {
    const d = clone(base.descriptor);
    const m = d.members[1];
    [m.walletPubKey, m.keyPubKey] = [m.keyPubKey, m.walletPubKey];
    const { hash } = rehashed(d);
    const result = verifyAsAlice(d, hash);
    expect(result.ok ? '' : result.reason).toMatch(/attestation/);
  });

  it('refuses a missing attestation for an xpub the mode uses', () => {
    const d = clone(base.descriptor);
    d.members[2].walletXpubSignature = null;
    const { hash } = rehashed(d);
    expect(verifyAsAlice(d, hash).ok).toBe(false);
  });

  it('refuses an attestation over another chain or org index', () => {
    // same keys, different orgIndex: every signed message changes
    const d = clone(base.descriptor);
    d.orgIndex = 1338;
    const { hash } = rehashed(d);
    const result = verifyAsAlice(d, hash);
    expect(result.ok ? '' : result.reason).toMatch(/attestation/);
  });

  it('item 5: refuses when this device is not a signer', () => {
    const result = verifyVaultDescriptor(
      base.descriptor,
      base.descriptorHash,
      'bc1qsomeoneelse',
      'key',
      null,
    );
    expect(result.ok ? '' : result.reason).toMatch(/not a signer/);
  });

  it("item 5: refuses when the vault lists another key xpub for this device's role", () => {
    const bob = memberByWk(base.descriptor.members[1].wkIdentity);
    const result = verifyVaultDescriptor(
      base.descriptor,
      base.descriptorHash,
      alice.wkIdentity,
      'key',
      ownAccountXpub(bob.keyMnemonic, base.descriptor),
    );
    expect(result.ok ? '' : result.reason).toMatch(/not this device's key/);
    // wallet xpub presented for the key role
    const asWallet = verifyVaultDescriptor(
      base.descriptor,
      base.descriptorHash,
      alice.wkIdentity,
      'key',
      ownAccountXpub(alice.walletMnemonic, base.descriptor),
    );
    expect(asWallet.ok).toBe(false);
  });

  it('item 5: refuses when the own identity pubkey differs', () => {
    const result = verifyVaultDescriptor(
      base.descriptor,
      base.descriptorHash,
      alice.wkIdentity,
      'key',
      aliceXpub,
      { ownIdentityPubKey: alice.walletPubKey },
    );
    expect(result.ok).toBe(false);
  });

  it('receipt time (no own xpub): verifies everything else and reports it', () => {
    const result = verifyVaultDescriptor(
      base.descriptor,
      base.descriptorHash,
      alice.wkIdentity,
      'key',
      null,
    );
    expect(result).toMatchObject({ ok: true, ownXpubChecked: false });
  });

  it('Solana: refuses a tampered leaf array and a reused leaf', () => {
    const sol = V.vectors.find((v) => v.descriptor.signingMode === 'sol_dual')!;
    const solAlice = memberByWk(sol.descriptor.members[0].wkIdentity);
    const d = clone(sol.descriptor);
    const leaves = JSON.parse(d.members[1].xpubKey as string) as string[];
    leaves[3] = leaves[4];
    d.members[1].xpubKey = JSON.stringify(leaves);
    const { hash } = rehashed(d);
    expect(
      verifyVaultDescriptor(d, hash, solAlice.wkIdentity, 'key', null).ok,
    ).toBe(false);
  });
});

describe('deriveVaultAddress (VD-4) reproduces vaultAddressService', () => {
  const derivedCases = V.vectors.flatMap((vector) =>
    vector.derived.map(
      (d) =>
        [
          `${vector.name} @ ${d.typeIndex}/${d.addressIndex}`,
          vector,
          d,
        ] as const,
    ),
  );

  it.each(derivedCases)('%s', (_label, vector, expected) => {
    const derived = deriveVaultAddress(
      vector.descriptor,
      expected.typeIndex,
      expected.addressIndex,
    );
    expect(derived.address).toBe(expected.address);
    if (derived.family === 'sol') {
      expect(derived.multisigPda).toBe(expected.multisigPda);
      expect(derived.vaultPda).toBe(expected.vaultPda);
      expect(derived.pubKeys).toEqual(expected.solanaMembersSorted);
      expect(derived.threshold).toBe(expected.solanaThreshold);
      return;
    }
    expect(derived.pubKeys).toEqual(
      (expected.childPubKeys ?? []).map((k) => k.pubKey),
    );
    if (derived.family === 'utxo') {
      expect(derived.witnessScript ?? null).toBe(
        expected.witnessScript ?? null,
      );
      expect(derived.redeemScript ?? null).toBe(expected.redeemScript ?? null);
      expect(derived.scriptPubKey).toBe(expected.scriptPubKey);
    }
  });

  it("this device's own vault key at the address is one of the derived keys", () => {
    const vector = V.vectors[0];
    const alice = memberByWk(vector.descriptor.members[0].wkIdentity);
    const config = blockchains.btc;
    const xpriv = getMasterXpriv(
      alice.keyMnemonic,
      48,
      config.slip,
      vector.descriptor.orgIndex,
      config.scriptType,
      'btc',
    );
    const own = generateAddressKeypair(
      xpriv,
      vector.descriptor.vaultIndex,
      1,
      'btc',
    );
    expect(
      deriveVaultAddress(vector.descriptor, vector.descriptor.vaultIndex, 1)
        .pubKeys,
    ).toContain(own.pubKey);
  });
});
