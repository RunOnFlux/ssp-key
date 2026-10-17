/**
 * VD-3 / VD-4 at sign time, end to end with real keys: the vectors' member
 * mnemonics (tests/lib/fixtures/vd-vectors.json) sign as this device.
 *
 * - The descriptor is required, verified and pinned before anything is
 *   decrypted; a first-sight vault needs the on-screen confirmation, which is
 *   saved only after this device's own vault xpub matched.
 * - UTXO: inputs must spend vault addresses derived from the descriptor and
 *   the wallet-signed transaction must spend exactly the displayed inputs.
 * - Flux node start: the collateral is the derived vault address.
 * - Every descriptor refusal is posted back with a machine-readable code.
 */
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { createMMKV } from 'react-native-mmkv';
import utxolib from '@runonflux/utxo-lib';

import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import {
  handleFluxNodeStart,
  handleVaultSignAction,
} from '../../src/screens/Home/actions/vaultActions';
import {
  armVaultApproval,
  disarmVaultApproval,
  vaultRequestDigest,
} from '../../src/lib/vaultApprovalBinding';
import {
  deriveVaultAddress,
  vaultDescriptorHash,
  type VaultDescriptor,
} from '../../src/lib/vaultDescriptor';
import {
  getVaultPin,
  isVaultPinStaged,
  pinVaultDescriptor,
  resetAllVaultPins,
  stageVaultPinConfirmation,
  vaultPinKey,
} from '../../src/lib/vaultPins';

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
}));
// The Key's own USD rate (fee caps): no network in tests.
jest.mock('../../src/lib/rates', () => ({
  ...jest.requireActual('../../src/lib/rates'),
  getCryptoUsdRate: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('../../src/lib/relayAuth', () => ({
  signMessage: jest.fn(() => 'identity-signature'),
}));
jest.mock('@runonflux/flux-sdk', () => ({
  fluxnode: {
    signMessage: jest.fn(() => 'sig'),
    startFluxNodev6WithPubKey: jest.fn(() => 'signed-start-tx'),
  },
}));
jest.mock('../../src/store', () => ({
  store: {
    getState: () => ({ ssp: { enterprisePublicNonces: '' } }),
    dispatch: jest.fn(),
  },
  persistor: { flush: () => Promise.resolve() },
  storage: (
    require('react-native-mmkv') as typeof import('react-native-mmkv')
  ).createMMKV(),
}));

const fluxSdk = require('@runonflux/flux-sdk') as {
  fluxnode: { startFluxNodev6WithPubKey: jest.Mock };
};

interface Vector {
  name: string;
  descriptor: VaultDescriptor;
  descriptorHash: string;
}
const V = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'vd-vectors.json'), 'utf8'),
) as {
  members: Array<{
    name: string;
    wkIdentity: string;
    keyPubKey: string;
    keyMnemonic: string;
  }>;
  vectors: Vector[];
};
const BTC = V.vectors.find((v) => v.name === 'btc-p2wsh-dual-2of3')!;
const FLUX = V.vectors.find((v) => v.name === 'flux-p2sh-key_only-2of3')!;
const ALICE = V.members.find((m) => m.name === 'alice')!;
const BOB = V.members.find((m) => m.name === 'bob')!;

const ENC_KEY = 'enc-key';
const PASSWORD = 'password';
const PW = ENC_KEY + PASSWORD;

const btcAt = (i: number) =>
  deriveVaultAddress(BTC.descriptor, BTC.descriptor.vaultIndex, i);
const fluxAt = (i: number) =>
  deriveVaultAddress(FLUX.descriptor, FLUX.descriptor.vaultIndex, i);
const EXTERNAL = Buffer.from(`0014${'11'.repeat(20)}`, 'hex');

interface TxBuilder {
  addInput: (txid: string, vout: number) => void;
  addOutput: (script: Buffer, value: number) => void;
  buildIncomplete: () => { toHex: () => string };
}
const buildTx = (
  inputs: string[],
  outputs: Array<{ script: Buffer; value: number }>,
): string => {
  const txb = new (utxolib.TransactionBuilder as unknown as new (
    n: unknown,
  ) => TxBuilder)(utxolib.networks.bitcoin);
  inputs.forEach((txid) => txb.addInput(txid, 0));
  outputs.forEach((o) => txb.addOutput(o.script, o.value));
  return txb.buildIncomplete().toHex();
};

const SPEND = buildTx(
  ['01'.repeat(32)],
  [
    { script: EXTERNAL, value: 60000 },
    { script: Buffer.from(btcAt(0).scriptPubKey!, 'hex'), value: 39000 },
  ],
);

const utxoRequest = (overrides: Record<string, unknown> = {}) => ({
  chain: 'btc',
  orgIndex: BTC.descriptor.orgIndex,
  vaultIndex: BTC.descriptor.vaultIndex,
  rawUnsignedTx: SPEND,
  walletSignedHex: SPEND,
  inputDetails: [
    {
      index: 0,
      addressIndex: 0,
      witnessScript: btcAt(0).witnessScript,
      amount: '100000',
    },
  ],
  requestId: 'req-utxo',
  vaultName: 'Treasury',
  vaultDescriptor: BTC.descriptor,
  vaultDescriptorHash: BTC.descriptorHash,
  ...overrides,
});

const makeCtx = (
  vaultSigningData: Record<string, unknown> | null,
  mnemonic = ALICE.keyMnemonic,
) => {
  const posted: Array<{ action: string; payload: Record<string, unknown> }> =
    [];
  const postAction = jest.fn((action: string, payload: string) => {
    posted.push({
      action,
      payload: JSON.parse(payload) as Record<string, unknown>,
    });
    return Promise.resolve();
  });
  const displayMessage = jest.fn();
  const ctx = {
    seedPhrase: CryptoJS.AES.encrypt(mnemonic, PW).toString(),
    identityChain: 'btc',
    identityChainState: {},
    sspWalletKeyInternalIdentity: ALICE.wkIdentity,
    sspWalletKeyInternalIdentityPubKey: ALICE.keyPubKey,
    solDecodeState: null,
    vaultSigningData,
    postAction,
    displayMessage,
    t: (key: string) => key,
    clearVaultSigningState: jest.fn(),
    clearVaultSigningRequest: jest.fn(),
  } as unknown as HomeActionContext;
  return { ctx, posted, displayMessage };
};

const sign = async (
  request: Record<string, unknown>,
  mnemonic = ALICE.keyMnemonic,
) => {
  const harness = makeCtx(request, mnemonic);
  armVaultApproval(vaultRequestDigest(request));
  await handleVaultSignAction(harness.ctx);
  return harness;
};

const btcPinKey = vaultPinKey(BTC.descriptor.orgId, BTC.descriptor.vaultId);
const fluxPinKey = vaultPinKey(FLUX.descriptor.orgId, FLUX.descriptor.vaultId);

beforeEach(() => {
  jest.clearAllMocks();
  createMMKV().clearAll();
  resetAllVaultPins();
  disarmVaultApproval();
  (Keychain.getGenericPassword as jest.Mock).mockImplementation(
    (options?: { service?: string }) =>
      Promise.resolve(
        options?.service === 'enc_key'
          ? { password: ENC_KEY }
          : { password: CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString() },
      ),
  );
});

describe('handleVaultSignAction — vault descriptor (VD-3)', () => {
  it('refuses a request without a descriptor before decrypting anything, with a code', async () => {
    const { posted, displayMessage } = await sign(
      utxoRequest({ vaultDescriptor: undefined }),
    );
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
    expect(posted).toEqual([
      {
        action: 'enterprisevaultsignrejected',
        payload: expect.objectContaining({
          requestId: 'req-utxo',
          errorCode: 'VAULT_DESCRIPTOR_MISSING',
        }),
      },
    ]);
    // SSP Wallet reads `errorCode`; the old `code` field is gone.
    expect(posted[0].payload).not.toHaveProperty('code');
    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('home:err_vault_descriptor_missing'),
      8000,
    );
  });

  it('refuses a first-sight vault that was not confirmed on screen', async () => {
    const { posted } = await sign(utxoRequest());
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
    expect(posted.map((p) => p.payload.errorCode)).toEqual([
      'VAULT_PIN_REFUSED',
    ]);
    expect(getVaultPin(btcPinKey)).toBeNull();
  });

  it('signs once the pin is confirmed, and saves the pin before signing', async () => {
    stageVaultPinConfirmation(btcPinKey, BTC.descriptorHash);
    const { posted } = await sign(utxoRequest());
    expect(posted.map((p) => p.action)).toEqual(['enterprisevaultsigned']);
    const signed = utxolib.Transaction.fromHex(
      posted[0].payload.signedHex as string,
      utxolib.networks.bitcoin,
    ) as { ins: Array<{ witness: Buffer[] }> };
    // the Key's signature is in the witness
    expect(signed.ins[0].witness.some((w) => w.length > 60)).toBe(true);
    expect(getVaultPin(btcPinKey)).toMatchObject({
      hash: BTC.descriptorHash,
      vaultName: 'Treasury',
    });
    expect(isVaultPinStaged(btcPinKey, BTC.descriptorHash)).toBe(false);

    // the next request for the pinned vault needs no confirmation
    const again = await sign(utxoRequest({ requestId: 'req-2' }));
    expect(again.posted.map((p) => p.action)).toEqual([
      'enterprisevaultsigned',
    ]);
  });

  it('hard-refuses a pinned vault whose descriptor changed (H-12)', async () => {
    pinVaultDescriptor(BTC.descriptor, 'e'.repeat(64));
    const { posted } = await sign(utxoRequest());
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
    expect(posted.map((p) => p.payload.errorCode)).toEqual([
      'VAULT_DESCRIPTOR_CHANGED',
    ]);
  });

  it("refuses when the descriptor's key for this device is not this device's key; the pin is not saved", async () => {
    stageVaultPinConfirmation(btcPinKey, BTC.descriptorHash);
    // this device holds Bob's seed but claims Alice's identity
    const { posted } = await sign(utxoRequest(), BOB.keyMnemonic);
    expect(posted.map((p) => p.payload.errorCode)).toEqual([
      'VAULT_DESCRIPTOR_INVALID',
    ]);
    expect(getVaultPin(btcPinKey)).toBeNull();
  });
});

describe('handleVaultSignAction — pin committed only right before signing (item 5)', () => {
  it('a confirmed pin is not saved when the wallet-signed transaction does not match', async () => {
    stageVaultPinConfirmation(btcPinKey, BTC.descriptorHash);
    const extraInput = buildTx(
      ['02'.repeat(32)],
      [
        { script: EXTERNAL, value: 60000 },
        { script: Buffer.from(btcAt(0).scriptPubKey!, 'hex'), value: 39000 },
      ],
    );
    const { posted } = await sign(utxoRequest({ walletSignedHex: extraInput }));
    expect(posted.map((p) => p.action)).not.toContain('enterprisevaultsigned');
    expect(getVaultPin(btcPinKey)).toBeNull();
  });

  it('a confirmed pin is not saved when the fee check fails', async () => {
    stageVaultPinConfirmation(btcPinKey, BTC.descriptorHash);
    const { posted } = await sign(
      utxoRequest({
        inputDetails: [
          {
            index: 0,
            addressIndex: 0,
            witnessScript: btcAt(0).witnessScript,
            amount: '2000000',
          },
        ],
      }),
    );
    expect(posted.map((p) => p.action)).not.toContain('enterprisevaultsigned');
    expect(getVaultPin(btcPinKey)).toBeNull();
  });
});

describe('handleVaultSignAction — vault slot pins (wallet parity)', () => {
  it('refuses a different signer set for a pinned slot under a NEW vaultId with VAULT_DESCRIPTOR_CHANGED', async () => {
    pinVaultDescriptor(BTC.descriptor, BTC.descriptorHash);
    const dropped = BTC.descriptor.members.find(
      (m) => m.wkIdentity !== ALICE.wkIdentity,
    )!;
    const attack: VaultDescriptor = {
      ...BTC.descriptor,
      vaultId: '66f1a0000000000000000bad',
      members: BTC.descriptor.members.filter((m) => m !== dropped),
    };
    const attackHash = vaultDescriptorHash(attack);
    stageVaultPinConfirmation(
      vaultPinKey(attack.orgId, attack.vaultId),
      attackHash,
    );
    const { posted } = await sign(
      utxoRequest({
        vaultDescriptor: attack,
        vaultDescriptorHash: attackHash,
      }),
    );
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
    expect(posted.map((p) => p.payload.errorCode)).toEqual([
      'VAULT_DESCRIPTOR_CHANGED',
    ]);
    expect(getVaultPin(vaultPinKey(attack.orgId, attack.vaultId))).toBeNull();
  });
});

describe('handleVaultSignAction — orgId-free vault slot (wallet parity)', () => {
  it('refuses a NEW orgId reusing a pinned orgIndex/vaultIndex/chain with VAULT_DESCRIPTOR_CHANGED', async () => {
    pinVaultDescriptor(BTC.descriptor, BTC.descriptorHash);
    const dropped = BTC.descriptor.members.find(
      (m) => m.wkIdentity !== ALICE.wkIdentity,
    )!;
    const attack: VaultDescriptor = {
      ...BTC.descriptor,
      orgId: '66f1a00000000000000000ff',
      vaultId: '66f1a0000000000000000bad',
      members: BTC.descriptor.members.filter((m) => m !== dropped),
    };
    const attackHash = vaultDescriptorHash(attack);
    stageVaultPinConfirmation(
      vaultPinKey(attack.orgId, attack.vaultId),
      attackHash,
    );
    const { posted } = await sign(
      utxoRequest({
        vaultDescriptor: attack,
        vaultDescriptorHash: attackHash,
      }),
    );
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
    expect(posted.map((p) => p.payload.errorCode)).toEqual([
      'VAULT_DESCRIPTOR_CHANGED',
    ]);
  });
});

describe('handleVaultSignAction — UTXO derivation (VD-4)', () => {
  beforeEach(() => {
    pinVaultDescriptor(BTC.descriptor, BTC.descriptorHash);
  });

  it('refuses an input script that is not derived from the descriptor', async () => {
    const forged = buildTx(
      ['01'.repeat(32)],
      [{ script: Buffer.from(btcAt(1).scriptPubKey!, 'hex'), value: 99000 }],
    );
    const { posted } = await sign(
      utxoRequest({
        rawUnsignedTx: forged,
        walletSignedHex: forged,
        inputDetails: [
          {
            index: 0,
            addressIndex: 0,
            // a script the relay made up: not the vault's address 0
            witnessScript: btcAt(1).witnessScript,
            amount: '100000',
          },
        ],
      }),
    );
    expect(posted.map((p) => p.payload.errorCode)).toEqual([
      'VAULT_DESCRIPTOR_INVALID',
    ]);
  });

  it('refuses a wallet-signed transaction that spends other inputs than shown', async () => {
    const extraInput = buildTx(
      ['02'.repeat(32)],
      [
        { script: EXTERNAL, value: 60000 },
        { script: Buffer.from(btcAt(0).scriptPubKey!, 'hex'), value: 39000 },
      ],
    );
    const { posted, displayMessage } = await sign(
      utxoRequest({ walletSignedHex: extraInput }),
    );
    expect(posted.map((p) => p.action)).not.toContain('enterprisevaultsigned');
    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('home:err_vault_sign_mismatch'),
      8000,
    );
  });

  it('refuses a fee above the vault cap at sign time (item 2)', async () => {
    // inputs 2,000,000 sats, outputs 99,000: fee 0.019 BTC > 0.01 BTC maxFee
    const { posted, displayMessage } = await sign(
      utxoRequest({
        inputDetails: [
          {
            index: 0,
            addressIndex: 0,
            witnessScript: btcAt(0).witnessScript,
            amount: '2000000',
          },
        ],
      }),
    );
    expect(posted.map((p) => p.action)).not.toContain('enterprisevaultsigned');
    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('exceeds the maximum'),
      8000,
    );
  });

  it('refuses an input without an amount at sign time (item 2)', async () => {
    const { posted, displayMessage } = await sign(
      utxoRequest({
        inputDetails: [
          {
            index: 0,
            addressIndex: 0,
            witnessScript: btcAt(0).witnessScript,
          },
        ],
      }),
    );
    expect(posted.map((p) => p.action)).not.toContain('enterprisevaultsigned');
    expect(displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('input 0 has no valid amount'),
      8000,
    );
  });

  it('refuses a request naming another vault index than its descriptor', async () => {
    const { posted } = await sign(utxoRequest({ vaultIndex: 4 }));
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
    expect(posted.map((p) => p.payload.errorCode)).toEqual([
      'VAULT_DESCRIPTOR_INVALID',
    ]);
  });
});

describe('handleFluxNodeStart — vault descriptor (VD-3 / VD-4)', () => {
  const fluxRequest = (overrides: Record<string, unknown> = {}) => ({
    requestId: 'flux-1',
    chain: 'flux',
    orgIndex: FLUX.descriptor.orgIndex,
    vaultIndex: FLUX.descriptor.vaultIndex,
    addressIndex: 0,
    collateralTxid: 'aa'.repeat(32),
    collateralVout: 0,
    collateralAddress: fluxAt(0).address,
    identityPubKey: `02${'11'.repeat(32)}`,
    redeemScript: fluxAt(0).redeemScript,
    vaultDescriptor: FLUX.descriptor,
    vaultDescriptorHash: FLUX.descriptorHash,
    ...overrides,
  });

  it('refuses a collateral that is not the vault address, before decrypting', async () => {
    stageVaultPinConfirmation(fluxPinKey, FLUX.descriptorHash);
    const { ctx, posted } = makeCtx(null);
    await handleFluxNodeStart(
      ctx,
      fluxRequest({ redeemScript: fluxAt(1).redeemScript }),
    );
    expect(Keychain.getGenericPassword).not.toHaveBeenCalled();
    expect(posted).toEqual([
      {
        action: 'enterprisefluxnodestarted',
        payload: expect.objectContaining({
          requestId: 'flux-1',
          errorCode: 'VAULT_DESCRIPTOR_INVALID',
        }),
      },
    ]);
  });

  it('refuses a start without a descriptor', async () => {
    const { ctx, posted } = makeCtx(null);
    await handleFluxNodeStart(
      ctx,
      fluxRequest({ vaultDescriptorHash: undefined }),
    );
    expect(posted[0].payload.errorCode).toBe('VAULT_DESCRIPTOR_MISSING');
    expect(fluxSdk.fluxnode.startFluxNodev6WithPubKey).not.toHaveBeenCalled();
  });

  it('signs the start for the confirmed vault and saves the pin', async () => {
    stageVaultPinConfirmation(fluxPinKey, FLUX.descriptorHash);
    const { ctx, posted } = makeCtx(null);
    await handleFluxNodeStart(ctx, fluxRequest());
    expect(posted).toEqual([
      {
        action: 'enterprisefluxnodestarted',
        payload: { requestId: 'flux-1', signedTxHex: 'signed-start-tx' },
      },
    ]);
    expect(fluxSdk.fluxnode.startFluxNodev6WithPubKey).toHaveBeenCalledWith(
      'aa'.repeat(32),
      0,
      expect.any(String),
      `02${'11'.repeat(32)}`,
      expect.any(String),
      true,
      fluxAt(0).redeemScript,
      undefined,
    );
    expect(getVaultPin(fluxPinKey)?.hash).toBe(FLUX.descriptorHash);
  });

  it('saves a confirmed pin only right before the start is signed (item 5)', async () => {
    stageVaultPinConfirmation(fluxPinKey, FLUX.descriptorHash);
    let pinnedAtSign: string | undefined;
    fluxSdk.fluxnode.startFluxNodev6WithPubKey.mockImplementationOnce(() => {
      pinnedAtSign = getVaultPin(fluxPinKey)?.hash;
      return 'signed-start-tx';
    });
    const { ctx } = makeCtx(null);
    await handleFluxNodeStart(ctx, fluxRequest());
    expect(pinnedAtSign).toBe(FLUX.descriptorHash);
    expect(isVaultPinStaged(fluxPinKey, FLUX.descriptorHash)).toBe(false);
  });
});
