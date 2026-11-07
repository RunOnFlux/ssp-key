/**
 * VD-3 consistency, SSP Key side: SSP Key and SSP Wallet must refuse exactly
 * the same descriptors. SSP Wallet runs the same tampered descriptors in
 * tests/lib/vaultDescriptorConsistency.spec.ts and expects the same hashes,
 * so the two canonical forms also agree beyond the five shared vectors.
 */
import fs from 'fs';
import path from 'path';

import {
  vaultDescriptorHash,
  verifyVaultDescriptor,
  xpubAttestationMessage,
  type VaultDescriptor,
} from '../../src/lib/vaultDescriptor';
import { checkRequestMatchesDescriptor } from '../../src/lib/vaultDescriptorGate';
import {
  generateAddressKeypair,
  getMasterXpriv,
  wifToPrivateKey,
} from '../../src/lib/wallet';

// jest.setup.js mocks the SDK's signMessage; this test needs real signatures.
const { fluxnode } = jest.requireActual<{
  fluxnode: {
    signMessage: (
      message: string,
      privateKeyHex: string,
      compressed: boolean,
      messagePrefix: string,
    ) => string;
  };
}>('@runonflux/flux-sdk');

interface Member {
  name: string;
  walletMnemonic: string;
  walletPubKey: string;
  wkIdentity: string;
}
const V = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'vd-vectors.json'), 'utf8'),
) as {
  members: Member[];
  vectors: Array<{
    name: string;
    descriptor: VaultDescriptor;
    descriptorHash: string;
  }>;
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const BTC = V.vectors.find((v) => v.name === 'btc-p2wsh-dual-2of3')!;
const member = (wk: string) => V.members.find((m) => m.wkIdentity === wk)!;
const ALICE = member(BTC.descriptor.members[0].wkIdentity);

/** Bitcoin message signature by a member's wallet identity key (/10/0). */
function signAsWalletIdentity(m: Member, message: string): string {
  const xpriv = getMasterXpriv(m.walletMnemonic, 48, 0, 0, 'p2wsh', 'btc');
  const identity = generateAddressKeypair(xpriv, 10, 0, 'btc');
  expect(identity.pubKey).toBe(m.walletPubKey);
  return fluxnode.signMessage(
    message,
    wifToPrivateKey(identity.privKey, 'btc'),
    true,
    '\u0018Bitcoin Signed Message:\n',
  );
}

type Raw = Record<string, unknown> & {
  members: Array<Record<string, unknown>>;
};

/**
 * Tampered copies of the BTC dual vector, each re-hashed (canonical form) so
 * only the targeted rule can refuse it. Same list, same order, same expected
 * hashes as SSP Wallet's copy of this test.
 */
const TAMPERS: Array<{
  what: string;
  /** sha256(canonicalJson) — SSP Wallet's test expects the same value. */
  hash: string;
  /** This implementation's refusal reason. */
  reason: RegExp;
  tamper: (d: Raw) => void;
}> = [
  {
    what: 'orgId not lowercase',
    hash: 'ed3332497c01ac62204f72518a5f28e95c8d6284ac59b95cc9d1f84adebe3978',
    reason: /invalid organisation id/,
    tamper: (d) => {
      d.orgId = (d.orgId as string).toUpperCase();
    },
  },
  {
    what: 'vaultId not lowercase',
    hash: 'cfc2c2102d401fa1cb6bf673335ef720a1190c7b901ff30d7b5b438ca4c5fc0f',
    reason: /invalid vault id/,
    tamper: (d) => {
      d.vaultId = (d.vaultId as string).toUpperCase();
    },
  },
  {
    what: 'signingMode null (the server always sends the effective mode)',
    hash: '41c94aea5fe890ce1071107ae2a566ce6973554770eb48e7af88b6e2d3d4b395',
    reason: /invalid signing mode/,
    tamper: (d) => {
      d.signingMode = null;
    },
  },
  {
    what: 'signingMode absent',
    hash: '41c94aea5fe890ce1071107ae2a566ce6973554770eb48e7af88b6e2d3d4b395',
    reason: /invalid signing mode/,
    tamper: (d) => {
      delete d.signingMode;
    },
  },
  {
    what: 'members not sorted by wkIdentity',
    hash: '32d32a8458abee40ac1d46c8c9a6c8369fe97fff61f01829a14b0305ce8bd894',
    reason: /not sorted and unique/,
    tamper: (d) => {
      d.members.reverse();
    },
  },
  {
    what: 'unknown descriptor field (not hashed)',
    hash: '0fdc2aff1f51820a316854249842f12d09f038c9440361e336e44b3578ca31d2',
    reason: /unexpected descriptor field note/,
    tamper: (d) => {
      d.note = 'x';
    },
  },
  {
    what: 'unknown member field (not hashed)',
    hash: '0fdc2aff1f51820a316854249842f12d09f038c9440361e336e44b3578ca31d2',
    reason: /unexpected signer entry field/,
    tamper: (d) => {
      d.members[0].note = 'x';
    },
  },
  {
    what: "a member attests another member's xpub (key reused)",
    hash: '50322f40c121409636a92cd36284bc17d89ebbee38b18aff5911b8a2892f5d21',
    reason: /reuses an xpub of another vault key/,
    tamper: (d) => {
      const bob = member(d.members[1].wkIdentity as string);
      const reused = d.members[0].xpubWallet as string;
      d.members[1].xpubWallet = reused;
      d.members[1].walletXpubSignature = signAsWalletIdentity(
        bob,
        xpubAttestationMessage(
          'wallet',
          reused,
          d.chain as string,
          d.orgIndex as number,
        ),
      );
    },
  },
];

describe('VD-3: descriptors SSP Key and SSP Wallet both refuse', () => {
  it.each(TAMPERS.map((t, i) => [t.what, i] as const))('%s', (_what, i) => {
    const d = clone(BTC.descriptor) as unknown as Raw;
    TAMPERS[i].tamper(d);
    const hash = vaultDescriptorHash(d);
    expect(hash).toBe(TAMPERS[i].hash);
    const result = verifyVaultDescriptor(
      d,
      hash,
      ALICE.wkIdentity,
      'key',
      null,
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.reason).toMatch(TAMPERS[i].reason);
  });

  it('the untampered vector still verifies', () => {
    expect(
      verifyVaultDescriptor(
        BTC.descriptor,
        BTC.descriptorHash,
        ALICE.wkIdentity,
        'key',
        null,
      ).ok,
    ).toBe(true);
  });
});

describe('VD-3: request signing mode bound to the descriptor (as on SSP Wallet)', () => {
  const request = {
    chain: BTC.descriptor.chain,
    orgIndex: BTC.descriptor.orgIndex,
    vaultIndex: BTC.descriptor.vaultIndex,
  };

  it('accepts no mode, an empty mode, or the vault mode', () => {
    for (const signingMode of [undefined, null, '', 'dual']) {
      expect(
        checkRequestMatchesDescriptor(
          { ...request, signingMode },
          BTC.descriptor,
        ),
      ).toBeNull();
    }
  });

  it('refuses another mode', () => {
    for (const signingMode of ['key_only', 'wallet_only', 'sol_dual']) {
      expect(
        checkRequestMatchesDescriptor(
          { ...request, signingMode },
          BTC.descriptor,
        ),
      ).not.toBeNull();
    }
  });
});
