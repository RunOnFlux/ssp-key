/**
 * TRON enterprise co-sign (TRON_SSP_CONTRACT.md §3, §5, §6): the digest is
 * recomputed from `tronOp` and must equal rawUnsignedTx, the vault must be
 * predict(signers, threshold), this key's leaf m/48'/195'/org'/0'/v/a must be
 * a signer, and the Op is decoded under the enterprise policy with the org
 * flags (absent = refused).
 */
import * as T from '@runonflux/tron-multisig';
import {
  decodeTronVaultRequest,
  parseTronOpEnvelope,
  signTronVaultRequest,
  tronPolicyFlags,
  verifyTronVaultRequest,
  type VaultTronSigningPayload,
} from '../../src/lib/tronVault';
import { TronNotLiveError, TronVerifyError } from '../../src/lib/tron';
import {
  MNEMONIC_KK,
  MNEMONIC_S3,
  MNEMONIC_W,
  MNEMONIC_Z,
  TRON,
  TRON_VECTORS,
  VECTOR_FEE_COLLECTOR,
  VECTOR_NETWORK,
  VECTOR_NOW,
  VECTOR_RECIPIENT,
  leafPriv,
  tronXpriv,
} from './tronFixtures';

const E = TRON_VECTORS.enterpriseSingle2of3;
const USDT = T.NETWORKS.mainnet.usdt as string;
const DAY = 86400n;

function buildOp(p: Partial<Parameters<typeof T.buildOp>[0]> = {}): T.Op {
  return T.buildOp({
    calls: [
      T.trc20TransferCall(USDT, VECTOR_RECIPIENT, 1000000n),
      T.trxTransferCall(VECTOR_RECIPIENT, 2500000n),
    ],
    nonce: 3n,
    deadline: VECTOR_NOW + 7n * DAY,
    fee: T.trxFee(9000000n, VECTOR_FEE_COLLECTOR),
    ...p,
  });
}

function request(
  op: T.Op = buildOp(),
  over: Partial<VaultTronSigningPayload> & {
    tronOpOver?: Record<string, unknown>;
  } = {},
): VaultTronSigningPayload {
  const { tronOpOver, ...rest } = over;
  const digest = T.opDigest(VECTOR_NETWORK.chainId, E.address, op);
  return {
    chain: TRON,
    rawUnsignedTx: T.to0x(digest),
    tronOp: JSON.stringify({
      network: 'ssp-vectors',
      vault: E.address,
      signers: E.signers,
      threshold: E.threshold,
      op: T.opToJson(op),
      ...tronOpOver,
    }),
    inputDetails: [{ index: 0, addressIndex: 0 }],
    ...rest,
  };
}

/** Co-sign as a dual / key_only member: a signature is always produced. */
const sign = (
  data: VaultTronSigningPayload,
  mnemonic: string = MNEMONIC_KK,
): { keySignature: string; keyPubKey: string } => {
  const result = signTronVaultRequest({
    data,
    vaultXpriv: tronXpriv(mnemonic, E.orgIndex),
    vaultIndex: E.vaultIndex,
    network: VECTOR_NETWORK,
    now: VECTOR_NOW,
  });
  if (result.keySignature === null) throw new Error('no key signature');
  return { keySignature: result.keySignature, keyPubKey: result.keyPubKey };
};

describe('TRON enterprise co-sign', () => {
  it('signs the recomputed digest with the org leaf and returns keySignature + keyPubKey', () => {
    const data = request();
    const { keySignature, keyPubKey } = sign(data);
    expect(keySignature).toMatch(/^0x[0-9a-f]{130}$/);
    const kkLeaf = T.localSigner(leafPriv(MNEMONIC_KK, 100, 0, 0));
    expect(T.addressFromPublicKey(T.hexToBytes(keyPubKey))).toBe(
      kkLeaf.address,
    );
    expect(E.signers).toContain(kkLeaf.address);
    const digest = T.hexToBytes(data.rawUnsignedTx as string);
    expect(T.recoverSigner(digest, T.hexToBytes(keySignature))).toBe(
      kkLeaf.address,
    );
    // deterministic (RFC 6979): identical to a direct SDK signature
    expect(keySignature).toBe(T.to0x(kkLeaf.signDigest(digest)));
    kkLeaf.destroy();
    // any M of the set may sign, in any order: the W member signs too
    expect(() => sign(data, MNEMONIC_W)).not.toThrow();
  });

  it('accepts the digest without 0x / in upper case (same bytes)', () => {
    const data = request();
    const bare = (data.rawUnsignedTx as string).slice(2).toUpperCase();
    expect(() => sign({ ...data, rawUnsignedTx: bare })).not.toThrow();
  });

  it('refuses when rawUnsignedTx is not the digest of tronOp', () => {
    const other = T.opDigest(
      VECTOR_NETWORK.chainId,
      E.address,
      buildOp({ nonce: 4n }),
    );
    expect(() =>
      sign(request(buildOp(), { rawUnsignedTx: T.to0x(other) })),
    ).toThrow(/digest does not match/);
    expect(() =>
      sign(request(buildOp(), { rawUnsignedTx: undefined })),
    ).toThrow(TronVerifyError);
  });

  it('refuses a vault that is not predict(signers, threshold)', () => {
    expect(() =>
      sign(
        request(buildOp(), {
          tronOpOver: { vault: TRON_VECTORS.enterpriseDual2of2.address },
        }),
      ),
    ).toThrow(/does not match its signers/);
    expect(() =>
      sign(request(buildOp(), { tronOpOver: { threshold: 1 } })),
    ).toThrow(/does not match its signers/);
    // unsorted signers never form a valid config
    expect(() =>
      sign(
        request(buildOp(), {
          tronOpOver: { signers: [...E.signers].reverse() },
        }),
      ),
    ).toThrow(TronVerifyError);
    expect(() =>
      sign(request(buildOp(), { sourceAddress: VECTOR_RECIPIENT })),
    ).toThrow(/source address/);
  });

  it('refuses when this key is not one of the signers', () => {
    expect(() => sign(request(), MNEMONIC_Z)).toThrow(
      /not a signer of this TRON vault/,
    );
    // right key, wrong address index → a leaf that is not a signer
    expect(() =>
      sign(request(buildOp(), { inputDetails: [{ addressIndex: 1 }] })),
    ).toThrow(/not a signer/);
  });

  it('refuses approve / unknown / self-calls unless the org policy allows them', () => {
    const approve = buildOp({
      calls: [T.approveCall(USDT, VECTOR_RECIPIENT, 5n)],
    });
    expect(() => sign(request(approve))).toThrow(T.PolicyError);
    expect(() =>
      sign(request(approve, { tronPolicy: { allowApprove: true } })),
    ).not.toThrow();

    const unknown = buildOp({
      calls: [
        {
          to: USDT,
          value: 0n,
          data: T.hexToBytes('0x12345678'),
          tokenId: 0n,
          tokenValue: 0n,
        },
      ],
    });
    expect(() => sign(request(unknown))).toThrow(T.PolicyError);
    expect(() =>
      sign(request(unknown, { tronPolicy: '{"allowUnknown":true}' })),
    ).not.toThrow();

    const cancel = buildOp({
      calls: [
        T.selfCall(E.address, {
          action: 'invalidateNonces',
          word: 0n,
          mask: 8n,
        }),
      ],
    });
    // vault self-calls (the on-chain cancel) are allowed unless the org
    // policy explicitly turns them off
    expect(() => sign(request(cancel))).not.toThrow();
    expect(() =>
      sign(request(cancel, { tronPolicy: { allowSelfCalls: 'yes' } })),
    ).not.toThrow();
    expect(() =>
      sign(request(cancel, { tronPolicy: { allowSelfCalls: false } })),
    ).toThrow(T.PolicyError);
  });

  it('refuses fees off the pinned collector, over the cap, or in other tokens', () => {
    expect(() =>
      sign(request(buildOp({ fee: T.trxFee(1n, VECTOR_RECIPIENT) }))),
    ).toThrow(T.PolicyError);
    // enterprise cap: $100 of USDT, and 300 TRX without a rate
    expect(() =>
      sign(
        request(
          buildOp({ fee: T.trc20Fee(USDT, 100000000n, VECTOR_FEE_COLLECTOR) }),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      sign(
        request(
          buildOp({ fee: T.trc20Fee(USDT, 100000001n, VECTOR_FEE_COLLECTOR) }),
        ),
      ),
    ).toThrow(T.PolicyError);
    expect(() =>
      sign(
        request(buildOp({ fee: T.trxFee(300000000n, VECTOR_FEE_COLLECTOR) })),
      ),
    ).not.toThrow();
    expect(() =>
      sign(
        request(buildOp({ fee: T.trxFee(300000001n, VECTOR_FEE_COLLECTOR) })),
      ),
    ).toThrow(T.PolicyError);
    // a known rate lowers the TRX cap to $100 worth: at $1/TRX, 100 TRX
    const at1usd = (fee: bigint) =>
      signTronVaultRequest({
        data: request(buildOp({ fee: T.trxFee(fee, VECTOR_FEE_COLLECTOR) })),
        vaultXpriv: tronXpriv(MNEMONIC_KK, E.orgIndex),
        vaultIndex: 0,
        network: VECTOR_NETWORK,
        now: VECTOR_NOW,
        trxUsdRate: 1,
      });
    expect(() => at1usd(100000000n)).not.toThrow();
    expect(() => at1usd(100000001n)).toThrow(T.PolicyError);
    expect(() =>
      sign(
        request(
          buildOp({
            fee: T.trc20Fee(
              'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9',
              1n,
              VECTOR_FEE_COLLECTOR,
            ),
          }),
        ),
      ),
    ).toThrow(T.PolicyError);
    // no fee (sponsor-free proposal) is fine
    expect(() => sign(request(buildOp({ fee: T.noFee() })))).not.toThrow();
  });

  it('allows deadlines up to 30 days (+1 h clock skew), refuses later or expired ones', () => {
    expect(() =>
      sign(request(buildOp({ deadline: VECTOR_NOW + 30n * DAY + 3600n }))),
    ).not.toThrow();
    expect(() =>
      sign(request(buildOp({ deadline: VECTOR_NOW + 30n * DAY + 3601n }))),
    ).toThrow(T.PolicyError);
    expect(() => sign(request(buildOp({ deadline: VECTOR_NOW - 1n })))).toThrow(
      T.PolicyError,
    );
  });

  it('refuses another network and fails closed while TRON is not live', () => {
    expect(() =>
      sign(request(buildOp(), { tronOpOver: { network: 'nile' } })),
    ).toThrow(/is for nile/);
    expect(() =>
      signTronVaultRequest({
        data: request(),
        vaultXpriv: tronXpriv(MNEMONIC_KK, E.orgIndex),
        vaultIndex: 0,
        network: T.getNetwork('mainnet'),
        now: VECTOR_NOW,
      }),
    ).toThrow(TronNotLiveError);
  });

  it('parses tronOp strictly and reads policy flags as explicit booleans only', () => {
    expect(() => parseTronOpEnvelope(undefined)).toThrow(/no tronOp/);
    expect(() =>
      parseTronOpEnvelope({ ...JSON.parse(request().tronOp as string), x: 1 }),
    ).toThrow(/Unexpected tronOp field/);
    expect(tronPolicyFlags(undefined)).toEqual({
      allowApprove: false,
      allowUnknown: false,
      allowSelfCalls: true,
    });
    expect(tronPolicyFlags('not json')).toEqual({
      allowApprove: false,
      allowUnknown: false,
      allowSelfCalls: true,
    });
    expect(tronPolicyFlags({ allowSelfCalls: false })).toEqual({
      allowApprove: false,
      allowUnknown: false,
      allowSelfCalls: false,
    });
    expect(tronPolicyFlags({ allowApprove: 1, allowSelfCalls: true })).toEqual({
      allowApprove: false,
      allowUnknown: false,
      allowSelfCalls: true,
    });
  });
});

describe('decodeTronVaultRequest (VaultSignRequest verdict)', () => {
  it('is ok with the decoded view for a valid proposal', () => {
    const { state, decoded } = decodeTronVaultRequest(
      request(),
      VECTOR_NETWORK,
      VECTOR_NOW,
    );
    expect(state.status).toBe('ok');
    expect(decoded).toEqual({ sender: E.address, recipients: [], fee: '0' });
    expect(state.view?.calls.map((c) => [c.kind, c.amount, c.symbol])).toEqual([
      ['trc20Transfer', '1', 'USDT'],
      ['trxTransfer', '2.5', 'TRX'],
    ]);
    expect(state.view?.fee).toEqual(
      expect.objectContaining({ kind: 'trx', amount: '9', symbol: 'TRX' }),
    );
  });

  it('fails (approval blocked) on any refusal, with reasons', () => {
    const { state, decoded } = decodeTronVaultRequest(
      request(buildOp(), { rawUnsignedTx: '0x' + '00'.repeat(32) }),
      VECTOR_NETWORK,
      VECTOR_NOW,
    );
    expect(state.status).toBe('failed');
    expect(state.view).toBeUndefined();
    expect(state.reasons).toContain('digest_mismatch');
    expect(decoded.error).toMatch(/digest/);
  });

  it('fails while TRON is not live on the pinned table', () => {
    const { state } = decodeTronVaultRequest(request());
    expect(state.status).toBe('failed');
    expect(state.reasons[0]).toMatch(/not live/);
  });

  it('verifies the dual-mode vector vault (2N keys, 2M threshold) too', () => {
    const D = TRON_VECTORS.enterpriseDual2of2;
    const op = buildOp();
    const digest = T.opDigest(VECTOR_NETWORK.chainId, D.address, op);
    const data: VaultTronSigningPayload = {
      chain: TRON,
      rawUnsignedTx: T.to0x(digest),
      tronOp: {
        network: 'ssp-vectors',
        vault: D.address,
        signers: D.signers,
        threshold: D.threshold,
        op: T.opToJson(op),
      },
    };
    expect(
      verifyTronVaultRequest(data, VECTOR_NETWORK, VECTOR_NOW).vault.address,
    ).toBe(D.address);
    // the S3 member's KEY is Z in the dual vector; both of its leaves sign
    for (const m of [MNEMONIC_W, MNEMONIC_KK, MNEMONIC_S3, MNEMONIC_Z]) {
      const { keySignature } = sign(data, m);
      expect(D.signers).toContain(
        T.recoverSigner(digest, T.hexToBytes(keySignature)),
      );
    }
  });
});

describe('TRON enterprise wallet_only', () => {
  it('verifies the proposal but signs nothing', () => {
    const data = request();
    const result = signTronVaultRequest({
      data,
      vaultXpriv: tronXpriv(MNEMONIC_Z, E.orgIndex), // not a signer: no key leaves
      vaultIndex: 0,
      signingMode: 'wallet_only',
      network: VECTOR_NETWORK,
      now: VECTOR_NOW,
    });
    expect(result.keySignature).toBeNull();
    expect(result.keyPubKey).toMatch(/^0[23][0-9a-f]{64}$/);
    // a tampered proposal is still refused in wallet_only mode
    expect(() =>
      signTronVaultRequest({
        data: { ...data, rawUnsignedTx: '0x' + '22'.repeat(32) },
        vaultXpriv: tronXpriv(MNEMONIC_Z, E.orgIndex),
        vaultIndex: 0,
        signingMode: 'wallet_only',
        network: VECTOR_NETWORK,
        now: VECTOR_NOW,
      }),
    ).toThrow(/digest does not match/);
  });
});
