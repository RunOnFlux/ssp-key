import { keccak_256 } from '@noble/hashes/sha3.js';
import { decodeErc20Calldata } from '../../src/lib/calldataDecode';

/**
 * Derive a 4-byte function selector from its canonical signature. Test
 * vectors are built from DERIVED selectors, never hardcoded hex — a wrong
 * constant in the decoder then fails these tests instead of being
 * self-confirmed by vectors built from the same wrong constant (which is
 * exactly how a broken setApprovalForAll selector once slipped through).
 */
const selector = (signature: string) =>
  Buffer.from(keccak_256(new TextEncoder().encode(signature)))
    .toString('hex')
    .slice(0, 8);

const SEL_APPROVE = selector('approve(address,uint256)');
const SEL_INCREASE_ALLOWANCE = selector('increaseAllowance(address,uint256)');
const SEL_SET_APPROVAL_FOR_ALL = selector('setApprovalForAll(address,bool)');

/**
 * Allowance-granting calldata decode — increaseAllowance, setApprovalForAll
 * and the >= 2^255 unlimited-allowance threshold. Security-sensitive display
 * logic: exhaustive positive/boundary/malformed coverage. The pre-existing
 * transfer/approve/transferFrom behavior is locked by calldataDecode.test.ts,
 * which stays byte-unmodified.
 */

const SPENDER = '1f9090aae28b8a3dceadf281b0f12828e676c326';
const SPENDER_CHECKSUM = '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326';

const USDT_CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7'; // eth registry, 6 decimals
const NFT_CONTRACT = '0x2222222222222222222222222222222222222222';

const pad = (hex: string) => hex.padStart(64, '0');
const amountWord = (value: bigint) => pad(value.toString(16));

const approveData = (spender: string, amount: bigint) =>
  `0x${SEL_APPROVE}${pad(spender)}${amountWord(amount)}`;
const increaseAllowanceData = (spender: string, amount: bigint) =>
  `0x${SEL_INCREASE_ALLOWANCE}${pad(spender)}${amountWord(amount)}`;
const setApprovalForAllData = (operator: string, boolWord: string) =>
  `0x${SEL_SET_APPROVAL_FOR_ALL}${pad(operator)}${boolWord}`;

const TRUE_WORD = pad('1');
const FALSE_WORD = pad('0');

const MAX_UINT256 = (1n << 256n) - 1n;
const THRESHOLD = 1n << 255n; // UNLIMITED_ALLOWANCE_THRESHOLD

describe('decodeErc20Calldata — allowance-granting calls', () => {
  describe('increaseAllowance(address,uint256)', () => {
    it('decodes spender and amount for a known token', () => {
      const result = decodeErc20Calldata(
        increaseAllowanceData(SPENDER, 5_000_000n),
        USDT_CONTRACT,
        'eth',
      );
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('increaseAllowance');
      expect(result?.counterparty).toBe(SPENDER_CHECKSUM);
      expect(result?.amountRaw).toBe('5000000');
      expect(result?.amount).toBe('5');
      expect(result?.tokenSymbol).toBe('USDT');
      expect(result?.unlimited).toBe(false);
      expect(result?.summary).toBe(
        `Increase spender ${SPENDER_CHECKSUM} allowance by 5 USDT`,
      );
    });

    it('returns raw base units for unknown tokens (no guessed decimals)', () => {
      const result = decodeErc20Calldata(
        increaseAllowanceData(SPENDER, 123_456n),
        NFT_CONTRACT,
        'eth',
      );
      expect(result?.amount).toBeUndefined();
      expect(result?.tokenSymbol).toBeUndefined();
      expect(result?.amountRaw).toBe('123456');
    });

    it('flags a max-uint256 increaseAllowance as unlimited', () => {
      const result = decodeErc20Calldata(
        increaseAllowanceData(SPENDER, MAX_UINT256),
        USDT_CONTRACT,
        'eth',
      );
      expect(result?.unlimited).toBe(true);
      expect(result?.amount).toBeUndefined();
    });

    it('rejects truncated increaseAllowance calldata', () => {
      const truncated = `0x${SEL_INCREASE_ALLOWANCE}${pad(SPENDER)}`;
      expect(decodeErc20Calldata(truncated, USDT_CONTRACT, 'eth')).toBeNull();
    });
  });

  describe('unlimited-allowance threshold (>= 2^255)', () => {
    it('flags exactly max-uint256 (the canonical sentinel)', () => {
      expect(
        decodeErc20Calldata(
          approveData(SPENDER, MAX_UINT256),
          USDT_CONTRACT,
          'eth',
        )?.unlimited,
      ).toBe(true);
    });

    it('flags exactly 2^255 (the threshold boundary)', () => {
      expect(
        decodeErc20Calldata(
          approveData(SPENDER, THRESHOLD),
          USDT_CONTRACT,
          'eth',
        )?.unlimited,
      ).toBe(true);
    });

    it('flags a near-max grind value below the sentinel (max - 1)', () => {
      expect(
        decodeErc20Calldata(
          approveData(SPENDER, MAX_UINT256 - 1n),
          USDT_CONTRACT,
          'eth',
        )?.unlimited,
      ).toBe(true);
    });

    it('does not flag 2^255 - 1 (just under the threshold) — still shows the amount', () => {
      const result = decodeErc20Calldata(
        approveData(SPENDER, THRESHOLD - 1n),
        USDT_CONTRACT,
        'eth',
      );
      expect(result?.unlimited).toBe(false);
      expect(result?.amountRaw).toBe((THRESHOLD - 1n).toString());
      expect(result?.amount).toBeDefined();
    });

    it('applies the threshold to increaseAllowance too', () => {
      expect(
        decodeErc20Calldata(
          increaseAllowanceData(SPENDER, THRESHOLD),
          USDT_CONTRACT,
          'eth',
        )?.unlimited,
      ).toBe(true);
      expect(
        decodeErc20Calldata(
          increaseAllowanceData(SPENDER, THRESHOLD - 1n),
          USDT_CONTRACT,
          'eth',
        )?.unlimited,
      ).toBe(false);
    });

    it('keeps the exact-max sentinel for transfers (threshold is allowance-only)', () => {
      const transferData = `0xa9059cbb${pad(SPENDER)}${amountWord(THRESHOLD)}`;
      const result = decodeErc20Calldata(transferData, USDT_CONTRACT, 'eth');
      expect(result?.kind).toBe('transfer');
      expect(result?.unlimited).toBe(false);
    });
  });

  describe('setApprovalForAll(address,bool)', () => {
    it('decodes a grant — operator named, flagged unlimited', () => {
      const result = decodeErc20Calldata(
        setApprovalForAllData(SPENDER, TRUE_WORD),
        NFT_CONTRACT,
        'eth',
      );
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('setApprovalForAll');
      expect(result?.counterparty).toBe(SPENDER_CHECKSUM);
      expect(result?.approved).toBe(true);
      expect(result?.unlimited).toBe(true);
      expect(result?.amountRaw).toBe('1');
      expect(result?.summary).toContain('ALL tokens');
      expect(result?.summary).toContain(SPENDER_CHECKSUM);
    });

    it('decodes a revoke — not flagged unlimited', () => {
      const result = decodeErc20Calldata(
        setApprovalForAllData(SPENDER, FALSE_WORD),
        NFT_CONTRACT,
        'eth',
      );
      expect(result?.approved).toBe(false);
      expect(result?.unlimited).toBe(false);
      expect(result?.amountRaw).toBe('0');
      expect(result?.summary).toContain('Revoke');
    });

    it('never attaches ERC-20 registry metadata (targets are NFT-style contracts)', () => {
      const result = decodeErc20Calldata(
        setApprovalForAllData(SPENDER, TRUE_WORD),
        USDT_CONTRACT, // registry hit for ERC-20 — must still not attach
        'eth',
      );
      expect(result?.tokenSymbol).toBeUndefined();
      expect(result?.tokenDecimals).toBeUndefined();
      expect(result?.amount).toBeUndefined();
    });

    it('fails closed on a non-canonical bool word (value 2)', () => {
      expect(
        decodeErc20Calldata(
          setApprovalForAllData(SPENDER, pad('2')),
          NFT_CONTRACT,
          'eth',
        ),
      ).toBeNull();
    });

    it('fails closed on a dirty-upper-bits bool word', () => {
      const dirtyTrue = `ff${'0'.repeat(61)}1`;
      expect(
        decodeErc20Calldata(
          setApprovalForAllData(SPENDER, dirtyTrue),
          NFT_CONTRACT,
          'eth',
        ),
      ).toBeNull();
    });

    it('fails closed on a non-canonical operator address word', () => {
      const dirtyOperator = `ff${'0'.repeat(22)}${SPENDER}`;
      expect(
        decodeErc20Calldata(
          `0x${SEL_SET_APPROVAL_FOR_ALL}${dirtyOperator}${TRUE_WORD}`,
          NFT_CONTRACT,
          'eth',
        ),
      ).toBeNull();
    });

    it('rejects truncated setApprovalForAll calldata', () => {
      expect(
        decodeErc20Calldata(
          `0x${SEL_SET_APPROVAL_FOR_ALL}${pad(SPENDER)}`,
          NFT_CONTRACT,
          'eth',
        ),
      ).toBeNull();
      expect(
        decodeErc20Calldata(
          `0x${SEL_SET_APPROVAL_FOR_ALL}`,
          NFT_CONTRACT,
          'eth',
        ),
      ).toBeNull();
    });

    it('rejects extra trailing bytes', () => {
      expect(
        decodeErc20Calldata(
          `${setApprovalForAllData(SPENDER, TRUE_WORD)}00`,
          NFT_CONTRACT,
          'eth',
        ),
      ).toBeNull();
    });
  });

  describe('robustness of the new selectors', () => {
    it('never throws on garbage inputs', () => {
      const garbage = [
        `0x${SEL_INCREASE_ALLOWANCE}`,
        `0x${SEL_SET_APPROVAL_FOR_ALL}`,
        `0x${SEL_INCREASE_ALLOWANCE}00`,
        `0x${SEL_SET_APPROVAL_FOR_ALL}zznothex`,
        `0x${SEL_INCREASE_ALLOWANCE}${'f'.repeat(128)}`, // non-canonical address padding
      ];
      for (const input of garbage) {
        expect(() =>
          decodeErc20Calldata(input, USDT_CONTRACT, 'eth'),
        ).not.toThrow();
      }
    });

    it('still returns null for unknown selectors (untouched fallback)', () => {
      const data = `0xdeadbeef${pad(SPENDER)}${amountWord(1n)}`;
      expect(decodeErc20Calldata(data, USDT_CONTRACT, 'eth')).toBeNull();
    });
  });
});
