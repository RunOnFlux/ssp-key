// @ts-nocheck test suite
import { Buffer } from 'buffer';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  APPROVE_TRANSACTION_DISCRIMINATOR,
  ATA_PROGRAM_ID,
  CLOSE_TRANSACTION_DISCRIMINATOR,
  CREATE_TRANSACTION_DISCRIMINATOR,
  EXECUTE_TRANSACTION_DISCRIMINATOR,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  deriveAssociatedTokenAddress,
  deriveMultisigAddress,
  deriveNonceAccount,
  deriveVaultAddress,
} from '@runonflux/solana-multisig';
import { decodeTransactionForApproval } from '../../src/lib/transactions';
import {
  decodeConsumerSolanaTransaction,
  parseConsumerSolanaPayload,
  resolveConsumerSolanaLeaves,
} from '../../src/lib/consumerSolana';
import {
  cosignAndBroadcastSOLTransaction,
  RelayAuthUnavailableError,
} from '../../src/lib/constructTx';
import {
  generateAddressKeypairSOL,
  generateSolanaPubkeyArray,
  getMasterXpriv,
} from '../../src/lib/wallet';
import { blockchains } from '../../src/storage/blockchains';

/**
 * Consumer Solana approval decode (C-3 / SOL-1 / CHN-1, H-3 / CHN-2, CHN-7)
 * and the co-sign that re-runs it.
 *
 * Bundles are built in the exact wire format SSP Wallet's
 * constructAndSignSOLTransaction produces: [nonceAdvance, ComputeBudget×2,
 * (recipient ATA createIdempotent), create, approve×2, execute, close], with
 * the inner proposal [transfer, vault→paymaster reimbursement, (memo)].
 */

const CHAIN = 'solDevnet';
const PROGRAM_ID = new PublicKey(blockchains[CHAIN].programId);
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const DEVNET_USDC = new PublicKey(
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
);
const BLOCKHASH = 'EETubP5AKHgjPAhzPAFcb8BAY6hDtV5oqBe5LBdnDS6E';

const mnemonic =
  'silver trouble mountain crouch angry park film strong escape theory illegal bunker cargo taxi tuna real drift alert state match great escape option explain';
const xprivWallet = getMasterXpriv(mnemonic, 48, 1, 0, 'p2sh', CHAIN);
const xprivKey = getMasterXpriv(mnemonic, 48, 1, 1, 'p2sh', CHAIN);
const IDX = 2;
const PATH = `0-${IDX}`;
const walletLeaves = generateSolanaPubkeyArray(xprivWallet, CHAIN, 0);
const keyLeaves = generateSolanaPubkeyArray(xprivKey, CHAIN, 0);
const KEYS = {
  path: PATH,
  xpubWallet: JSON.stringify(walletLeaves),
  xpubKey: JSON.stringify(keyLeaves),
};
const walletLeaf = new PublicKey(walletLeaves[IDX]);
const keyLeaf = new PublicKey(keyLeaves[IDX]);
const keyKp = generateAddressKeypairSOL(xprivKey, 0, IDX, CHAIN);
const [multisigPda] = deriveMultisigAddress(
  [walletLeaf, keyLeaf],
  2,
  PROGRAM_ID,
);
const [vaultPda] = deriveVaultAddress(multisigPda, 0, PROGRAM_ID);
const paymaster = Keypair.generate().publicKey;
const recipientOwner = Keypair.generate().publicKey;

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
};
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n), 0);
  return b;
};
const systemTransfer = (lamports) => Buffer.concat([u32(2), u64(lamports)]);
const transferChecked = (amount, decimals) =>
  Buffer.concat([Buffer.from([12]), u64(amount), Buffer.from([decimals])]);

function createData(accountKeys, instructions) {
  const parts = [
    Buffer.from(CREATE_TRANSACTION_DISCRIMINATOR),
    Buffer.from([0, 1, 1, 2]),
    u32(accountKeys.length),
    ...accountKeys.map((k) => k.toBuffer()),
    u32(instructions.length),
  ];
  for (const ix of instructions) {
    parts.push(
      Buffer.from([ix.p]),
      u32(ix.a.length),
      Buffer.from(ix.a),
      u32(ix.d.length),
      ix.d,
    );
  }
  parts.push(u32(0));
  return Buffer.concat(parts);
}

const indexIx = (disc, keys, index = 7) =>
  new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: keys.map(([pubkey, isSigner, isWritable]) => ({
      pubkey,
      isSigner,
      isWritable,
    })),
    data: Buffer.concat([Buffer.from(disc), u64(index)]),
  });

/** Inner proposal for a native SOL send (+ optional extra instructions). */
function nativeInner({ amount = 10_000_000, fee = 100_000, extra } = {}) {
  const keys = [vaultPda, recipientOwner, paymaster, SystemProgram.programId];
  const ixs = [
    { p: 3, a: [0, 1], d: systemTransfer(amount) },
    { p: 3, a: [0, 2], d: systemTransfer(fee) },
  ];
  if (extra) extra(keys, ixs);
  return { keys, ixs };
}

/** Inner proposal for an SPL TransferChecked send to recipientOwner. */
function splInner({
  mint = DEVNET_USDC,
  amount = 2_500_000,
  decimals = 6,
  fee = 2_600_000,
  dest,
  legacyTransfer = false,
  memo,
} = {}) {
  const sourceAta = deriveAssociatedTokenAddress(vaultPda, mint);
  const destAta = dest ?? deriveAssociatedTokenAddress(recipientOwner, mint);
  const keys = [
    vaultPda,
    sourceAta,
    destAta,
    paymaster,
    mint,
    TOKEN_PROGRAM_ID,
    SystemProgram.programId,
  ];
  const ixs = [
    legacyTransfer
      ? {
          p: 5,
          a: [1, 2, 0],
          d: Buffer.concat([Buffer.from([3]), u64(amount)]),
        }
      : { p: 5, a: [1, 4, 2, 0], d: transferChecked(amount, decimals) },
    { p: 6, a: [0, 3], d: systemTransfer(fee) },
  ];
  if (memo) {
    keys.push(MEMO);
    ixs.push({ p: keys.length - 1, a: [], d: Buffer.from(memo, 'utf8') });
  }
  return { keys, ixs, destAta, mint };
}

async function bundle({
  inner = nativeInner(),
  ata, // { owner, mint, ata }
  computeUnits = 200_000,
  microLamports = 50_000,
  multisig = multisigPda,
  txPda = Keypair.generate().publicKey,
  approveTarget,
  extraOuter = [],
  nonceAuthority = paymaster,
  skipKeyApprove = false,
} = {}) {
  const nonce = await deriveNonceAccount(multisigPda);
  const tx = new Transaction();
  tx.add(
    SystemProgram.nonceAdvance({
      noncePubkey: nonce,
      authorizedPubkey: nonceAuthority,
    }),
  );
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  if (ata) {
    tx.add(
      new TransactionInstruction({
        programId: ATA_PROGRAM_ID,
        keys: [
          { pubkey: paymaster, isSigner: true, isWritable: true },
          { pubkey: ata.ata, isSigner: false, isWritable: true },
          { pubkey: ata.owner, isSigner: false, isWritable: false },
          { pubkey: ata.mint, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]),
      }),
    );
  }
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: multisig, isSigner: false, isWritable: true },
        { pubkey: txPda, isSigner: false, isWritable: true },
        { pubkey: walletLeaf, isSigner: true, isWritable: false },
        { pubkey: paymaster, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: createData(inner.keys, inner.ixs),
    }),
  );
  tx.add(
    indexIx(APPROVE_TRANSACTION_DISCRIMINATOR, [
      [multisig, false, false],
      [txPda, false, true],
      [walletLeaf, true, false],
    ]),
  );
  if (!skipKeyApprove) {
    tx.add(
      indexIx(APPROVE_TRANSACTION_DISCRIMINATOR, [
        [multisig, false, false],
        [approveTarget ?? txPda, false, true],
        [keyLeaf, true, false],
      ]),
    );
  }
  tx.add(
    indexIx(EXECUTE_TRANSACTION_DISCRIMINATOR, [
      [multisig, false, false],
      [txPda, false, true],
      [walletLeaf, true, false],
      [vaultPda, false, true],
    ]),
  );
  tx.add(
    indexIx(CLOSE_TRANSACTION_DISCRIMINATOR, [
      [multisig, false, true],
      [txPda, false, true],
      [paymaster, false, true],
    ]),
  );
  extraOuter.forEach((ix) => tx.add(ix));
  tx.recentBlockhash = BLOCKHASH;
  tx.feePayer = paymaster;
  return tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
}

const leaves = resolveConsumerSolanaLeaves(KEYS.xpubWallet, KEYS.xpubKey, PATH);
const decode = (serializedTxBase64, extra = {}, usdRate = 0) =>
  decodeConsumerSolanaTransaction(
    CHAIN,
    { serializedTxBase64, ...extra },
    leaves,
    usdRate,
  );

describe('consumer Solana decode — honest bundles', () => {
  it('decodes a native send bound to the derived vault', async () => {
    const decoded = await decode(await bundle());
    expect(decoded.sender).toBe(vaultPda.toBase58());
    expect(decoded.multisigPda).toBe(multisigPda.toBase58());
    expect(decoded.asset).toBe('native');
    expect(decoded.recipients).toEqual([
      { address: recipientOwner.toBase58(), amount: '10000000' },
    ]);
    expect(decoded.feeLamports).toBe('100000');
    expect(decoded.tokenSymbol).toBe(blockchains[CHAIN].symbol);
  });

  it('H-3: shows the verified OWNER of an SPL send, symbol from the key list', async () => {
    const inner = splInner({ memo: 'invoice 42' });
    const raw = await bundle({
      inner,
      ata: { ata: inner.destAta, owner: recipientOwner, mint: inner.mint },
    });
    const decoded = await decode(raw, {
      splRecipientOwner: recipientOwner.toBase58(),
      splMint: DEVNET_USDC.toBase58(),
    });
    expect(decoded.asset).toBe('spl');
    expect(decoded.mint).toBe(DEVNET_USDC.toBase58());
    expect(decoded.tokenSymbol).toBe('TEST-USDC');
    expect(decoded.decimals).toBe(6);
    expect(decoded.recipients).toEqual([
      {
        address: recipientOwner.toBase58(),
        ata: inner.destAta.toBase58(),
        ownerVerified: true,
        amount: '2500000',
      },
    ]);
    expect(decoded.memo).toBe('invoice 42');
    expect(decoded.warnings).toEqual([]);
  });

  it('H-3: an old wallet without the owner gets the token account + a warning', async () => {
    const inner = splInner();
    const decoded = await decode(await bundle({ inner }));
    expect(decoded.recipients[0].address).toBe(inner.destAta.toBase58());
    expect(decoded.recipients[0].ownerVerified).toBe(false);
    expect(decoded.warnings).toContain('spl_owner_unverified');
  });

  it('H-3: an unlisted mint has no symbol and is flagged', async () => {
    const unknownMint = Keypair.generate().publicKey;
    const inner = splInner({ mint: unknownMint, decimals: 9 });
    const decoded = await decode(await bundle({ inner }));
    expect(decoded.tokenSymbol).toBe('');
    expect(decoded.decimals).toBe(9);
    expect(decoded.warnings).toContain('unknown_token');
  });

  it('decodeTransactionForApproval maps the verified decode for the screen', async () => {
    const inner = splInner();
    const raw = await bundle({
      inner,
      ata: { ata: inner.destAta, owner: recipientOwner, mint: inner.mint },
    });
    const info = await decodeTransactionForApproval(
      JSON.stringify({
        unsignedTxBase64: raw,
        tokenMint: DEVNET_USDC.toBase58(),
        tokenSymbol: 'FAKE', // wallet-supplied symbol is ignored
        tokenDecimals: 6,
        splRecipientOwner: recipientOwner.toBase58(),
        splMint: DEVNET_USDC.toBase58(),
      }),
      CHAIN,
      KEYS,
      { getUsdRate: () => Promise.resolve(0) },
    );
    expect(info.sender).toBe(vaultPda.toBase58());
    expect(info.receiver).toBe(recipientOwner.toBase58());
    expect(info.amount).toBe('2.5');
    expect(info.tokenSymbol).toBe('TEST-USDC');
    expect(info.token).toBe(DEVNET_USDC.toBase58());
    expect(info.fee).toBe('0.0026');
  });

  it('sums and lists every recipient of a multi-output proposal', async () => {
    const other = Keypair.generate().publicKey;
    const raw = await bundle({
      inner: nativeInner({
        extra: (keys, ixs) => {
          keys.splice(3, 0, other); // keep SystemProgram last
          ixs.forEach((ix) => {
            if (ix.p === 3) ix.p = 4;
          });
          ixs.push({ p: 4, a: [0, 3], d: systemTransfer(5_000_000) });
        },
      }),
    });
    const info = await decodeTransactionForApproval(raw, CHAIN, KEYS, {
      getUsdRate: () => Promise.resolve(0),
    });
    expect(info.recipientCount).toBe(2);
    expect(info.amount).toBe('0.015');
    expect(info.recipients.map((r) => r.address)).toEqual([
      recipientOwner.toBase58(),
      other.toBase58(),
    ]);
  });

  it('fails closed without key material', async () => {
    const info = await decodeTransactionForApproval(await bundle(), CHAIN);
    expect(info.receiver).toBe('decodingError');
  });
});

describe('consumer Solana decode — refusals (fail closed)', () => {
  it('SOL-1 PoC [3]: a hidden Token SetAuthority inner instruction', async () => {
    const attacker = Keypair.generate().publicKey;
    const vaultUsdc = deriveAssociatedTokenAddress(vaultPda, DEVNET_USDC);
    const raw = await bundle({
      inner: nativeInner({
        extra: (keys, ixs) => {
          keys.push(vaultUsdc, TOKEN_PROGRAM_ID);
          const setAuthority = Buffer.concat([
            Buffer.from([6, 2, 1]),
            attacker.toBuffer(),
          ]);
          ixs.push({ p: keys.length - 1, a: [4, 0], d: setAuthority });
        },
      }),
    });
    await expect(decode(raw)).rejects.toThrow(/token instruction/);
  });

  it('refuses Token-2022 and unknown inner programs', async () => {
    const raw2022 = await bundle({
      inner: nativeInner({
        extra: (keys, ixs) => {
          keys.push(TOKEN_2022_PROGRAM_ID);
          ixs.push({ p: keys.length - 1, a: [0], d: Buffer.from([9]) });
        },
      }),
    });
    await expect(decode(raw2022)).rejects.toThrow(/Token-2022/);
    const rawOther = await bundle({
      inner: nativeInner({
        extra: (keys, ixs) => {
          keys.push(Keypair.generate().publicKey);
          ixs.push({ p: keys.length - 1, a: [0], d: Buffer.from([1]) });
        },
      }),
    });
    await expect(decode(rawOther)).rejects.toThrow(/Unexpected program/);
  });

  it('refuses a System Assign hidden in the proposal', async () => {
    const raw = await bundle({
      inner: nativeInner({
        extra: (keys, ixs) => {
          const assign = Buffer.concat([
            u32(1),
            Keypair.generate().publicKey.toBuffer(),
          ]);
          ixs.push({ p: 3, a: [0], d: assign });
        },
      }),
    });
    await expect(decode(raw)).rejects.toThrow(/System instruction/);
  });

  it('refuses a proposal mixing native SOL and SPL transfers', async () => {
    const inner = splInner();
    inner.keys.push(recipientOwner);
    inner.ixs.push({
      p: 6,
      a: [0, inner.keys.length - 1],
      d: systemTransfer(1_000_000),
    });
    await expect(decode(await bundle({ inner }))).rejects.toThrow(/mixes/);
  });

  it('H-3: refuses legacy SPL Transfer (tag 3)', async () => {
    const raw = await bundle({ inner: splInner({ legacyTransfer: true }) });
    await expect(decode(raw)).rejects.toThrow(/Legacy SPL Transfer/);
  });

  it('H-3: refuses a token account that is not the owner the user typed', async () => {
    const attackerAta = deriveAssociatedTokenAddress(
      Keypair.generate().publicKey,
      DEVNET_USDC,
    );
    const raw = await bundle({ inner: splInner({ dest: attackerAta }) });
    await expect(
      decode(raw, { splRecipientOwner: recipientOwner.toBase58() }),
    ).rejects.toThrow(/does not belong to the requested recipient/);
  });

  it('refuses mint / decimals that contradict the wallet hints or the key list', async () => {
    const raw = await bundle({ inner: splInner() });
    await expect(
      decode(raw, { splMint: Keypair.generate().publicKey.toBase58() }),
    ).rejects.toThrow(/mint/);
    await expect(decode(raw, { tokenDecimals: 9 })).rejects.toThrow(/decimals/);
    const wrongDecimals = await bundle({ inner: splInner({ decimals: 9 }) });
    await expect(decode(wrongDecimals)).rejects.toThrow(/token list/);
  });

  it('CHN-1 rider: an approve for a different proposal is refused', async () => {
    const raw = await bundle({ approveTarget: Keypair.generate().publicKey });
    await expect(decode(raw)).rejects.toThrow(/different proposal/);
  });

  it('refuses a proposal on a multisig that is not this wallet + key', async () => {
    const [otherMultisig] = deriveMultisigAddress(
      [walletLeaf, Keypair.generate().publicKey],
      2,
      PROGRAM_ID,
    );
    const raw = await bundle({ multisig: otherMultisig });
    await expect(decode(raw)).rejects.toThrow(/different vault/);
  });

  it('refuses a proposal that spends from another vault', async () => {
    const inner = nativeInner();
    inner.keys[0] = Keypair.generate().publicKey;
    await expect(decode(await bundle({ inner }))).rejects.toThrow(
      /does not spend from this wallet vault/,
    );
  });

  it('refuses a second create_transaction and unknown outer programs', async () => {
    const second = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: multisigPda, isSigner: false, isWritable: true },
        {
          pubkey: Keypair.generate().publicKey,
          isSigner: false,
          isWritable: true,
        },
        { pubkey: walletLeaf, isSigner: true, isWritable: false },
        { pubkey: paymaster, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: createData(nativeInner().keys, nativeInner().ixs),
    });
    await expect(
      decode(await bundle({ extraOuter: [second] })),
    ).rejects.toThrow(/More than one proposal/);
    const outer = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [{ pubkey: keyLeaf, isSigner: true, isWritable: true }],
      data: Buffer.from([0]),
    });
    await expect(decode(await bundle({ extraOuter: [outer] }))).rejects.toThrow(
      /Unexpected program/,
    );
    const drain = SystemProgram.transfer({
      fromPubkey: keyLeaf,
      toPubkey: paymaster,
      lamports: 1,
    });
    await expect(decode(await bundle({ extraOuter: [drain] }))).rejects.toThrow(
      /System instruction/,
    );
  });

  it('refuses a nonce advance with another authority', async () => {
    await expect(
      decode(await bundle({ nonceAuthority: keyLeaf })),
    ).rejects.toThrow(/System instruction/);
  });

  it('refuses a bundle that does not ask this key to approve', async () => {
    await expect(
      decode(await bundle({ skipKeyApprove: true })),
    ).rejects.toThrow(/approve/);
  });

  it('caps ComputeBudget', async () => {
    await expect(
      decode(await bundle({ computeUnits: 1_400_000 })),
    ).rejects.toThrow(/Compute unit limit/);
    await expect(
      decode(await bundle({ microLamports: 50_000_000 })),
    ).rejects.toThrow(/Compute unit price/);
  });

  it('CHN-7: caps the paymaster reimbursement at 0.05 SOL and the USD cap', async () => {
    await expect(
      decode(await bundle({ inner: nativeInner({ fee: 2_000_000_000 }) })),
    ).rejects.toThrow(/exceeds the maximum of 50000000/);
    // $100 at $10,000/SOL = 0.01 SOL: a 0.02 SOL fee is refused
    await expect(
      decode(
        await bundle({ inner: nativeInner({ fee: 20_000_000 }) }),
        {},
        10_000,
      ),
    ).rejects.toThrow(/exceeds the maximum of 10000000/);
    const ok = await decode(
      await bundle({ inner: nativeInner({ fee: 5_700_000 }) }),
    );
    expect(ok.feeLamports).toBe('5700000');
  });

  it('refuses token-send metadata on a native transfer', async () => {
    await expect(
      decode(await bundle(), { splRecipientOwner: recipientOwner.toBase58() }),
    ).rejects.toThrow(/native transfer/);
  });
});

describe('payload + leaves parsing', () => {
  it('accepts bare base64 (older wallets) and JSON', () => {
    expect(parseConsumerSolanaPayload('AAAA')).toEqual({
      serializedTxBase64: 'AAAA',
    });
    expect(
      parseConsumerSolanaPayload(
        JSON.stringify({ unsignedTxBase64: 'AAAA', tokenDecimals: 6 }),
      ),
    ).toEqual({ serializedTxBase64: 'AAAA', tokenDecimals: 6 });
    expect(() =>
      parseConsumerSolanaPayload(JSON.stringify({ tokenMint: 'x' })),
    ).toThrow();
  });

  it('refuses non-consumer branches and out-of-range indices', () => {
    expect(() =>
      resolveConsumerSolanaLeaves(KEYS.xpubWallet, KEYS.xpubKey, '10-0'),
    ).toThrow();
    expect(() =>
      resolveConsumerSolanaLeaves(KEYS.xpubWallet, KEYS.xpubKey, '1-0'),
    ).toThrow(/branch 0/);
    expect(() =>
      resolveConsumerSolanaLeaves(KEYS.xpubWallet, KEYS.xpubKey, '0-20'),
    ).toThrow(/out of range/);
  });
});

describe('cosignAndBroadcastSOLTransaction re-verifies before signing', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  // RA-2: every broadcast is WK-authenticated.
  const AUTH = {
    wkIdentity: 'bc1qwk',
    createAuth: () =>
      Promise.resolve({
        signature: 'auth-sig',
        message: 'auth-msg',
        publicKey: 'pk',
      }),
  };

  it('signs an honest bundle and posts it with wkIdentity auth', async () => {
    let captured = {};
    global.fetch = jest.fn((_url, init) => {
      captured = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ status: 'success', data: { signature: 'SIG' } }),
      });
    });
    const createAuth = jest.fn(() =>
      Promise.resolve({
        signature: 'auth-sig',
        message: 'auth-msg',
        publicKey: 'pk',
      }),
    );
    const raw = await bundle();
    const sig = await cosignAndBroadcastSOLTransaction({
      chain: CHAIN,
      payload: { serializedTxBase64: raw },
      leaves,
      keyPrivKeyHex: keyKp.privKey,
      relayHost: 'relay.example',
      wkIdentity: 'bc1qwk',
      createAuth,
    });
    expect(sig).toBe('SIG');
    expect(createAuth).toHaveBeenCalledWith({
      chain: CHAIN,
      serializedTxBase64: captured.serializedTxBase64,
      wkIdentity: 'bc1qwk',
    });
    expect(captured).toMatchObject({
      chain: CHAIN,
      wkIdentity: 'bc1qwk',
      signature: 'auth-sig',
    });
    const sent = Transaction.from(
      Buffer.from(captured.serializedTxBase64, 'base64'),
    );
    const keySig = sent.signatures.find((s) => s.publicKey.equals(keyLeaf));
    expect(keySig.signature).not.toBeNull();
    const paySig = sent.signatures.find((s) => s.publicKey.equals(paymaster));
    expect(paySig.signature).toBeNull();
  });

  it('surfaces a relay error response', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'error',
            data: { message: 'paymaster simulation failed' },
          }),
      }),
    );
    await expect(
      cosignAndBroadcastSOLTransaction({
        chain: CHAIN,
        payload: { serializedTxBase64: await bundle() },
        leaves,
        keyPrivKeyHex: keyKp.privKey,
        relayHost: 'relay.example',
        ...AUTH,
      }),
    ).rejects.toThrow(/paymaster simulation failed/);
  });

  it('never signs or posts a bundle the decode refuses', async () => {
    global.fetch = jest.fn();
    const raw = await bundle({ approveTarget: Keypair.generate().publicKey });
    await expect(
      cosignAndBroadcastSOLTransaction({
        chain: CHAIN,
        payload: { serializedTxBase64: raw },
        leaves,
        keyPrivKeyHex: keyKp.privKey,
        relayHost: 'relay.example',
        ...AUTH,
      }),
    ).rejects.toThrow(/different proposal/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses a signing key that is not the request leaf', async () => {
    global.fetch = jest.fn();
    const otherKp = generateAddressKeypairSOL(xprivKey, 0, IDX + 1, CHAIN);
    await expect(
      cosignAndBroadcastSOLTransaction({
        chain: CHAIN,
        payload: { serializedTxBase64: await bundle() },
        leaves,
        keyPrivKeyHex: otherKp.privKey,
        relayHost: 'relay.example',
        ...AUTH,
      }),
    ).rejects.toThrow(/privkey\/pubkey mismatch/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['no wkIdentity', { ...AUTH, wkIdentity: '' }],
    ['no auth builder', { wkIdentity: 'bc1qwk' }],
    [
      'the auth builder returns nothing',
      { wkIdentity: 'bc1qwk', createAuth: () => Promise.resolve(null) },
    ],
    [
      'the auth builder fails',
      {
        wkIdentity: 'bc1qwk',
        createAuth: () => Promise.reject(new Error('no identity key')),
      },
    ],
  ])(
    'RA-2: never posts unsigned to /v1/sol/broadcast (%s)',
    async (_label, auth) => {
      global.fetch = jest.fn();
      await expect(
        cosignAndBroadcastSOLTransaction({
          chain: CHAIN,
          payload: { serializedTxBase64: await bundle() },
          leaves,
          keyPrivKeyHex: keyKp.privKey,
          relayHost: 'relay.example',
          ...auth,
        }),
      ).rejects.toBeInstanceOf(RelayAuthUnavailableError);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );
});
