/**
 * TRON on SSP Key: the cross-repo vectors (TRON_SSP_CONTRACT.md §2) reproduced
 * through the key's OWN derivation, the consumer §5 verification (rules 1–5)
 * and every tampered payload it must refuse.
 */
import * as T from '@runonflux/tron-multisig';
import { HDKey } from '@scure/bip32';
import {
  TronNotLiveError,
  TronVerifyError,
  generateAddressKeypairTRON,
  generateMultisigAddressTRON,
  isTronChain,
  isTronLive,
  parseTronOpPayload,
  tronApprovedSummary,
  tronConsumerVault,
  tronDisplayTokens,
  tronFeeCeilings,
  tronLeafAddress,
  tronNetwork,
  tronOpView,
  verifyTronConsumerRequest,
} from '../../src/lib/tron';
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
  consumerPayload,
  leafPriv,
  tronXpriv,
  tronXpub,
} from './tronFixtures';
import { blockchains } from '@storage/blockchains';

const V = TRON_VECTORS;
const USDT = T.NETWORKS.mainnet.usdt as string;

const CTX = {
  xpubWallet: V.consumer.walletXpub,
  xpubKey: V.consumer.keyXpub,
  path: '0-0',
  network: VECTOR_NETWORK,
  now: VECTOR_NOW,
};

const VECTOR_OP = T.opFromJson(V.consumerOp.op);

function opWith(p: Partial<Parameters<typeof T.buildOp>[0]>): T.Op {
  return T.buildOp({
    calls: [T.trc20TransferCall(USDT, VECTOR_RECIPIENT, 25000000n)],
    nonce: 7n,
    deadline: 1790000000n,
    fee: T.trxFee(6300000n, VECTOR_FEE_COLLECTOR),
    ...p,
  });
}

function expectRefusal(raw: string, match: RegExp | string) {
  let caught: unknown;
  try {
    verifyTronConsumerRequest(raw, TRON, CTX);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  const reason =
    caught instanceof T.PolicyError
      ? `policy:${caught.reason}`
      : caught instanceof TronVerifyError
        ? caught.reason
        : String(caught);
  if (typeof match === 'string') {
    expect(reason).toBe(match);
  } else {
    expect(reason).toMatch(match);
  }
}

describe('TRON registry', () => {
  it('registers tron and tronNile as chainType tron with 6 decimals', () => {
    for (const chain of ['tron', 'tronNile']) {
      const cfg = blockchains[chain];
      expect(cfg.chainType).toBe('tron');
      expect(cfg.decimals).toBe(6);
      expect(cfg.scriptType).toBe('p2sh');
      expect(cfg.backend).toBe('trongrid');
      expect(cfg.bip32).toEqual({ public: 0x0488b21e, private: 0x0488ade4 });
      expect(isTronChain(chain)).toBe(true);
    }
    expect(blockchains.tron.slip).toBe(195);
    expect(blockchains.tron.symbol).toBe('TRX');
    expect(blockchains.tronNile.slip).toBe(1);
    expect(blockchains.tronNile.symbol).toBe('TEST-TRX');
    expect(tronNetwork('tron').chainId).toBe(728126428n);
    expect(tronNetwork('tronNile').chainId).toBe(3448148188n);
    expect(isTronChain('eth')).toBe(false);
  });

  it('lists USDT first after the native token (case-sensitive base58)', () => {
    expect(blockchains.tron.tokens[0].contract).toBe('');
    expect(blockchains.tron.tokens[1]).toEqual(
      expect.objectContaining({ contract: USDT, symbol: 'USDT', decimals: 6 }),
    );
    expect(blockchains.tronNile.tokens[1].contract).toBe(T.NETWORKS.nile.usdt);
    for (const tk of blockchains.tron.tokens.slice(1)) {
      expect(T.isValidAddress(tk.contract)).toBe(true);
    }
    const tokens = tronDisplayTokens(TRON, VECTOR_NETWORK);
    expect(tokens[0]).toEqual({ address: USDT, symbol: 'USDT', decimals: 6 });
  });

  it('is not live while the SDK table has no deployment (fail closed)', () => {
    expect(isTronLive(tronNetwork('tron'))).toBe(false);
    expect(isTronLive(tronNetwork('tronNile'))).toBe(false);
    expect(isTronLive(VECTOR_NETWORK)).toBe(true);
    expect(() =>
      generateMultisigAddressTRON(
        V.consumer.walletXpub,
        V.consumer.keyXpub,
        0,
        0,
        TRON,
      ),
    ).toThrow(TronNotLiveError);
    expect(() =>
      verifyTronConsumerRequest(consumerPayload(VECTOR_OP), TRON, {
        ...CTX,
        network: tronNetwork('tron'),
      }),
    ).toThrow(TronNotLiveError);
  });

  it('pins the fee ceilings: 30 TRX or 8 USDT', () => {
    expect(tronFeeCeilings(VECTOR_NETWORK)).toEqual([
      { token: T.TRX_FEE_TOKEN, max: 30000000n },
      { token: USDT, max: 8000000n },
    ]);
  });
});

describe('TRON vectors (TRON_SSP_CONTRACT.md §2)', () => {
  it('derives the vector account xpubs through the key’s own derivation', () => {
    expect(tronXpub(MNEMONIC_W, 0)).toBe(V.consumer.walletXpub);
    expect(tronXpub(MNEMONIC_KK, 0)).toBe(V.consumer.keyXpub);
    expect(
      [MNEMONIC_W, MNEMONIC_KK, MNEMONIC_S3].map((m) => tronXpub(m, 100)),
    ).toEqual(V.enterpriseSingle2of3.signerXpubs);
  });

  it.each(Object.entries(V.consumer.leaves))(
    'reproduces consumer leaf %s',
    (leaf, expected) => {
      const [a, b] = leaf.split('-').map(Number);
      expect(tronLeafAddress(V.consumer.walletXpub, a, b, TRON)).toBe(
        expected.walletSigner,
      );
      expect(tronLeafAddress(V.consumer.keyXpub, a, b, TRON)).toBe(
        expected.keySigner,
      );
      const own = tronConsumerVault(
        V.consumer.walletXpub,
        V.consumer.keyXpub,
        a,
        b,
        TRON,
        VECTOR_NETWORK,
      );
      expect(own.config.signers).toEqual(expected.signers);
      expect(own.config.threshold).toBe(expected.threshold);
      expect(T.to0x(own.vault.configHash)).toBe(expected.configHash);
      expect(own.vault.address).toBe(expected.address);
      expect(
        generateMultisigAddressTRON(
          V.consumer.walletXpub,
          V.consumer.keyXpub,
          a,
          b,
          TRON,
          VECTOR_NETWORK,
        ).address,
      ).toBe(expected.address);
    },
  );

  it('derives the key signer through generateAddressKeypairTRON (xpriv)', () => {
    const kp = generateAddressKeypairTRON(
      tronXpriv(MNEMONIC_KK, 0),
      0,
      0,
      TRON,
    );
    expect(kp.privKey).toMatch(/^[0-9a-f]{64}$/);
    expect(T.addressFromPublicKey(T.hexToBytes(kp.pubKey))).toBe(
      V.consumer.leaves['0-0'].keySigner,
    );
  });

  it('reproduces the enterprise single-device 2-of-3 vault', () => {
    const e = V.enterpriseSingle2of3;
    const pubs = e.signerXpubs.map((x) =>
      HDKey.fromExtendedKey(x, blockchains[TRON].bip32)
        .deriveChild(e.vaultIndex)
        .deriveChild(e.addressIndex),
    );
    const config = T.buildEnterpriseConfig(
      pubs.map((p) => p.publicKey as Uint8Array),
      e.threshold,
    );
    expect(config.signers).toEqual(e.signers);
    const vault = T.deriveVault(VECTOR_NETWORK, config);
    expect(T.to0x(vault.configHash)).toBe(e.configHash);
    expect(vault.address).toBe(e.address);
  });

  it('reproduces the enterprise dual 2-of-2 vault (2N keys, 2M threshold)', () => {
    const e = V.enterpriseDual2of2;
    const leaves = [MNEMONIC_W, MNEMONIC_KK, MNEMONIC_S3, MNEMONIC_Z].map((m) =>
      HDKey.fromExtendedKey(tronXpub(m, 100), blockchains[TRON].bip32)
        .deriveChild(0)
        .deriveChild(0),
    );
    const config = T.buildEnterpriseConfig(
      leaves.map((l) => l.publicKey as Uint8Array),
      2 * e.requiredSigners,
    );
    expect(config.threshold).toBe(e.threshold);
    expect(config.signers).toEqual(e.signers);
    const vault = T.deriveVault(VECTOR_NETWORK, config);
    expect(T.to0x(vault.configHash)).toBe(e.configHash);
    expect(vault.address).toBe(e.address);
  });

  it('reproduces the consumer Op digest and both signatures exactly', () => {
    const o = V.consumerOp;
    expect(T.to0x(T.domainSeparator(VECTOR_NETWORK.chainId, o.vault))).toBe(
      o.domainSeparator,
    );
    const digest = T.opDigest(VECTOR_NETWORK.chainId, o.vault, VECTOR_OP);
    expect(T.to0x(digest)).toBe(o.digest);
    const walletSigner = T.localSigner(leafPriv(MNEMONIC_W, 0, 0, 0));
    const keySigner = T.localSigner(leafPriv(MNEMONIC_KK, 0, 0, 0));
    expect(T.to0x(walletSigner.signDigest(digest))).toBe(o.walletSignature);
    expect(T.to0x(keySigner.signDigest(digest))).toBe(o.keySignature);
    const config = T.buildConfig(V.consumer.leaves['0-0'].signers, 2);
    const packed = T.assembleSignatures(digest, config, [
      T.hexToBytes(o.walletSignature),
      T.hexToBytes(o.keySignature),
    ]);
    expect(T.to0x(packed)).toBe(o.signaturesPacked);
    expect(
      T.to0x(
        T.encodeExecute({
          signersPacked: T.packSigners(config.signers),
          threshold: 2,
          op: VECTOR_OP,
          signaturesPacked: packed,
        }),
      ),
    ).toBe(o.executeCalldata);
    walletSigner.destroy();
    keySigner.destroy();
  });
});

describe('verifyTronConsumerRequest (contract §5 rules 1–5)', () => {
  it('accepts the vector payload and displays exactly what is signed', () => {
    const raw = JSON.stringify({
      format: 'ssp-tron-op',
      version: 1,
      network: 'ssp-vectors',
      vault: V.consumerOp.vault,
      signers: V.consumer.leaves['0-0'].signers,
      threshold: 2,
      op: V.consumerOp.op,
      walletSignature: V.consumerOp.walletSignature,
    });
    const verified = verifyTronConsumerRequest(raw, TRON, CTX);
    expect(T.to0x(verified.digest)).toBe(V.consumerOp.digest);
    expect(verified.vault.address).toBe(V.consumerOp.vault);
    expect(verified.keySigner).toBe(V.consumer.leaves['0-0'].keySigner);
    expect(tronApprovedSummary(verified)).toEqual({
      chain: TRON,
      vault: V.consumerOp.vault,
      digest: V.consumerOp.digest,
    });
    const view = tronOpView(verified.display, TRON);
    expect(view.calls).toEqual([
      expect.objectContaining({
        kind: 'trc20Transfer',
        to: VECTOR_RECIPIENT,
        amount: '25',
        amountBaseUnits: '25000000',
        symbol: 'USDT',
        decimals: 6,
        token: USDT,
        unknownToken: false,
      }),
    ]);
    expect(view.fee).toEqual(
      expect.objectContaining({
        kind: 'trx',
        amount: '6.3',
        symbol: 'TRX',
        recipient: VECTOR_FEE_COLLECTOR,
      }),
    );
    expect(view.selfPay).toBe(false);
    expect(view.deadline).toBe(1790000000);
    expect(view.nonce).toBe('7');
  });

  it('requires the SDK network name exactly (not the chain id)', () => {
    expectRefusal(
      consumerPayload(VECTOR_OP, { network: 'tron' }),
      'wrong_network',
    );
  });

  it('refuses a payload for another vault', () => {
    expectRefusal(
      consumerPayload(VECTOR_OP, { vault: V.consumer.leaves['0-1'].address }),
      'wrong_vault',
    );
  });

  it('refuses a payload naming other signers', () => {
    expectRefusal(
      consumerPayload(VECTOR_OP, {
        signers: V.consumer.leaves['0-1'].signers,
      }),
      'wrong_vault',
    );
    expectRefusal(consumerPayload(VECTOR_OP, { threshold: 1 }), 'wrong_vault');
  });

  it('refuses a payload for another path (vault of leaf 0-1 at path 0-0)', () => {
    expectRefusal(
      consumerPayload(VECTOR_OP, {}, { addressIndex: 1 }),
      'wrong_vault',
    );
  });

  it('refuses a wallet signature over another digest (digest mismatch)', () => {
    const other = opWith({ calls: [T.trxTransferCall(VECTOR_RECIPIENT, 1n)] });
    const signedOther = JSON.parse(consumerPayload(other)) as {
      walletSignature: string;
    };
    expectRefusal(
      consumerPayload(VECTOR_OP, {
        walletSignature: signedOther.walletSignature,
      }),
      'bad_wallet_signature',
    );
  });

  it('refuses a signature by anyone but the wallet leaf', () => {
    expectRefusal(
      consumerPayload(
        VECTOR_OP,
        {},
        { signWith: leafPriv(MNEMONIC_KK, 0, 0, 0) },
      ),
      'bad_wallet_signature',
    );
    expectRefusal(
      consumerPayload(
        VECTOR_OP,
        {},
        { signWith: leafPriv(MNEMONIC_Z, 0, 0, 0) },
      ),
      'bad_wallet_signature',
    );
    expectRefusal(
      consumerPayload(VECTOR_OP, { walletSignature: '0x' + '00'.repeat(65) }),
      'bad_wallet_signature',
    );
  });

  it('refuses a fee to anyone but the pinned collector', () => {
    expectRefusal(
      consumerPayload(opWith({ fee: T.trxFee(6300000n, VECTOR_RECIPIENT) })),
      'policy:FEE_RECIPIENT_MISMATCH',
    );
  });

  it('refuses a fee above the ceiling (30 TRX / 8 USDT)', () => {
    expectRefusal(
      consumerPayload(
        opWith({ fee: T.trxFee(30000001n, VECTOR_FEE_COLLECTOR) }),
      ),
      'policy:FEE_ABOVE_CEILING',
    );
    expectRefusal(
      consumerPayload(
        opWith({ fee: T.trc20Fee(USDT, 8000001n, VECTOR_FEE_COLLECTOR) }),
      ),
      'policy:FEE_ABOVE_CEILING',
    );
    // at the ceiling is fine
    expect(() =>
      verifyTronConsumerRequest(
        consumerPayload(
          opWith({ fee: T.trc20Fee(USDT, 8000000n, VECTOR_FEE_COLLECTOR) }),
        ),
        TRON,
        CTX,
      ),
    ).not.toThrow();
  });

  it('refuses a fee in any token but TRX or the network USDT', () => {
    expectRefusal(
      consumerPayload(
        opWith({
          fee: T.trc20Fee(
            'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9',
            1n,
            VECTOR_FEE_COLLECTOR,
          ),
        }),
      ),
      'policy:FEE_TOKEN_NOT_ALLOWED',
    );
  });

  it('refuses an approve call (consumer policy)', () => {
    expectRefusal(
      consumerPayload(
        opWith({ calls: [T.approveCall(USDT, VECTOR_RECIPIENT, 1n)] }),
      ),
      'policy:CALL_KIND_NOT_ALLOWED',
    );
  });

  it('refuses an unknown contract call (consumer policy)', () => {
    const call: T.Call = {
      to: USDT,
      value: 0n,
      data: T.hexToBytes('0xdeadbeef'),
      tokenId: 0n,
      tokenValue: 0n,
    };
    expectRefusal(
      consumerPayload(opWith({ calls: [call] })),
      'policy:CALL_KIND_NOT_ALLOWED',
    );
    // TRX attached to a transfer calldata makes it `unknown` too
    expectRefusal(
      consumerPayload(
        opWith({
          calls: [
            {
              ...T.trc20TransferCall(USDT, VECTOR_RECIPIENT, 1n),
              value: 1n,
            },
          ],
        }),
      ),
      'policy:CALL_KIND_NOT_ALLOWED',
    );
  });

  it('refuses a vault self-call (consumer policy)', () => {
    const vault = V.consumer.leaves['0-0'].address;
    expectRefusal(
      consumerPayload(
        opWith({
          calls: [T.selfCall(vault, { action: 'withdrawReward' })],
        }),
      ),
      'policy:CALL_KIND_NOT_ALLOWED',
    );
  });

  it('refuses an expired or too-far deadline (≤ now + 2 h)', () => {
    expectRefusal(
      consumerPayload(opWith({ deadline: VECTOR_NOW - 1n })),
      'policy:DEADLINE_EXPIRED',
    );
    expectRefusal(
      consumerPayload(opWith({ deadline: VECTOR_NOW + 7201n })),
      'policy:DEADLINE_TOO_FAR',
    );
    expect(() =>
      verifyTronConsumerRequest(
        consumerPayload(opWith({ deadline: VECTOR_NOW + 7200n })),
        TRON,
        CTX,
      ),
    ).not.toThrow();
  });

  it('refuses malformed envelopes', () => {
    expectRefusal('not json', 'not_tron_payload');
    expectRefusal(
      consumerPayload(VECTOR_OP, { format: 'kaspa-core-signing-bundle' }),
      'not_tron_payload',
    );
    expectRefusal(consumerPayload(VECTOR_OP, { version: 2 }), 'bad_payload');
    expectRefusal(
      consumerPayload(VECTOR_OP, { memo: 'extra field' }),
      'bad_payload',
    );
    // a non-canonical Op (upper-case hex) never parses
    const raw = JSON.parse(consumerPayload(VECTOR_OP)) as {
      op: { calls: { data: string }[] };
    };
    raw.op.calls[0].data = raw.op.calls[0].data
      .toUpperCase()
      .replace('0X', '0x');
    expectRefusal(JSON.stringify(raw), 'bad_payload');
    expectRefusal(
      consumerPayload(VECTOR_OP, { network: 'nile' }),
      'wrong_network',
    );
  });

  it('refuses a non-consumer path (typeIndex must be 0)', () => {
    expect(() =>
      verifyTronConsumerRequest(consumerPayload(VECTOR_OP), TRON, {
        ...CTX,
        path: '1-0',
      }),
    ).toThrow(TronVerifyError);
    expect(() =>
      verifyTronConsumerRequest(consumerPayload(VECTOR_OP), TRON, {
        ...CTX,
        path: '0-x',
      }),
    ).toThrow(TronVerifyError);
  });

  it('parses the payload strictly and never lowercases addresses', () => {
    const parsed = parseTronOpPayload(consumerPayload(VECTOR_OP));
    expect(parsed.vault).toBe(V.consumerOp.vault);
    expect(parsed.signers).toEqual(V.consumer.leaves['0-0'].signers);
    expect(T.opsEqual(parsed.op, VECTOR_OP)).toBe(true);
  });
});
