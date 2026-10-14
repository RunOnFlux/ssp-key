import {
  splitAddressForDisplay,
  truncateAddress,
} from '../../src/lib/addressDisplay';

describe('addressDisplay', () => {
  const EVM = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
  const BTC = 'bc1q9yz03culh5cwqqxjyxhpi7d2wsc4d94xkq0j2n';

  describe('splitAddressForDisplay', () => {
    it('emphasizes first and last 6 characters of an EVM address', () => {
      const parts = splitAddressForDisplay(EVM);
      expect(parts.start).toBe('0x8ba1');
      expect(parts.end).toBe('4DBA72');
      expect(parts.start + parts.middle + parts.end).toBe(EVM);
    });

    it('reassembles losslessly for any address format', () => {
      for (const address of [EVM, BTC, 'FLuxAddressExample123456789']) {
        const parts = splitAddressForDisplay(address);
        expect(parts.start + parts.middle + parts.end).toBe(address);
      }
    });

    it('does not fake-truncate short strings', () => {
      const parts = splitAddressForDisplay('0x1234abcd');
      expect(parts).toEqual({ start: '0x1234abcd', middle: '', end: '' });
    });

    it('handles empty input', () => {
      expect(splitAddressForDisplay('')).toEqual({
        start: '',
        middle: '',
        end: '',
      });
    });

    it('trims surrounding whitespace', () => {
      const parts = splitAddressForDisplay(`  ${EVM}  `);
      expect(parts.start + parts.middle + parts.end).toBe(EVM);
    });
  });

  describe('truncateAddress', () => {
    it('produces the compact ellipsis form', () => {
      expect(truncateAddress(EVM)).toBe('0x8ba1…4DBA72');
    });

    it('returns short strings unchanged', () => {
      expect(truncateAddress('short')).toBe('short');
    });
  });
});

describe('addressDisplay (prefixed addresses)', () => {
  const KAS_ADDRESS =
    'kaspa:prfu8rp4ek453lkhcewmn7w9acdqms9q2pegav5vhx6zscu73xh4ux2mdv2wp';

  it('emphasizes 6 characters after the network prefix', () => {
    const parts = splitAddressForDisplay(KAS_ADDRESS);
    expect(parts.start).toBe('kaspa:prfu8r');
    expect(parts.end).toBe('mdv2wp');
    expect(parts.start + parts.middle + parts.end).toBe(KAS_ADDRESS);
    expect(truncateAddress(KAS_ADDRESS)).toBe('kaspa:prfu8r…mdv2wp');
  });
});
