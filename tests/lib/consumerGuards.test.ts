import { hashMessage, solidityPackedKeccak256 } from 'ethers';
import {
  assertEvmCallSafe,
  buildEip191Preimage,
  CONSUMER_MAX_FEE_USD,
  hasEvmCalldata,
  maxConsumerFee,
  parseConsumerDerivationPath,
  parseEip191Preimage,
  SELECTOR_UPGRADE_TO,
  SELECTOR_UPGRADE_TO_AND_CALL,
} from '../../src/lib/consumerGuards';

describe('parseConsumerDerivationPath (KEY-8)', () => {
  it('accepts the receive and change branches', () => {
    expect(parseConsumerDerivationPath('0-0')).toEqual({
      typeIndex: 0,
      addressIndex: 0,
    });
    expect(parseConsumerDerivationPath('1-17')).toEqual({
      typeIndex: 1,
      addressIndex: 17,
    });
  });

  it.each(['10-0', '11-0', '12-0', '2-0', '99-1'])(
    'refuses the non-consumer branch %s',
    (path) => {
      expect(() => parseConsumerDerivationPath(path)).toThrow(
        /not a consumer spending branch/,
      );
    },
  );

  it.each(['', '0', '0-', '-1-0', '0--1', '0-1-2', '0-1.5', ' 0-1', 'a-b'])(
    'refuses the malformed path %p',
    (path) => {
      expect(() => parseConsumerDerivationPath(path)).toThrow();
    },
  );

  it('refuses hardened / out-of-range address indices and non-strings', () => {
    expect(() => parseConsumerDerivationPath('0-2147483648')).toThrow(
      /address index/,
    );
    expect(() => parseConsumerDerivationPath(undefined)).toThrow();
    expect(() => parseConsumerDerivationPath(['0', '0'])).toThrow();
  });
});

describe('maxConsumerFee', () => {
  it('uses the chain hard cap when no rate is known', () => {
    expect(maxConsumerFee(1000000, 8, 0).toFixed()).toBe('1000000');
    expect(maxConsumerFee(1000000, 8, undefined).toFixed()).toBe('1000000');
    expect(maxConsumerFee(1000000, 8, NaN).toFixed()).toBe('1000000');
  });

  it('takes the lower of the hard cap and the USD cap', () => {
    // $100 at $100,000/BTC = 0.001 BTC = 100,000 sats
    expect(maxConsumerFee(1000000, 8, 100000).toFixed()).toBe('100000');
    // a cheap asset: the USD cap is above the hard cap, the hard cap wins
    expect(maxConsumerFee(1000000, 8, 1).toFixed()).toBe('1000000');
    expect(CONSUMER_MAX_FEE_USD).toBe(100);
  });
});

describe('EVM call-safety rules (C-4 / EVM-1 / AA-5)', () => {
  const account = '0x1111111111111111111111111111111111111111';
  const other = '0x2222222222222222222222222222222222222222';

  it('treats any non-empty calldata as a contract call', () => {
    expect(hasEvmCalldata('0x')).toBe(false);
    expect(hasEvmCalldata('')).toBe(false);
    expect(hasEvmCalldata('0x00')).toBe(true);
    expect(hasEvmCalldata('0xa9059cbb')).toBe(true);
  });

  it('refuses a call whose target is the account itself', () => {
    expect(() =>
      assertEvmCallSafe({ target: account.toUpperCase(), data: '0x' }, account),
    ).toThrow(/self-call/);
  });

  it('refuses the UUPS upgrade selectors to any target', () => {
    expect(() =>
      assertEvmCallSafe(
        { target: other, data: `${SELECTOR_UPGRADE_TO_AND_CALL}00` },
        account,
      ),
    ).toThrow(/upgradeToAndCall/);
    expect(() =>
      assertEvmCallSafe(
        { target: other, data: SELECTOR_UPGRADE_TO.toUpperCase() + '00' },
        account,
      ),
    ).toThrow(/upgradeTo/);
  });

  it('accepts ordinary calls', () => {
    expect(() =>
      assertEvmCallSafe({ target: other, data: '0xa9059cbb' }, account),
    ).not.toThrow();
    expect(() =>
      assertEvmCallSafe({ target: other, data: '0x' }, account),
    ).not.toThrow();
  });
});

describe('EIP-191 personal messages (AA-2)', () => {
  const sdkDigest = (preimage: string) =>
    // The Schnorr SDK's _hashMessage
    solidityPackedKeccak256(['string'], [preimage]);

  it.each([
    'Sign in to example.com',
    '',
    '123 starts with digits',
    '0',
    'émoji 🚀 and 中文',
    'x'.repeat(250),
  ])('round-trips %p and matches hashMessage', (text) => {
    const preimage = buildEip191Preimage(text);
    expect(parseEip191Preimage(preimage)).toBe(text);
    expect(sdkDigest(preimage)).toBe(hashMessage(text));
  });

  it('refuses a raw string (eth_sign) and typed-data JSON', () => {
    expect(() => parseEip191Preimage('hello')).toThrow(/EIP-191/);
    expect(() =>
      parseEip191Preimage(JSON.stringify({ primaryType: 'Permit' })),
    ).toThrow(/EIP-191/);
  });

  it('refuses an EIP-712 "\\x19\\x01" preimage disguised as a message', () => {
    const domainSeparator = 'a'.repeat(32);
    const structHash = 'b'.repeat(32);
    expect(() =>
      parseEip191Preimage(`\x19\x01${domainSeparator}${structHash}`),
    ).toThrow();
  });

  it('refuses a wrong or non-canonical length prefix', () => {
    const prefix = '\x19Ethereum Signed Message:\n';
    expect(() => parseEip191Preimage(`${prefix}5hello!`)).toThrow();
    expect(() => parseEip191Preimage(`${prefix}05hello`)).toThrow();
    expect(() => parseEip191Preimage(`${prefix}hello`)).toThrow();
    // UTF-16 length instead of UTF-8 byte length
    expect(() => parseEip191Preimage(`${prefix}1é`)).toThrow();
    expect(parseEip191Preimage(`${prefix}2é`)).toBe('é');
  });

  it('refuses lone surrogates (no UTF-8 encoding)', () => {
    expect(() => buildEip191Preimage('\uD800')).toThrow(/UTF-8/);
  });
});
