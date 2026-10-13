/**
 * VD-2 cross-repo contract, SSP Key side.
 *
 * tests/lib/fixtures/vd-relay-payloads.json is shared byte for byte with SSP
 * Wallet (tests/lib/fixtures/, where tests/lib/vaultRelayPayload.spec.ts
 * proves the REAL wallet builders produce every `payload`) and with
 * ~/repos/sec-2026-10/vd-relay-payloads.json.
 *
 * Here, every wallet-built payload must go through SSP Key's own parsing:
 * routed by routeRelayAction, the descriptor found under `vaultDescriptor` (an
 * object) with `vaultDescriptorHash`, verified, bound to the request, VD-4
 * checked — and, for the UTXO and Flux cases, signed end to end once the pin
 * is confirmed. Before this test the two sides only agreed by reading each
 * other's code; a renamed or re-encoded field would have refused every request
 * with "Update required: vault descriptor missing".
 *
 * The rejection payloads SSP Key posts back are pinned too: `errorCode` is the
 * field SSP Wallet reads and forwards to SSP Enterprise.
 */
import fs from 'fs';
import path from 'path';
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import { createMMKV } from 'react-native-mmkv';

import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import {
  handleFluxNodeStart,
  handleVaultSignAction,
} from '../../src/screens/Home/actions/vaultActions';
import {
  routeRelayAction,
  type RelayActionHandlers,
} from '../../src/screens/Home/hooks/usePendingRequests';
import {
  armVaultApproval,
  disarmVaultApproval,
  vaultRequestDigest,
} from '../../src/lib/vaultApprovalBinding';
import {
  deriveVaultAddress,
  verifyVaultDescriptor,
  type VaultDescriptor,
} from '../../src/lib/vaultDescriptor';
import {
  checkFluxNodeCollateral,
  checkVaultEvmAccount,
  checkVaultUtxoTransaction,
  evaluateVaultDescriptor,
  fluxNodeRejectionPayload,
  vaultSignRejectionPayload,
  type VaultRejectionCode,
} from '../../src/lib/vaultDescriptorGate';
import {
  validateFluxNodeStartRequest,
  validateVaultSigningRequest,
} from '../../src/lib/enterpriseGuards';
import { messageDigestMatches } from '../../src/lib/userOpVerify';
import {
  resetAllVaultPins,
  stageVaultPinConfirmation,
  vaultPinKey,
} from '../../src/lib/vaultPins';

// The Key's own USD rate (fee caps): no network in tests.
jest.mock('../../src/lib/rates', () => ({
  ...jest.requireActual('../../src/lib/rates'),
  getCryptoUsdRate: jest.fn(() => Promise.resolve(0)),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
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
// Routing only: the socket context and the Solana decoder take no part.
jest.mock('../../src/hooks/useSocket', () => ({
  useSocket: jest.fn(() => ({})),
}));
jest.mock('../../src/lib/vaultSolanaDecode', () => ({
  applyVaultSolDecode: jest.fn(),
}));

interface PayloadCase {
  name: string;
  vector: string;
  action: 'enterprisevaultsign' | 'enterprisefluxnodestart';
  keyDevice: string;
  input: {
    vaultDescriptor: unknown;
    vaultDescriptorHash: string;
    recipients?: Array<{ address: string; amount: string }>;
  };
  payload: string;
}
interface RejectionCase {
  name: string;
  action: 'enterprisevaultsignrejected' | 'enterprisefluxnodestarted';
  requestId: string;
  errorCode: VaultRejectionCode | null;
  error?: string;
  payload: string;
}

const readFixture = <T>(file: string): T =>
  JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8'),
  ) as T;

const FIXTURE = readFixture<{
  cases: PayloadCase[];
  rejections: RejectionCase[];
}>('vd-relay-payloads.json');
const VECTORS = readFixture<{
  members: Array<{
    name: string;
    wkIdentity: string;
    keyPubKey: string;
    keyMnemonic: string;
  }>;
  vectors: Array<{
    name: string;
    descriptor: VaultDescriptor;
    descriptorHash: string;
  }>;
}>('vd-vectors.json');

const caseOf = (name: string) => FIXTURE.cases.find((c) => c.name === name)!;
const vectorOf = (name: string) =>
  VECTORS.vectors.find((v) => v.name === name)!;
const memberOf = (name: string) =>
  VECTORS.members.find((m) => m.name === name)!;

const makeHandlers = (): jest.Mocked<RelayActionHandlers> => ({
  onTx: jest.fn(),
  onPublicNoncesRequest: jest.fn(),
  onEvmSigningRequest: jest.fn(),
  onWkSigningRequest: jest.fn(),
  onVaultSigningRequest: jest.fn(),
  onVaultXpubRequest: jest.fn(),
  onFluxNodeStartRequest: jest.fn(),
  onKeyNonceSyncRequest: jest.fn(),
  onRecoveryRequest: jest.fn(),
  onChainSyncRequest: jest.fn(),
  onInvalidPayload: jest.fn(),
});

/** The request object SSP Key ends up with after routing the relay action. */
const routed = (c: PayloadCase): Record<string, unknown> => {
  const handlers = makeHandlers();
  expect(
    routeRelayAction({ action: c.action, payload: c.payload }, handlers),
  ).toBe(true);
  expect(handlers.onInvalidPayload).not.toHaveBeenCalled();
  const handler =
    c.action === 'enterprisevaultsign'
      ? handlers.onVaultSigningRequest
      : handlers.onFluxNodeStartRequest;
  expect(handler).toHaveBeenCalledTimes(1);
  return handler.mock.calls[0][0] as unknown as Record<string, unknown>;
};

const ENC_KEY = 'enc-key';
const PASSWORD = 'password';
const PW = ENC_KEY + PASSWORD;

const makeCtx = (
  vaultSigningData: Record<string, unknown> | null,
  device: string,
) => {
  const member = memberOf(device);
  const posted: Array<{ action: string; payload: Record<string, unknown> }> =
    [];
  const postAction = jest.fn((action: string, payload: string) => {
    posted.push({
      action,
      payload: JSON.parse(payload) as Record<string, unknown>,
    });
    return Promise.resolve();
  });
  const ctx = {
    seedPhrase: CryptoJS.AES.encrypt(member.keyMnemonic, PW).toString(),
    identityChain: 'btc',
    identityChainState: {},
    sspWalletKeyInternalIdentity: member.wkIdentity,
    sspWalletKeyInternalIdentityPubKey: member.keyPubKey,
    solDecodeState: null,
    vaultSigningData,
    postAction,
    displayMessage: jest.fn(),
    t: (key: string) => key,
    clearVaultSigningState: jest.fn(),
    clearVaultSigningRequest: jest.fn(),
  } as unknown as HomeActionContext;
  return { ctx, posted };
};

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

describe('VD-2: wallet-built relay payloads (shared fixture with SSP Wallet)', () => {
  it('is byte-identical to the shared vd-relay-payloads.json when present', () => {
    const shared = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'vd-relay-payloads.json',
    );
    if (!fs.existsSync(shared)) {
      return;
    }
    expect(
      fs.readFileSync(
        path.join(__dirname, 'fixtures', 'vd-relay-payloads.json'),
        'utf8',
      ),
    ).toBe(fs.readFileSync(shared, 'utf8'));
  });

  it('covers vault sign (UTXO + EVM message) and Flux node start', () => {
    expect(FIXTURE.cases.map((c) => c.name)).toEqual([
      'btc-utxo-sign-dual',
      'btc-utxo-sign-change-at-source',
      'btc-utxo-sign-other-vault-address',
      'eth-evm-message-sign',
      'flux-node-start-key-only',
    ]);
  });

  it.each(FIXTURE.cases.map((c) => [c.name, c] as const))(
    '%s: routed, descriptor object found, verified and awaiting the pin',
    (_name, c) => {
      const data = routed(c);
      const vector = vectorOf(c.vector);
      const member = memberOf(c.keyDevice);
      // same names, same types: an object and a 64-hex string
      expect(typeof data.vaultDescriptor).toBe('object');
      expect(data.vaultDescriptor).toEqual(vector.descriptor);
      expect(data.vaultDescriptorHash).toBe(vector.descriptorHash);

      const verdict = evaluateVaultDescriptor(data, {
        wkIdentity: member.wkIdentity,
        identityPubKey: member.keyPubKey,
        accountXpub: null,
      });
      expect(verdict.kind).toBe('needs_pin');

      // with this device's own account xpub (sign time) it verifies fully
      const own = vector.descriptor.members.find(
        (m) => m.wkIdentity === member.wkIdentity,
      )!;
      const full = verifyVaultDescriptor(
        data.vaultDescriptor,
        data.vaultDescriptorHash,
        member.wkIdentity,
        'key',
        own.xpubKey,
        { ownIdentityPubKey: member.keyPubKey },
      );
      expect(full).toMatchObject({ ok: true, ownXpubChecked: true });
    },
  );

  it('UTXO: inputs derive from the descriptor; honest change is change, other vault addresses are shown', () => {
    const btc = vectorOf('btc-p2wsh-dual-2of3').descriptor;
    // the recipient SSP Enterprise displayed (an external P2WPKH)
    const external = caseOf('btc-utxo-sign-dual').input.recipients![0].address;
    expect(external.startsWith('bc1q')).toBe(true);
    const recipientsOf = (name: string) => {
      const data = routed(caseOf(name));
      expect(validateVaultSigningRequest(data)).toBeNull();
      const check = checkVaultUtxoTransaction(
        btc,
        data.rawUnsignedTx,
        data.inputDetails,
      );
      if (!check.ok) {
        throw new Error(check.reason);
      }
      return check.recipients;
    };
    expect(recipientsOf('btc-utxo-sign-dual')).toEqual([
      { address: external, amount: '60000' },
    ]);
    expect(recipientsOf('btc-utxo-sign-change-at-source')).toEqual([
      { address: external, amount: '60000' },
    ]);
    // not what the builder produces: SSP Key shows it as a recipient (SSP
    // Wallet lists it as vault address #5) — neither hides it
    expect(recipientsOf('btc-utxo-sign-other-vault-address')).toEqual([
      { address: external, amount: '60000' },
      {
        address: deriveVaultAddress(btc, btc.vaultIndex, 5).address,
        amount: '39000',
      },
    ]);
  });

  it('EVM message: digest of the shown text, signer keys of the pinned vault', () => {
    const data = routed(caseOf('eth-evm-message-sign'));
    expect(validateVaultSigningRequest(data)).toBeNull();
    expect(messageDigestMatches(data.signMessage, data.rawUnsignedTx)).toBe(
      true,
    );
    expect(Array.isArray(data.allSignerKeys)).toBe(true);
    expect(
      checkVaultEvmAccount(
        vectorOf('eth-evm-dual-1of2').descriptor,
        0,
        undefined,
        data.allSignerKeys,
      ),
    ).toBeNull();
  });

  it('Flux node start: the collateral is the derived vault address', () => {
    const data = routed(caseOf('flux-node-start-key-only'));
    expect(validateFluxNodeStartRequest(data)).toBeNull();
    expect(
      checkFluxNodeCollateral(
        vectorOf('flux-p2sh-key_only-2of3').descriptor,
        data.addressIndex as number,
        data.redeemScript,
        data.collateralAddress,
      ),
    ).toBeNull();
  });

  it.each(['btc-utxo-sign-dual', 'btc-utxo-sign-change-at-source'])(
    '%s: signs end to end once the pin is confirmed',
    async (name) => {
      const c = caseOf(name);
      const data = routed(c);
      const descriptor = data.vaultDescriptor as VaultDescriptor;
      stageVaultPinConfirmation(
        vaultPinKey(descriptor.orgId, descriptor.vaultId),
        data.vaultDescriptorHash as string,
      );
      const { ctx, posted } = makeCtx(data, c.keyDevice);
      armVaultApproval(vaultRequestDigest(data));
      await handleVaultSignAction(ctx);
      expect(posted.map((p) => p.action)).toEqual(['enterprisevaultsigned']);
      expect(posted[0].payload.requestId).toBe(data.requestId);
    },
  );

  it('flux-node-start-key-only: signs end to end once the pin is confirmed', async () => {
    const data = routed(caseOf('flux-node-start-key-only'));
    const descriptor = data.vaultDescriptor as VaultDescriptor;
    stageVaultPinConfirmation(
      vaultPinKey(descriptor.orgId, descriptor.vaultId),
      data.vaultDescriptorHash as string,
    );
    const { ctx, posted } = makeCtx(null, 'alice');
    await handleFluxNodeStart(ctx, data);
    expect(posted).toEqual([
      {
        action: 'enterprisefluxnodestarted',
        payload: {
          requestId: 'req-flux-start',
          signedTxHex: 'signed-start-tx',
        },
      },
    ]);
  });

  it('without the descriptor fields the same payload is refused as MISSING (old wallet)', async () => {
    const data = routed(caseOf('btc-utxo-sign-dual'));
    delete data.vaultDescriptor;
    delete data.vaultDescriptorHash;
    const alice = memberOf('alice');
    expect(
      evaluateVaultDescriptor(data, {
        wkIdentity: alice.wkIdentity,
        accountXpub: null,
      }),
    ).toMatchObject({ kind: 'refused', code: 'missing' });
    const { ctx, posted } = makeCtx(data, 'alice');
    armVaultApproval(vaultRequestDigest(data));
    await handleVaultSignAction(ctx);
    expect(posted).toHaveLength(1);
    expect(posted[0].action).toBe('enterprisevaultsignrejected');
    expect(posted[0].payload).toMatchObject({
      requestId: 'req-btc-utxo-sign-dual',
      errorCode: 'VAULT_DESCRIPTOR_MISSING',
    });
  });
});

describe('Rejection payloads posted to SSP Wallet (errorCode)', () => {
  it.each(FIXTURE.rejections.map((r) => [r.name, r] as const))(
    '%s: SSP Key produces exactly the payload SSP Wallet is tested with',
    (_name, r) => {
      const payload =
        r.action === 'enterprisevaultsignrejected'
          ? vaultSignRejectionPayload(r.requestId, r.errorCode, r.error)
          : fluxNodeRejectionPayload(r.requestId, r.error ?? '', r.errorCode);
      expect(JSON.stringify(payload)).toBe(r.payload);
      expect(payload).not.toHaveProperty('code');
    },
  );

  it('Home posts the request id and the consumed errorCode on both reject paths', () => {
    const home = fs.readFileSync(
      path.join(__dirname, '..', '..', 'src', 'screens', 'Home', 'Home.tsx'),
      'utf8',
    );
    const vaultReject = home.slice(
      home.indexOf('const handleVaultSigningRequestAction = async'),
      home.indexOf('const handleVaultSignAction = async'),
    );
    expect(vaultReject).toContain(
      'const rejectionCode = consumeVaultRejectionCode();',
    );
    expect(vaultReject).toContain(
      'vaultSignRejectionPayload(rejectedRequestId, rejectionCode)',
    );
    expect(vaultReject).not.toContain("'{}'");
    const fluxReject = home.slice(
      home.indexOf('const handleFluxNodeStartAction = async'),
      home.indexOf('const handleFluxNodeStart = async'),
    );
    expect(fluxReject).toContain('fluxNodeRejectionPayload(');
    expect(fluxReject).toContain('consumeVaultRejectionCode(),');
  });
});
