import { explorerAddressUrl, explorerTxUrl } from '../../src/lib/explorerUrl';

describe('explorerUrl', () => {
  it('uses explorer.kaspa.org plural paths for Kaspa', () => {
    expect(explorerTxUrl('kas', 'ab'.repeat(32))).toBe(
      `https://explorer.kaspa.org/txs/${'ab'.repeat(32)}`,
    );
    expect(explorerAddressUrl('kas', 'kaspa:pzk5xpfj')).toBe(
      'https://explorer.kaspa.org/addresses/kaspa:pzk5xpfj',
    );
  });

  it('keeps the singular paths elsewhere', () => {
    expect(explorerTxUrl('eth', '0x1')).toBe('https://etherscan.io/tx/0x1');
    expect(explorerTxUrl('solDevnet', 'sig')).toBe(
      'https://explorer.solana.com/tx/sig?cluster=devnet',
    );
  });
});

describe('explorerUrl (tron)', () => {
  it('uses tronscan hash routes', () => {
    expect(explorerTxUrl('tron', 'ab'.repeat(32))).toBe(
      `https://tronscan.org/#/transaction/${'ab'.repeat(32)}`,
    );
    expect(
      explorerAddressUrl('tron', 'TWq9eJbomJDmkME7ahC4renGL2BXacL2vd'),
    ).toBe('https://tronscan.org/#/address/TWq9eJbomJDmkME7ahC4renGL2BXacL2vd');
    expect(explorerTxUrl('tronNile', 'cd')).toBe(
      'https://nile.tronscan.org/#/transaction/cd',
    );
  });
});
