/**
 * TRON consumer co-sign on SSP Key (TRON_SSP_CONTRACT.md §6):
 *  - the approval decode (decodeTransactionForApproval → tron view + digest
 *    summary) and its fail-closed refusals;
 *  - cosignAndBroadcastTRON: re-verifies from scratch, signs only the
 *    displayed digest (the vector key signature, byte for byte) and POSTs
 *    exactly {chain, signers, threshold, op, signatures:[wallet, key]} to
 *    /v1/tron/broadcast; relay refusals vs unknown outcomes;
 *  - self-pay: only the deploy + execute TriggerSmartContract shapes from the
 *    key's own leaf account, fee_limit ≤ 150 TRX, simulated first.
 */
import * as T from '@runonflux/tron-multisig';
import {
  TronBroadcastUnknownError,
  TronRelayRefusedError,
  TronSelfPayBalanceError,
  assertTronSelfPayTransaction,
  cosignAndBroadcastTRON,
  postTronBroadcast,
} from '../../src/lib/constructTx';
import {
  decodeTransactionForApproval,
  decodeTRONTransactionForApproval,
} from '../../src/lib/transactions';
import {
  TRON_SELF_PAY_FEE_LIMIT_SUN,
  generateAddressKeypairTRON,
  verifyTronConsumerRequest,
  type TronApprovedSummary,
} from '../../src/lib/tron';
import {
  MNEMONIC_KK,
  TRON,
  TRON_VECTORS,
  VECTOR_FEE_COLLECTOR,
  VECTOR_NETWORK,
  VECTOR_NOW,
  VECTOR_RECIPIENT,
  consumerPayload,
  tronXpriv,
} from './tronFixtures';

const V = TRON_VECTORS;
const USDT = T.NETWORKS.mainnet.usdt as string;
const RELAY = 'relay.example.com';
const TXID = 'ab'.repeat(32);

const VECTOR_RAW = JSON.stringify({
  format: 'ssp-tron-op',
  version: 1,
  network: 'ssp-vectors',
  vault: V.consumerOp.vault,
  signers: V.consumer.leaves['0-0'].signers,
  threshold: 2,
  op: V.consumerOp.op,
  walletSignature: V.consumerOp.walletSignature,
});

const KEY_PRIV = generateAddressKeypairTRON(
  tronXpriv(MNEMONIC_KK, 0),
  0,
  0,
  TRON,
).privKey;

const APPROVED: TronApprovedSummary = {
  chain: TRON,
  vault: V.consumerOp.vault,
  digest: V.consumerOp.digest,
};

const DECODE_CTX = {
  xpubWallet: V.consumer.walletXpub,
  xpubKey: V.consumer.keyXpub,
  path: '0-0',
  network: VECTOR_NETWORK,
  now: VECTOR_NOW,
  getBalance: jest.fn(() => Promise.resolve(0n)),
};

function relayReply(body: unknown, status = 200) {
  return jest.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response),
  );
}

function cosign(
  overrides: Partial<Parameters<typeof cosignAndBroadcastTRON>[0]> = {},
) {
  return cosignAndBroadcastTRON({
    chain: TRON,
    rawTx: VECTOR_RAW,
    approved: APPROVED,
    xpubWallet: V.consumer.walletXpub,
    xpubKey: V.consumer.keyXpub,
    path: '0-0',
    keyPrivKeyHex: KEY_PRIV,
    network: VECTOR_NETWORK,
    relayHost: RELAY,
    now: VECTOR_NOW,
    ...overrides,
  });
}

function opWith(p: Partial<Parameters<typeof T.buildOp>[0]>): T.Op {
  return T.buildOp({
    calls: [T.trc20TransferCall(USDT, VECTOR_RECIPIENT, 25000000n)],
    nonce: 7n,
    deadline: 1790000000n,
    fee: T.trxFee(6300000n, VECTOR_FEE_COLLECTOR),
    ...p,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('decodeTransactionForApproval (tron)', () => {
  it('returns the on-device view and the digest summary of the vector Op', async () => {
    const info = await decodeTransactionForApproval(
      VECTOR_RAW,
      TRON,
      [],
      undefined,
      DECODE_CTX,
    );
    expect(info.sender).toBe(V.consumerOp.vault);
    expect(info.receiver).toBe(VECTOR_RECIPIENT);
    expect(info.amount).toBe('25');
    expect(info.tokenSymbol).toBe('USDT');
    expect(info.token).toBe(USDT);
    expect(info.fee).toBe('6.3');
    expect(info.tronApproved).toEqual(APPROVED);
    expect(info.tron?.selfPay).toBe(false);
    expect(info.tron?.selfPayAccount).toBeUndefined();
    // a sponsored Op never touches the network
    expect(DECODE_CTX.getBalance).not.toHaveBeenCalled();
  });

  it('fails closed without the paired xpubs (never utxolib)', async () => {
    const info = await decodeTransactionForApproval(VECTOR_RAW, TRON, []);
    expect(info.amount).toBe('decodingError');
    expect(info.tronApproved).toBeUndefined();
  });

  it.each([
    [
      'fee above the ceiling',
      consumerPayload(
        opWith({ fee: T.trxFee(30000001n, VECTOR_FEE_COLLECTOR) }),
      ),
      'policy:FEE_ABOVE_CEILING',
    ],
    [
      'another vault',
      consumerPayload(opWith({}), { vault: V.consumer.leaves['0-1'].address }),
      'wrong_vault',
    ],
    [
      'an approve call',
      consumerPayload(
        opWith({ calls: [T.approveCall(USDT, VECTOR_RECIPIENT, 1n)] }),
      ),
      'policy:CALL_KIND_NOT_ALLOWED',
    ],
  ])('fails closed on %s with the refusal reason', async (_n, raw, detail) => {
    const info = await decodeTransactionForApproval(
      raw,
      TRON,
      [],
      undefined,
      DECODE_CTX,
    );
    expect(info).toEqual(
      expect.objectContaining({
        sender: 'decodingError',
        amount: 'decodingError',
        errorReason: 'tron',
        errorDetail: detail,
      }),
    );
    expect(info.tronApproved).toBeUndefined();
  });

  it('fails closed while TRON is not live (pinned SDK table)', async () => {
    const info = await decodeTransactionForApproval(
      VECTOR_RAW,
      TRON,
      [],
      undefined,
      { ...DECODE_CTX, network: T.getNetwork('mainnet') },
    );
    expect(info.errorReason).toBe('tron');
    expect(info.errorDetail).toBe('not_live');
  });

  it('self-pay: shows the key leaf account and its balance', async () => {
    const raw = consumerPayload(opWith({ fee: T.noFee() }));
    const getBalance = jest.fn(() => Promise.resolve(30000000n));
    const info = await decodeTRONTransactionForApproval(raw, TRON, {
      ...DECODE_CTX,
      getBalance,
    });
    expect(getBalance).toHaveBeenCalledWith(V.consumer.leaves['0-0'].keySigner);
    expect(info.fee).toBe('0');
    expect(info.tron?.selfPay).toBe(true);
    expect(info.tron?.selfPayAccount).toEqual({
      address: V.consumer.leaves['0-0'].keySigner,
      balanceSun: '30000000',
      balance: '30',
      minimumSun: '25000000',
      minimum: '25',
      sufficient: true,
    });
    const poor = await decodeTRONTransactionForApproval(raw, TRON, {
      ...DECODE_CTX,
      getBalance: () => Promise.resolve(1n),
    });
    expect(poor.tron?.selfPayAccount?.sufficient).toBe(false);
    const unknown = await decodeTRONTransactionForApproval(raw, TRON, {
      ...DECODE_CTX,
      getBalance: () => Promise.reject(new Error('offline')),
    });
    expect(unknown.tron?.selfPayAccount).toEqual(
      expect.objectContaining({ balance: null, sufficient: false }),
    );
  });
});

describe('decodeTransactionForApproval (tron): never labels a token as TRX', () => {
  it.each([
    [
      'an unknown TRC-20',
      [
        T.trc20TransferCall(
          'TWr4qR84ARRVT2s2ccExEzhy1AbvUg5JUo',
          VECTOR_RECIPIENT,
          5000000n,
        ),
      ],
    ],
    [
      'a TRC-10 token',
      [T.trc10TransferCall(VECTOR_RECIPIENT, 1002000n, 5000000n)],
    ],
  ])('%s keeps no symbol (raw units, not "TRX")', async (_n, calls) => {
    const info = await decodeTRONTransactionForApproval(
      consumerPayload(opWith({ calls })),
      TRON,
      DECODE_CTX,
    );
    expect(info.amount).toBe('5000000');
    expect(info.tokenSymbol).not.toBe('TRX');
    expect(info.tokenSymbol).toBe('');
    expect(info.tron?.calls[0].symbol).toBeNull();
  });
});

describe('cosignAndBroadcastTRON (sponsored)', () => {
  it('signs the displayed digest and posts exactly the contract body', async () => {
    const fetchImpl = relayReply({ status: 'success', data: { txid: TXID } });
    const txid = await cosign({ fetchImpl });
    expect(txid).toBe(TXID);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`https://${RELAY}/v1/tron/broadcast`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      chain: 'tron',
      signers: V.consumer.leaves['0-0'].signers,
      threshold: 2,
      op: V.consumerOp.op,
      // [wallet, key]: the key half is the vector signature byte for byte
      signatures: [V.consumerOp.walletSignature, V.consumerOp.keySignature],
    });
  });

  it('refuses when the payload changed since it was displayed', async () => {
    const fetchImpl = relayReply({ status: 'success', data: { txid: TXID } });
    const other = consumerPayload(opWith({ nonce: 8n }));
    await expect(cosign({ rawTx: other, fetchImpl })).rejects.toThrow(
      /changed since it was displayed/,
    );
    await expect(
      cosign({
        approved: { ...APPROVED, vault: V.consumer.leaves['0-1'].address },
        fetchImpl,
      }),
    ).rejects.toThrow(/changed since it was displayed/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-verifies at sign time: expired by now, tampered, wrong key', async () => {
    const fetchImpl = relayReply({ status: 'success', data: { txid: TXID } });
    await expect(cosign({ now: 1790000001n, fetchImpl })).rejects.toThrow(
      T.PolicyError,
    );
    await expect(
      cosign({
        rawTx: consumerPayload(opWith({}), {
          signers: V.consumer.leaves['1-0'].signers,
        }),
        fetchImpl,
      }),
    ).rejects.toThrow(/not for this device's vault/);
    const otherKey = generateAddressKeypairTRON(
      tronXpriv(MNEMONIC_KK, 0),
      0,
      1,
      TRON,
    ).privKey;
    await expect(
      cosign({ keyPrivKeyHex: otherKey, fetchImpl }),
    ).rejects.toThrow(/does not belong to this TRON vault/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces a relay refusal as TronRelayRefusedError with its message', async () => {
    const fetchImpl = relayReply({
      status: 'error',
      data: {
        code: '400',
        name: 'TronSponsorRefusal',
        message: 'fee below current cost',
      },
    });
    await expect(cosign({ fetchImpl })).rejects.toThrow(
      new TronRelayRefusedError('fee below current cost'),
    );
  });

  it('treats a duplicate submission (existing txid) as success', async () => {
    const fetchImpl = relayReply({ status: 'success', data: { txid: TXID } });
    await expect(cosign({ fetchImpl })).resolves.toBe(TXID);
    await expect(cosign({ fetchImpl })).resolves.toBe(TXID);
  });

  it('never reports any other relay error as a rejection (may have landed)', async () => {
    const fetchImpl = relayReply({
      status: 'error',
      data: {
        code: '500',
        name: 'Error',
        message: `TRON broadcast outcome unknown for ${TXID}: socket hang up`,
      },
    });
    const error = await cosign({ fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TronBroadcastUnknownError);
    expect((error as TronBroadcastUnknownError).relayMessage).toMatch(
      /outcome unknown/,
    );
  });

  it('treats network failures and garbage replies as unknown outcomes', async () => {
    const down = jest.fn(() => Promise.reject(new Error('socket hang up')));
    await expect(
      postTronBroadcast(RELAY, {} as never, down as unknown as typeof fetch),
    ).rejects.toThrow(TronBroadcastUnknownError);
    await expect(
      postTronBroadcast(
        RELAY,
        {} as never,
        relayReply({ nope: 1 }, 502) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(TronBroadcastUnknownError);
    await expect(
      postTronBroadcast(
        RELAY,
        {} as never,
        relayReply({
          status: 'success',
          data: { txid: 'x' },
        }) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(TronBroadcastUnknownError);
  });
});

// ---------------------------------------------------------------------------
// Self-pay
// ---------------------------------------------------------------------------

const BLOCK_ID = '0000000003a1b2c3' + '11'.repeat(24);

function fakeClient(opts: {
  balance?: bigint;
  hasCode?: boolean;
  simulationOk?: boolean;
  result?: string;
}) {
  const broadcasts: string[] = [];
  const client = {
    getAccount: jest.fn((address: string) =>
      Promise.resolve({
        address,
        balance: opts.balance ?? 100000000n,
        type: null,
        raw: {},
      }),
    ),
    hasCode: jest.fn(() => Promise.resolve(opts.hasCode ?? false)),
    getNowBlock: jest.fn(() =>
      Promise.resolve({
        blockId: BLOCK_ID,
        number: 0x3a1b2c3n,
        timestamp: 1789998000000n,
        ref: T.refFromBlock(BLOCK_ID),
      }),
    ),
    triggerConstant: jest.fn(() =>
      Promise.resolve({
        ok: opts.simulationOk ?? true,
        energyUsed: 90000n,
        result: new Uint8Array(0),
        revert: null,
        message: opts.simulationOk === false ? 'REVERT opcode executed' : null,
        raw: {},
      }),
    ),
    broadcastHex: jest.fn((hex: string) => {
      broadcasts.push(hex);
      return Promise.resolve({ txid: T.decodeTransaction(hex).txid });
    }),
    waitForTransaction: jest.fn((txid: string) =>
      Promise.resolve({ id: txid, result: opts.result ?? 'SUCCESS' }),
    ),
  };
  return { client, broadcasts };
}

describe('self-pay (fee.amount == 0)', () => {
  const selfPayOp = opWith({ fee: T.noFee() });
  const selfPayRaw = consumerPayload(selfPayOp);
  const verified = verifyTronConsumerRequest(selfPayRaw, TRON, {
    xpubWallet: V.consumer.walletXpub,
    xpubKey: V.consumer.keyXpub,
    path: '0-0',
    network: VECTOR_NETWORK,
    now: VECTOR_NOW,
  });
  const approved: TronApprovedSummary = {
    chain: TRON,
    vault: verified.vault.address,
    digest: T.to0x(verified.digest),
  };
  const keySigner = V.consumer.leaves['0-0'].keySigner;

  const run = (client: unknown) =>
    cosign({
      rawTx: selfPayRaw,
      approved,
      client: client as never,
      sleep: () => Promise.resolve(),
      nowMs: () => 1789998000000n,
      fetchImpl: jest.fn(() => {
        throw new Error('the relay must not be used for self-pay');
      }) as unknown as typeof fetch,
    });

  it('deploys then executes from the key leaf account — only these two shapes', async () => {
    const { client, broadcasts } = fakeClient({ hasCode: false });
    const txid = await run(client);
    expect(broadcasts).toHaveLength(2);

    const deploy = T.decodeTransaction(broadcasts[0]);
    expect(deploy.raw.contract.type).toBe('TriggerSmartContract');
    const dp = deploy.raw.contract.parameter as T.TriggerSmartContract;
    expect(dp.ownerAddress).toBe(keySigner);
    expect(dp.contractAddress).toBe(VECTOR_NETWORK.factory);
    expect(T.to0x(dp.data)).toBe(
      T.to0x(T.encodeDeploy(verified.vault.configHash)),
    );
    expect(dp.callValue).toBe(0n);
    expect(deploy.raw.feeLimit).toBe(TRON_SELF_PAY_FEE_LIMIT_SUN);
    expect(T.recoverTransactionSigners(deploy)).toEqual([keySigner]);

    const exec = T.decodeTransaction(broadcasts[1]);
    expect(txid).toBe(exec.txid);
    const ep = exec.raw.contract.parameter as T.TriggerSmartContract;
    expect(ep.ownerAddress).toBe(keySigner);
    expect(ep.contractAddress).toBe(verified.vault.address);
    expect(exec.raw.feeLimit).toBe(TRON_SELF_PAY_FEE_LIMIT_SUN);
    expect(T.recoverTransactionSigners(exec)).toEqual([keySigner]);
    const args = T.decodeExecuteTransaction(exec.raw);
    expect(args).not.toBeNull();
    expect(T.opsEqual(args!.op, selfPayOp)).toBe(true);
    expect(args!.threshold).toBe(2);
    // the packed signatures are exactly the wallet's and the key's
    const signers = T.unpackSignatures(args!.signaturesPacked).map((s) =>
      T.recoverSigner(verified.digest, s),
    );
    expect(signers).toEqual(V.consumer.leaves['0-0'].signers);
    // simulated before broadcasting
    expect(client.triggerConstant).toHaveBeenCalledTimes(1);
  });

  it('skips the deployment when the vault already has code', async () => {
    const { client, broadcasts } = fakeClient({ hasCode: true });
    await run(client);
    expect(broadcasts).toHaveLength(1);
    expect(
      (
        T.decodeTransaction(broadcasts[0]).raw.contract
          .parameter as T.TriggerSmartContract
      ).contractAddress,
    ).toBe(verified.vault.address);
  });

  it('refuses without enough TRX on the key account (nothing broadcast)', async () => {
    const { client, broadcasts } = fakeClient({ balance: 24999999n });
    await expect(run(client)).rejects.toThrow(TronSelfPayBalanceError);
    expect(broadcasts).toHaveLength(0);
  });

  it('never broadcasts an execute whose simulation reverts', async () => {
    const { client, broadcasts } = fakeClient({
      hasCode: true,
      simulationOk: false,
    });
    await expect(run(client)).rejects.toThrow(/would fail/);
    expect(broadcasts).toHaveLength(0);
  });

  it('reports an on-chain failure with its txid', async () => {
    const { client } = fakeClient({ hasCode: true, result: 'REVERT' });
    await expect(run(client)).rejects.toThrow(/failed on-chain: REVERT/);
  });

  describe('assertTronSelfPayTransaction', () => {
    const ref = T.refFromBlock(BLOCK_ID);
    const timing = {
      ref,
      timestamp: 1789998000000n,
      expiration: 1789998060000n,
    };
    const execExpected = {
      kind: 'execute' as const,
      owner: keySigner,
      vault: verified.vault.address,
      config: verified.config,
      digest: verified.digest,
      chainId: VECTOR_NETWORK.chainId,
    };
    const packed = T.assembleSignatures(verified.digest, verified.config, [
      verified.payload.walletSignature,
      T.localSigner(T.hexToBytes(KEY_PRIV)).signDigest(verified.digest),
    ]);
    const execute = (p: Partial<T.ExecuteTxParams> = {}) =>
      T.buildExecuteTransaction({
        owner: keySigner,
        target: verified.vault.address,
        config: verified.config,
        op: selfPayOp,
        signaturesPacked: packed,
        feeLimit: TRON_SELF_PAY_FEE_LIMIT_SUN,
        ...timing,
        ...p,
      });

    it('accepts exactly the expected execute', () => {
      expect(() =>
        assertTronSelfPayTransaction(execute(), execExpected),
      ).not.toThrow();
    });

    it('refuses a plain TRX transfer (contract type 1)', () => {
      const transfer = T.buildTransfer({
        owner: keySigner,
        to: VECTOR_RECIPIENT,
        amount: 1n,
        ...timing,
      });
      expect(() =>
        assertTronSelfPayTransaction(transfer, execExpected),
      ).toThrow(/not a TriggerSmartContract/);
    });

    it('refuses another op, target, owner, fee limit or attached value', () => {
      const otherOp = opWith({ fee: T.noFee(), nonce: 9n });
      expect(() =>
        assertTronSelfPayTransaction(execute({ op: otherOp }), execExpected),
      ).toThrow(/not this vault operation/);
      expect(() =>
        assertTronSelfPayTransaction(
          execute({ target: VECTOR_RECIPIENT }),
          execExpected,
        ),
      ).toThrow(/not this vault operation/);
      expect(() =>
        assertTronSelfPayTransaction(
          execute({ owner: V.consumer.leaves['0-0'].walletSigner }),
          execExpected,
        ),
      ).toThrow(/unexpected TRON transaction fields/);
      expect(() =>
        assertTronSelfPayTransaction(
          execute({ feeLimit: TRON_SELF_PAY_FEE_LIMIT_SUN + 1n }),
          execExpected,
        ),
      ).toThrow(/unexpected TRON transaction fields/);
      const withValue = T.buildTrigger({
        owner: keySigner,
        contract: verified.vault.address,
        data: T.encodeExecute({
          signersPacked: T.packSigners(verified.config.signers),
          threshold: 2,
          op: selfPayOp,
          signaturesPacked: packed,
        }),
        callValue: 1n,
        feeLimit: TRON_SELF_PAY_FEE_LIMIT_SUN,
        ...timing,
      });
      expect(() =>
        assertTronSelfPayTransaction(withValue, execExpected),
      ).toThrow(/unexpected TRON transaction fields/);
    });

    it('refuses a deploy of another config or through another factory', () => {
      const deploy = (configHash: Uint8Array, factory: string) =>
        T.buildDeployTransaction({
          owner: keySigner,
          factory,
          configHash,
          feeLimit: TRON_SELF_PAY_FEE_LIMIT_SUN,
          ...timing,
        });
      const expected = {
        kind: 'deploy' as const,
        owner: keySigner,
        factory: VECTOR_NETWORK.factory as string,
        configHash: verified.vault.configHash,
      };
      expect(() =>
        assertTronSelfPayTransaction(
          deploy(verified.vault.configHash, expected.factory),
          expected,
        ),
      ).not.toThrow();
      expect(() =>
        assertTronSelfPayTransaction(
          deploy(new Uint8Array(32).fill(1), expected.factory),
          expected,
        ),
      ).toThrow(/not the vault deployment/);
      expect(() =>
        assertTronSelfPayTransaction(
          deploy(verified.vault.configHash, VECTOR_RECIPIENT),
          expected,
        ),
      ).toThrow(/not the vault deployment/);
    });
  });
});
