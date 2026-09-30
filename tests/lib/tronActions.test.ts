/**
 * TRON wiring in the Home actions, end to end with real keys (the vector
 * mnemonics) and a mocked relay:
 *  - approveTransaction (consumer): refuses without the displayed summary;
 *    co-signs, POSTs /v1/tron/broadcast and posts `txid`; a relay refusal
 *    posts `txrejected` with the relay's reason; an unknown outcome keeps
 *    the request (retry is safe) and posts nothing;
 *  - handleVaultSignAction (enterprise): fail-closed verdict gate, the TRON
 *    branch before EVM/UTXO, reply `enterprisevaultsigned {keySignature,
 *    keyPubKey, requestId}`.
 */
import * as CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import * as T from '@runonflux/tron-multisig';

import type { HomeActionContext } from '../../src/screens/Home/actions/types';
import type { TronApprovedSummary } from '../../src/lib/tron';
import {
  MNEMONIC_KK,
  TRON_VECTORS,
  VECTOR_FEE_COLLECTOR,
  VECTOR_NETWORK,
  VECTOR_NOW,
  VECTOR_RECIPIENT,
  leafPriv,
  tronXpriv,
} from './tronFixtures';

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
}));

jest.mock('@storage/ssp', () => ({
  sspConfig: () => ({ relay: 'relay.example.com' }),
}));

jest.mock('../../src/lib/rates', () => ({
  getCryptoUsdRate: jest.fn(() => Promise.resolve(0)),
}));

// The pinned SDK table has no deployment yet: the actions resolve the
// network through tronNetwork(), which the tests pin to the vector network.
jest.mock('../../src/lib/tron', () => {
  const actual = jest.requireActual('../../src/lib/tron');
  return {
    ...actual,
    // resolved lazily: the fixtures import this module themselves
    tronNetwork: () => require('./tronFixtures').VECTOR_NETWORK,
  };
});

import { approveTransaction } from '../../src/screens/Home/actions/signingActions';
import { handleVaultSignAction } from '../../src/screens/Home/actions/vaultActions';

const V = TRON_VECTORS;
const E = V.enterpriseSingle2of3;
const ENC_KEY = 'enc-key';
const PASSWORD = 'password';
const PW = ENC_KEY + PASSWORD;
const encrypt = (v: string) => CryptoJS.AES.encrypt(v, PW).toString();
const TXID = 'cd'.repeat(32);

const TRON_TX = JSON.stringify({
  format: 'ssp-tron-op',
  version: 1,
  network: 'ssp-vectors', // SDK name of the (mocked) pinned network
  vault: V.consumerOp.vault,
  signers: V.consumer.leaves['0-0'].signers,
  threshold: 2,
  op: V.consumerOp.op,
  walletSignature: V.consumerOp.walletSignature,
});
const APPROVED: TronApprovedSummary = {
  chain: 'tron',
  vault: V.consumerOp.vault,
  digest: V.consumerOp.digest,
};

function baseCtx(extra: Partial<HomeActionContext> = {}) {
  return {
    xpubKey: encrypt(V.consumer.keyXpub),
    xpubWallet: encrypt(V.consumer.walletXpub),
    xprivKey: encrypt(tronXpriv(MNEMONIC_KK, 0)),
    publicNonces: '',
    enterprisePublicNonces: '',
    seedPhrase: encrypt(MNEMONIC_KK),
    identityChain: 'btc',
    dispatch: jest.fn(),
    postAction: jest.fn(() => Promise.resolve()),
    displayMessage: jest.fn(),
    t: ((key: string) => key) as unknown as HomeActionContext['t'],
    sspWalletKeyInternalIdentity: 'wk',
    setSubmittingTransaction: jest.fn(),
    setRawTx: jest.fn(),
    setTxPath: jest.fn(),
    setTxUtxos: jest.fn(),
    setTxid: jest.fn(),
    clearVaultSigningState: jest.fn(),
    clearVaultSigningRequest: jest.fn(),
    solDecodeState: null,
    kasDecodeState: null,
    tronDecodeState: null,
    ...extra,
  } as unknown as HomeActionContext & {
    postAction: jest.Mock;
    displayMessage: jest.Mock;
    setTxid: jest.Mock;
    setRawTx: jest.Mock;
  };
}

const keychain = Keychain.getGenericPassword as jest.Mock;
const fetchMock = jest.fn();

function relayReplies(body: unknown) {
  fetchMock.mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  keychain.mockImplementation((opts: { service: string }) =>
    Promise.resolve(
      opts.service === 'enc_key'
        ? { password: ENC_KEY }
        : { password: CryptoJS.AES.encrypt(PASSWORD, ENC_KEY).toString() },
    ),
  );
  global.fetch = fetchMock;
  jest.spyOn(Date, 'now').mockReturnValue(Number(VECTOR_NOW) * 1000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('approveTransaction (tron)', () => {
  it('refuses to sign without the displayed summary', async () => {
    const ctx = baseCtx();
    await approveTransaction(ctx, TRON_TX, 'tron', '0-0', []);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_tron_not_displayed',
    );
  });

  it('co-signs, broadcasts through the relay sponsor and posts the txid', async () => {
    relayReplies({ status: 'success', data: { txid: TXID } });
    const ctx = baseCtx();
    await approveTransaction(
      ctx,
      TRON_TX,
      'tron',
      '0-0',
      [],
      undefined,
      APPROVED,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://relay.example.com/v1/tron/broadcast');
    expect(JSON.parse(init.body as string)).toEqual({
      chain: 'tron',
      signers: V.consumer.leaves['0-0'].signers,
      threshold: 2,
      op: V.consumerOp.op,
      signatures: [V.consumerOp.walletSignature, V.consumerOp.keySignature],
    });
    expect(ctx.postAction).toHaveBeenCalledWith(
      'txid',
      TXID,
      'tron',
      '0-0',
      'wk',
    );
    expect(ctx.setTxid).toHaveBeenCalledWith(TXID);
  });

  it('a relay refusal posts txrejected and shows the relay reason', async () => {
    relayReplies({
      status: 'error',
      data: {
        code: '400',
        name: 'TronSponsorRefusal',
        message: 'nonce already used',
      },
    });
    const ctx = baseCtx();
    await approveTransaction(
      ctx,
      TRON_TX,
      'tron',
      '0-0',
      [],
      undefined,
      APPROVED,
    );
    expect(ctx.postAction).toHaveBeenCalledTimes(1);
    expect(ctx.postAction).toHaveBeenCalledWith(
      'txrejected',
      TRON_TX,
      'tron',
      '0-0',
      'wk',
    );
    expect(ctx.setRawTx).toHaveBeenCalledWith('');
    expect(ctx.setTxid).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_tron_relay_refused',
    );
  });

  it('an unknown outcome posts nothing and keeps the request for a retry', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    const ctx = baseCtx();
    await approveTransaction(
      ctx,
      TRON_TX,
      'tron',
      '0-0',
      [],
      undefined,
      APPROVED,
    );
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.setRawTx).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:err_tron_broadcast_unknown',
    );
  });

  it('refuses a payload that changed after it was displayed', async () => {
    relayReplies({ status: 'success', data: { txid: TXID } });
    const ctx = baseCtx();
    await approveTransaction(ctx, TRON_TX, 'tron', '0-0', [], undefined, {
      ...APPROVED,
      digest: '0x' + '00'.repeat(32),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/changed since it was displayed/),
    );
  });
});

describe('handleVaultSignAction (tron)', () => {
  const op = T.buildOp({
    calls: [T.trxTransferCall(VECTOR_RECIPIENT, 1000000n)],
    nonce: 1n,
    deadline: VECTOR_NOW + 86400n,
    fee: T.trxFee(9000000n, VECTOR_FEE_COLLECTOR),
  });
  const digest = T.to0x(T.opDigest(VECTOR_NETWORK.chainId, E.address, op));
  const vaultData = (extra: Record<string, unknown> = {}) => ({
    chain: 'tron',
    orgIndex: E.orgIndex,
    vaultIndex: E.vaultIndex,
    requestId: 'req-7',
    rawUnsignedTx: digest,
    tronOp: {
      network: 'ssp-vectors',
      vault: E.address,
      signers: E.signers,
      threshold: E.threshold,
      op: T.opToJson(op),
    },
    inputDetails: [{ index: 0, addressIndex: 0 }],
    recipients: [],
    fee: '0',
    signingMode: 'dual',
    // EVM fields that must never pull a TRON proposal into the EVM path
    reservedNonce: { kPublic: 'aa', kTwoPublic: 'bb' },
    ...extra,
  });
  const ok = { status: 'ok' as const, reasons: [], digest };

  it.each([
    ['pending (null)', null, false],
    ['failed', { status: 'failed' as const, reasons: ['x'] }, true],
  ])('never signs while the verdict is %s', async (_name, state, shows) => {
    const ctx = baseCtx({
      vaultSigningData: vaultData() as never,
      tronDecodeState: state,
    });
    await handleVaultSignAction(ctx);
    expect(ctx.postAction).not.toHaveBeenCalled();
    if (shows) {
      expect(ctx.displayMessage).toHaveBeenCalledWith(
        'error',
        'home:vault_sign_tron_decode_failed',
        8000,
      );
    }
  });

  it('co-signs the recomputed digest with the org leaf and replies', async () => {
    const ctx = baseCtx({
      vaultSigningData: vaultData() as never,
      tronDecodeState: ok,
    });
    await handleVaultSignAction(ctx, digest);
    expect(ctx.postAction).toHaveBeenCalledTimes(1);
    const [action, payload, chain] = ctx.postAction.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(action).toBe('enterprisevaultsigned');
    expect(chain).toBe('tron');
    const reply = JSON.parse(payload) as {
      keySignature: string;
      keyPubKey: string;
      requestId: string;
    };
    expect(Object.keys(reply).sort()).toEqual([
      'keyPubKey',
      'keySignature',
      'requestId',
    ]);
    expect(reply.requestId).toBe('req-7');
    const leaf = T.localSigner(leafPriv(MNEMONIC_KK, E.orgIndex, 0, 0));
    expect(reply.keySignature).toBe(
      T.to0x(leaf.signDigest(T.hexToBytes(digest))),
    );
    expect(T.addressFromPublicKey(T.hexToBytes(reply.keyPubKey))).toBe(
      leaf.address,
    );
    leaf.destroy();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'success',
      'home:vault_sign_success',
    );
    expect(ctx.clearVaultSigningState).toHaveBeenCalled();
  });

  it('wallet_only: replies without a key signature', async () => {
    const ctx = baseCtx({
      vaultSigningData: vaultData({ signingMode: 'wallet_only' }) as never,
      tronDecodeState: ok,
    });
    await handleVaultSignAction(ctx, digest);
    const reply = JSON.parse(
      (ctx.postAction.mock.calls[0] as [string, string])[1],
    ) as Record<string, string>;
    expect(Object.keys(reply).sort()).toEqual(['keyPubKey', 'requestId']);
  });

  it('re-verifies at sign time: a swapped digest is refused', async () => {
    const ctx = baseCtx({
      vaultSigningData: vaultData({
        rawUnsignedTx: '0x' + '11'.repeat(32),
      }) as never,
      tronDecodeState: ok, // a stale / forged verdict must not be enough
    });
    await handleVaultSignAction(ctx, digest);
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      expect.stringMatching(/digest does not match/),
      8000,
    );
  });

  it('never signs without the digest the approval screen displayed', async () => {
    const ctx = baseCtx({
      vaultSigningData: vaultData() as never,
      tronDecodeState: ok,
    });
    await handleVaultSignAction(ctx);
    expect(ctx.postAction).not.toHaveBeenCalled();
  });

  it('refuses a proposal swapped in after the user approved another one', async () => {
    // The user approved A; the relay replaced the request with B (valid,
    // same vault) and its verdict is already ok. B was never approved.
    const opB = T.buildOp({
      calls: [T.trxTransferCall(VECTOR_RECIPIENT, 900000000n)],
      nonce: 2n,
      deadline: VECTOR_NOW + 86400n,
      fee: T.trxFee(9000000n, VECTOR_FEE_COLLECTOR),
    });
    const digestB = T.to0x(T.opDigest(VECTOR_NETWORK.chainId, E.address, opB));
    const ctx = baseCtx({
      vaultSigningData: vaultData({
        rawUnsignedTx: digestB,
        tronOp: {
          network: 'ssp-vectors',
          vault: E.address,
          signers: E.signers,
          threshold: E.threshold,
          op: T.opToJson(opB),
        },
      }) as never,
      tronDecodeState: { status: 'ok' as const, reasons: [], digest: digestB },
    });
    await handleVaultSignAction(ctx, digest);
    expect(ctx.postAction).not.toHaveBeenCalled();
    expect(ctx.displayMessage).toHaveBeenCalledWith(
      'error',
      'home:vault_sign_tron_decode_failed',
      8000,
    );
  });
});
