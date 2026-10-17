/**
 * Per-request vault descriptor checks (VD-3 pin states, VD-4 derivations)
 * against the shared vectors (tests/lib/fixtures/vd-vectors.json).
 */
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import utxolib from '@runonflux/utxo-lib';

import {
  checkFluxNodeCollateral,
  checkRequestMatchesDescriptor,
  checkVaultEvmAccount,
  checkVaultUtxoTransaction,
  commitVaultPin,
  evaluateVaultDescriptor,
  fluxNodeFingerprint,
  fluxNodeRequestFingerprint,
  requireVaultDescriptor,
  vaultSolBinding,
  VaultDescriptorError,
} from '../../src/lib/vaultDescriptorGate';
import {
  deriveVaultAddress,
  vaultDescriptorHash,
  type VaultDescriptor,
} from '../../src/lib/vaultDescriptor';
import {
  clearVaultRequestState,
  getVaultPin,
  isVaultPinStaged,
  pinVaultDescriptor,
  publishVaultVerdict,
  readVaultPins,
  resetAllVaultPins,
  resetVaultPin,
  stageVaultPinConfirmation,
  vaultKeySlotKey,
  vaultPinKey,
  vaultSlotKey,
} from '../../src/lib/vaultPins';
import { createMMKV } from 'react-native-mmkv';

interface Vector {
  name: string;
  descriptor: VaultDescriptor;
  descriptorHash: string;
}
const V = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'vd-vectors.json'), 'utf8'),
) as {
  members: Array<{ wkIdentity: string; keyPubKey: string }>;
  vectors: Vector[];
};
const vector = (name: string) => V.vectors.find((v) => v.name === name)!;
const BTC = vector('btc-p2wsh-dual-2of3');
const FLUX = vector('flux-p2sh-key_only-2of3');
const ETH = vector('eth-evm-dual-1of2');
const SOL = vector('solMainnet-sol_dual-2of3');
const ALICE = V.members[0];

const own = {
  wkIdentity: ALICE.wkIdentity,
  identityPubKey: ALICE.keyPubKey,
  accountXpub: null,
};

const request = (v: Vector, overrides: Record<string, unknown> = {}) => ({
  chain: v.descriptor.chain,
  orgIndex: v.descriptor.orgIndex,
  vaultIndex: v.descriptor.vaultIndex,
  vaultDescriptor: v.descriptor,
  vaultDescriptorHash: v.descriptorHash,
  ...overrides,
});

beforeEach(() => {
  createMMKV().clearAll();
  resetAllVaultPins();
});

describe('evaluateVaultDescriptor (VD-3)', () => {
  it('refuses a request without a descriptor: update required', () => {
    const verdict = evaluateVaultDescriptor(
      { chain: 'btc', orgIndex: 1337, vaultIndex: 3 },
      own,
    );
    expect(verdict).toEqual({
      kind: 'refused',
      code: 'missing',
      reason: 'Update required: vault descriptor missing',
    });
    expect(
      evaluateVaultDescriptor(
        request(BTC, { vaultDescriptorHash: undefined }),
        own,
      ),
    ).toMatchObject({ kind: 'refused', code: 'missing' });
  });

  it('first sight needs the pin confirmation; a confirmed pin is ok but not yet saved', () => {
    const first = evaluateVaultDescriptor(request(BTC), own);
    expect(first).toMatchObject({
      kind: 'needs_pin',
      hash: BTC.descriptorHash,
      pinKey: `${BTC.descriptor.orgId}:${BTC.descriptor.vaultId}`,
    });
    stageVaultPinConfirmation(
      vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId),
      BTC.descriptorHash,
    );
    const staged = requireVaultDescriptor(request(BTC), own);
    expect(staged).toMatchObject({ kind: 'ok', persisted: false });
    commitVaultPin(staged, 'Treasury');
    expect(
      getVaultPin(vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId)),
    ).toMatchObject({ hash: BTC.descriptorHash, vaultName: 'Treasury' });
    expect(evaluateVaultDescriptor(request(BTC), own)).toMatchObject({
      kind: 'ok',
      persisted: true,
    });
  });

  it('a confirmation of another descriptor for the same vault does not count', () => {
    stageVaultPinConfirmation(
      vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId),
      'f'.repeat(64),
    );
    expect(() => requireVaultDescriptor(request(BTC), own)).toThrow(
      VaultDescriptorError,
    );
    try {
      requireVaultDescriptor(request(BTC), own);
    } catch (error) {
      expect((error as VaultDescriptorError).code).toBe('unconfirmed');
    }
  });

  it('hard-refuses a pinned vault whose descriptor changed, until the pin is reset', () => {
    pinVaultDescriptor(BTC.descriptor, 'e'.repeat(64));
    const verdict = evaluateVaultDescriptor(request(BTC), own);
    expect(verdict).toMatchObject({ kind: 'refused', code: 'mismatch' });
    // re-pinning over a different pin is refused too
    expect(() =>
      pinVaultDescriptor(BTC.descriptor, BTC.descriptorHash),
    ).toThrow();
    resetVaultPin(vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId));
    expect(evaluateVaultDescriptor(request(BTC), own).kind).toBe('needs_pin');
  });

  it('slot attack: same slot, NEW vaultId, different signer set is a hard refusal, not a first-sight prompt', () => {
    // the genuine vault is pinned
    stageVaultPinConfirmation(
      vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId),
      BTC.descriptorHash,
    );
    commitVaultPin(requireVaultDescriptor(request(BTC), own), 'Treasury');
    expect(
      getVaultPin(vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId)),
    ).toMatchObject({
      slot: vaultSlotKey(
        BTC.descriptor.orgId,
        BTC.descriptor.chain,
        BTC.descriptor.orgIndex,
        BTC.descriptor.vaultIndex,
      ),
    });
    // the server re-presents the same key slot (org, chain, orgIndex,
    // vaultIndex) under a new vaultId with another signer set. The
    // attestations do not bind the vaultId or the member set, so it verifies.
    const dropped = BTC.descriptor.members.find(
      (m) => m.wkIdentity !== ALICE.wkIdentity,
    )!;
    const attack: VaultDescriptor = {
      ...BTC.descriptor,
      vaultId: '66f1a0000000000000000bad',
      members: BTC.descriptor.members.filter((m) => m !== dropped),
    };
    const attackHash = vaultDescriptorHash(attack);
    const attackRequest = request(BTC, {
      vaultDescriptor: attack,
      vaultDescriptorHash: attackHash,
    });
    expect(evaluateVaultDescriptor(attackRequest, own)).toMatchObject({
      kind: 'refused',
      code: 'mismatch',
    });
    // a staged confirmation cannot get around it, nor can a direct pin
    stageVaultPinConfirmation(
      vaultPinKey(attack.orgId, attack.vaultId),
      attackHash,
    );
    expect(() => requireVaultDescriptor(attackRequest, own)).toThrow(
      VaultDescriptorError,
    );
    expect(() => pinVaultDescriptor(attack, attackHash)).toThrow(
      /slot is pinned to a different configuration/,
    );
    // the genuine vault keeps working
    expect(evaluateVaultDescriptor(request(BTC), own)).toMatchObject({
      kind: 'ok',
      persisted: true,
    });
  });

  it('orgId-free slot: a NEW orgId with the same chain/orgIndex/vaultIndex and another signer set is a hard refusal', () => {
    pinVaultDescriptor(BTC.descriptor, BTC.descriptorHash);
    expect(
      getVaultPin(vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId)),
    ).toMatchObject({
      keySlot: vaultKeySlotKey(
        BTC.descriptor.chain,
        BTC.descriptor.orgIndex,
        BTC.descriptor.vaultIndex,
      ),
    });
    const dropped = BTC.descriptor.members.find(
      (m) => m.wkIdentity !== ALICE.wkIdentity,
    )!;
    // a relay invents an organisation with the same (server-unique) orgIndex
    const attack: VaultDescriptor = {
      ...BTC.descriptor,
      orgId: '66f1a00000000000000000ff',
      vaultId: '66f1a0000000000000000bad',
      members: BTC.descriptor.members.filter((m) => m !== dropped),
    };
    const attackHash = vaultDescriptorHash(attack);
    const attackRequest = request(BTC, {
      vaultDescriptor: attack,
      vaultDescriptorHash: attackHash,
    });
    expect(evaluateVaultDescriptor(attackRequest, own)).toMatchObject({
      kind: 'refused',
      code: 'mismatch',
    });
    expect(() => pinVaultDescriptor(attack, attackHash)).toThrow(
      /slot is pinned to a different configuration/,
    );
    // the same vault under another orgIndex is a different slot
    resetAllVaultPins();
    pinVaultDescriptor(
      {
        ...BTC.descriptor,
        vaultId: 'another-vault',
        orgIndex: BTC.descriptor.orgIndex + 1,
      },
      'a'.repeat(64),
    );
    expect(evaluateVaultDescriptor(request(BTC), own).kind).toBe('needs_pin');
  });

  it('derives the orgId-free slot of a stored pin without slot fields (migration on read)', () => {
    createMMKV({ id: 'ssp-vault-descriptor-pins' }).set(
      'vaultDescriptorPins',
      JSON.stringify({
        'other-org:other-vault': {
          hash: 'b'.repeat(64),
          orgId: 'other-org',
          vaultId: 'other-vault',
          chain: BTC.descriptor.chain,
          orgIndex: BTC.descriptor.orgIndex,
          vaultIndex: BTC.descriptor.vaultIndex,
          signingMode: 'dual',
          requiredSigners: 2,
          totalSigners: 3,
          pinnedAt: 1,
        },
      }),
    );
    expect(evaluateVaultDescriptor(request(BTC), own)).toMatchObject({
      kind: 'refused',
      code: 'mismatch',
    });
  });

  it('derives the slot of a stored pin without a slot field (migration on read)', () => {
    const key = vaultPinKey(BTC.descriptor.orgId, 'older-vault');
    createMMKV({ id: 'ssp-vault-descriptor-pins' }).set(
      'vaultDescriptorPins',
      JSON.stringify({
        [key]: {
          hash: 'a'.repeat(64),
          orgId: BTC.descriptor.orgId,
          vaultId: 'older-vault',
          chain: BTC.descriptor.chain,
          orgIndex: BTC.descriptor.orgIndex,
          vaultIndex: BTC.descriptor.vaultIndex,
          signingMode: 'dual',
          requiredSigners: 2,
          totalSigners: 3,
          pinnedAt: 1,
        },
      }),
    );
    expect(evaluateVaultDescriptor(request(BTC), own)).toMatchObject({
      kind: 'refused',
      code: 'mismatch',
    });
    // another slot of the same org is unaffected
    resetVaultPin(key);
    expect(evaluateVaultDescriptor(request(BTC), own).kind).toBe('needs_pin');
  });

  it('a pin confirmation is dropped when its request is rejected or goes away', () => {
    const pinKey = vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId);
    const verdict = evaluateVaultDescriptor(request(BTC), own);
    publishVaultVerdict('vaultsign', 'digest-1', verdict);
    stageVaultPinConfirmation(pinKey, BTC.descriptorHash);
    expect(isVaultPinStaged(pinKey, BTC.descriptorHash)).toBe(true);
    clearVaultRequestState('vaultsign');
    expect(isVaultPinStaged(pinKey, BTC.descriptorHash)).toBe(false);
    expect(evaluateVaultDescriptor(request(BTC), own).kind).toBe('needs_pin');

    publishVaultVerdict('fluxnode', 'fp-1', verdict);
    stageVaultPinConfirmation(pinKey, BTC.descriptorHash);
    clearVaultRequestState('fluxnode');
    expect(isVaultPinStaged(pinKey, BTC.descriptorHash)).toBe(false);
  });

  it('fails closed on an unreadable pin store', () => {
    createMMKV().set('vaultDescriptorPins', '{not json');
    expect(evaluateVaultDescriptor(request(BTC), own)).toMatchObject({
      kind: 'refused',
      code: 'invalid',
    });
    expect(() => readVaultPins()).toThrow();
    resetAllVaultPins();
    expect(readVaultPins()).toEqual({});
  });

  it('refuses a descriptor that does not verify', () => {
    const tampered = { ...BTC.descriptor, requiredSigners: 1 };
    expect(
      evaluateVaultDescriptor(request(BTC, { vaultDescriptor: tampered }), own),
    ).toMatchObject({ kind: 'refused', code: 'invalid' });
  });

  it('refuses when this device is not a signer, or its identity key differs', () => {
    expect(
      evaluateVaultDescriptor(request(BTC), {
        ...own,
        wkIdentity: 'bc1qnotmine',
      }),
    ).toMatchObject({ kind: 'refused', code: 'invalid' });
    expect(
      evaluateVaultDescriptor(request(BTC), {
        ...own,
        identityPubKey: V.members[1].keyPubKey,
      }),
    ).toMatchObject({ kind: 'refused', code: 'invalid' });
  });

  it('accepts the descriptor as a JSON string too', () => {
    expect(
      evaluateVaultDescriptor(
        request(BTC, { vaultDescriptor: JSON.stringify(BTC.descriptor) }),
        own,
      ).kind,
    ).toBe('needs_pin');
  });
});

describe('checkRequestMatchesDescriptor', () => {
  it.each([
    ['chain', { chain: 'ltc' }],
    ['org index', { orgIndex: 1338 }],
    ['vault index', { vaultIndex: 4 }],
    ['org id', { orgId: '66f1a0000000000000000999' }],
    ['vault id', { vaultId: '66f1a0000000000000000999' }],
    ['signing mode', { signingMode: 'wallet_only' }],
  ])('refuses a request naming another %s', (_what, overrides) => {
    expect(
      checkRequestMatchesDescriptor(request(BTC, overrides), BTC.descriptor),
    ).not.toBeNull();
    expect(evaluateVaultDescriptor(request(BTC, overrides), own)).toMatchObject(
      { kind: 'refused', code: 'invalid' },
    );
  });

  it('accepts matching ids and mode', () => {
    expect(
      checkRequestMatchesDescriptor(
        request(BTC, {
          orgId: BTC.descriptor.orgId,
          vaultId: BTC.descriptor.vaultId,
          signingMode: 'dual',
        }),
        BTC.descriptor,
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// UTXO (VD-4)
// ---------------------------------------------------------------------------

const network = utxolib.networks.bitcoin;
const at = (index: number) =>
  deriveVaultAddress(BTC.descriptor, BTC.descriptor.vaultIndex, index);
const EXTERNAL = Buffer.from(
  `0014${'11'.repeat(20)}`,
  'hex',
); /* P2WPKH, not a vault */
const ATTACKER_P2WSH = Buffer.from(`0020${'22'.repeat(32)}`, 'hex');

/** The slice of utxo-lib's TransactionBuilder these fixtures use. */
interface TxBuilder {
  addInput: (txid: string, vout: number) => void;
  addOutput: (script: Buffer, value: number) => void;
  buildIncomplete: () => { toHex: () => string };
}
const newTxBuilder = (net: unknown): TxBuilder =>
  new (utxolib.TransactionBuilder as unknown as new (n: unknown) => TxBuilder)(
    net,
  );

function buildTx(
  inputs: number,
  outputs: Array<{ script: Buffer; value: number }>,
): string {
  const txb = newTxBuilder(network);
  for (let i = 0; i < inputs; i++) {
    txb.addInput(`${String(i + 1).padStart(2, '0')}`.repeat(32), i);
  }
  outputs.forEach((o) => txb.addOutput(o.script, o.value));
  return txb.buildIncomplete().toHex();
}

const inputDetail = (addressIndex: number, overrides = {}) => ({
  index: 0,
  addressIndex,
  witnessScript: at(addressIndex).witnessScript,
  amount: '100000',
  ...overrides,
});

describe('checkVaultUtxoTransaction (VD-4)', () => {
  it('derives the inputs, hides change back to the vault and shows every other output', () => {
    const tx = buildTx(1, [
      { script: EXTERNAL, value: 60000 },
      { script: Buffer.from(at(0).scriptPubKey!, 'hex'), value: 39000 },
    ]);
    const result = checkVaultUtxoTransaction(BTC.descriptor, tx, [
      inputDetail(0),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sender).toBe(at(0).address);
      expect(result.recipients).toEqual([
        {
          address: utxolib.address.fromOutputScript(EXTERNAL, network),
          amount: '60000',
        },
      ]);
      expect(result.inputs[0].witnessScript).toBe(at(0).witnessScript);
    }
  });

  it('change to the source address of a non-zero index is change too', () => {
    const tx = buildTx(1, [
      { script: EXTERNAL, value: 1 },
      { script: Buffer.from(at(7).scriptPubKey!, 'hex'), value: 2 },
    ]);
    const result = checkVaultUtxoTransaction(BTC.descriptor, tx, [
      inputDetail(7),
    ]);
    expect(result.ok && result.recipients.length).toBe(1);
  });

  it('an output to an attacker multisig is a displayed recipient, never change', () => {
    const tx = buildTx(1, [
      { script: EXTERNAL, value: 1000 },
      { script: ATTACKER_P2WSH, value: 99000 },
    ]);
    const result = checkVaultUtxoTransaction(BTC.descriptor, tx, [
      inputDetail(0),
    ]);
    expect(result.ok && result.recipients.map((r) => r.amount)).toEqual([
      '1000',
      '99000',
    ]);
  });

  it('refuses an input whose script is not derived from the descriptor (H-12)', () => {
    const tx = buildTx(1, [{ script: EXTERNAL, value: 1 }]);
    const forged = checkVaultUtxoTransaction(BTC.descriptor, tx, [
      inputDetail(0, { witnessScript: at(1).witnessScript }),
    ]);
    expect(forged.ok).toBe(false);
    const extraRedeem = checkVaultUtxoTransaction(BTC.descriptor, tx, [
      inputDetail(0, { redeemScript: '0020ab' }),
    ]);
    expect(extraRedeem.ok).toBe(false);
  });

  it('refuses an input count that differs from the input details', () => {
    const tx = buildTx(2, [{ script: EXTERNAL, value: 1 }]);
    expect(
      checkVaultUtxoTransaction(BTC.descriptor, tx, [inputDetail(0)]).ok,
    ).toBe(false);
    expect(checkVaultUtxoTransaction(BTC.descriptor, tx, []).ok).toBe(false);
  });

  it('ignores a zero-value OP_RETURN memo and refuses one that burns funds', () => {
    const memo = utxolib.script.nullData.output.encode(
      Buffer.from('memo'),
    ) as unknown as Buffer;
    const ok = checkVaultUtxoTransaction(
      BTC.descriptor,
      buildTx(1, [
        { script: EXTERNAL, value: 5 },
        { script: memo, value: 0 },
      ]),
      [inputDetail(0)],
    );
    expect(ok.ok && ok.recipients.length).toBe(1);
    const burn = checkVaultUtxoTransaction(
      BTC.descriptor,
      buildTx(1, [{ script: memo, value: 5 }]),
      [inputDetail(0)],
    );
    expect(burn.ok).toBe(false);
  });

  it('P2SH (Flux key_only): redeem script derived, no witness script allowed', () => {
    const fluxAt = (i: number) =>
      deriveVaultAddress(FLUX.descriptor, FLUX.descriptor.vaultIndex, i);
    const fluxNet = utxolib.networks.flux;
    const txb = newTxBuilder(fluxNet);
    txb.addInput('ab'.repeat(32), 0);
    txb.addOutput(Buffer.from(fluxAt(0).scriptPubKey!, 'hex'), 1000);
    const tx = txb.buildIncomplete().toHex();
    const ok = checkVaultUtxoTransaction(FLUX.descriptor, tx, [
      { addressIndex: 0, redeemScript: fluxAt(0).redeemScript },
    ]);
    expect(ok).toMatchObject({ ok: true, recipients: [] });
    expect(
      checkVaultUtxoTransaction(FLUX.descriptor, tx, [
        {
          addressIndex: 0,
          redeemScript: fluxAt(0).redeemScript,
          witnessScript: '00',
        },
      ]).ok,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EVM / Solana / Flux node (VD-4)
// ---------------------------------------------------------------------------

describe('checkVaultEvmAccount (VD-4)', () => {
  const derived = deriveVaultAddress(
    ETH.descriptor,
    ETH.descriptor.vaultIndex,
    1,
  );

  it('accepts the derived account (any case) and the vault keys', () => {
    expect(
      checkVaultEvmAccount(
        ETH.descriptor,
        1,
        derived.address.toLowerCase(),
        JSON.stringify(derived.pubKeys.slice(0, 2)),
      ),
    ).toBeNull();
  });

  it('refuses another sender (AA-4 / EVM-5)', () => {
    const other = deriveVaultAddress(
      ETH.descriptor,
      ETH.descriptor.vaultIndex,
      0,
    ).address;
    expect(checkVaultEvmAccount(ETH.descriptor, 1, other, undefined)).toMatch(
      /not sent from this vault/,
    );
  });

  it('refuses a signer key that is not a vault key, or a duplicated one', () => {
    expect(
      checkVaultEvmAccount(ETH.descriptor, 1, undefined, [
        derived.pubKeys[0],
        `02${'33'.repeat(32)}`,
      ]),
    ).toMatch(/not a key of this vault/);
    expect(
      checkVaultEvmAccount(ETH.descriptor, 1, undefined, [
        derived.pubKeys[0],
        derived.pubKeys[0],
      ]),
    ).not.toBeNull();
  });

  it('when this device signs, requires its OWN key among the signer keys (wallet parity)', () => {
    const [own, other] = derived.pubKeys;
    expect(
      checkVaultEvmAccount(ETH.descriptor, 1, undefined, [own, other], own),
    ).toBeNull();
    // the relay left this device's key out (another vault key in its place)
    expect(
      checkVaultEvmAccount(ETH.descriptor, 1, undefined, [other], own),
    ).toMatch(/this device's key is not one of the request's signer keys/);
    // no signer list at all
    expect(
      checkVaultEvmAccount(ETH.descriptor, 1, undefined, undefined, own),
    ).toMatch(/names no signer keys/);
    // own key present, but next to a key that is not the vault's
    expect(
      checkVaultEvmAccount(
        ETH.descriptor,
        1,
        undefined,
        [own, `02${'33'.repeat(32)}`],
        own,
      ),
    ).toMatch(/not a key of this vault/);
  });
});

describe('vaultSolBinding (VD-4)', () => {
  it('reproduces the multisig and vault PDA of the vectors', () => {
    const binding = vaultSolBinding(SOL.descriptor, 1);
    const expected = deriveVaultAddress(
      SOL.descriptor,
      SOL.descriptor.vaultIndex,
      1,
    );
    expect(binding).toEqual({
      multisigPda: expected.multisigPda,
      vaultPda: expected.vaultPda,
      members: expected.pubKeys,
      threshold: expected.threshold,
    });
  });
});

describe('checkFluxNodeCollateral (VD-4)', () => {
  const fluxAt = (i: number) =>
    deriveVaultAddress(FLUX.descriptor, FLUX.descriptor.vaultIndex, i);

  it('accepts the derived collateral script and address', () => {
    expect(
      checkFluxNodeCollateral(
        FLUX.descriptor,
        2,
        fluxAt(2).redeemScript,
        fluxAt(2).address,
      ),
    ).toBeNull();
  });

  it('refuses a collateral script or address that is not the vault address', () => {
    expect(
      checkFluxNodeCollateral(FLUX.descriptor, 2, fluxAt(0).redeemScript, ''),
    ).not.toBeNull();
    expect(
      checkFluxNodeCollateral(
        FLUX.descriptor,
        2,
        fluxAt(2).redeemScript,
        fluxAt(0).address,
      ),
    ).not.toBeNull();
  });

  it('the screen and ingestion compute the same request fingerprint', () => {
    const data = {
      chain: 'flux',
      nodeName: 'node-1',
      collateralAmount: '100000000000',
      collateralAddress: fluxAt(0).address,
      collateralTxid: 'aa'.repeat(32),
      collateralVout: 0,
      delegates: [],
    };
    expect(fluxNodeRequestFingerprint(data)).toBe(fluxNodeFingerprint(data));
  });
});
