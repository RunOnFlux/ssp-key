import { identiconData, IDENTICON_GRID } from '../../src/lib/identicon';

const CELL_COUNT = IDENTICON_GRID * IDENTICON_GRID;

describe('identiconData', () => {
  it('is deterministic — same identity, same pattern and color', () => {
    const a = identiconData('0x8ba1f109551bD432803012645Ac136ddd64DBA72');
    const b = identiconData('0x8ba1f109551bD432803012645Ac136ddd64DBA72');
    expect(a.cells).toEqual(b.cells);
    expect(a.color).toBe(b.color);
  });

  it('normalizes case and whitespace (checksummed == lowercased address)', () => {
    const mixed = identiconData('0x8ba1f109551bD432803012645Ac136ddd64DBA72');
    const lower = identiconData(' 0x8ba1f109551bd432803012645ac136ddd64dba72 ');
    expect(mixed.cells).toEqual(lower.cells);
    expect(mixed.color).toBe(lower.color);
  });

  it('produces different patterns for different identities', () => {
    const a = identiconData('0x8ba1f109551bD432803012645Ac136ddd64DBA72');
    const b = identiconData('0x8ba1f109551bD432803012645Ac136ddd64DBA73');
    expect(a.cells).not.toEqual(b.cells);
  });

  it('always returns a full 5x5 grid', () => {
    const { cells } = identiconData('bc1qexampleaddress');
    expect(cells).toHaveLength(CELL_COUNT);
  });

  it('is horizontally symmetric for arbitrary inputs', () => {
    const inputs = [
      '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
      'bc1q9yz03culh5cwqqxjyxhpi7d2wsc4d94xkq0j2n',
      'FLuxLongAddressExample1234567890',
      'x',
      '',
    ];
    for (const input of inputs) {
      const { cells } = identiconData(input);
      for (let row = 0; row < IDENTICON_GRID; row += 1) {
        for (let col = 0; col < IDENTICON_GRID; col += 1) {
          const mirrored = IDENTICON_GRID - 1 - col;
          expect(cells[row * IDENTICON_GRID + col]).toBe(
            cells[row * IDENTICON_GRID + mirrored],
          );
        }
      }
    }
  });

  it('never renders a fully blank grid', () => {
    const inputs = ['', 'a', '0', 'test', '0x0'];
    for (const input of inputs) {
      const { cells } = identiconData(input);
      expect(cells.some((cell) => cell)).toBe(true);
    }
  });

  it('returns a valid hsl color with hue in [0, 360)', () => {
    const { color } = identiconData('0xabc');
    const match = /^hsl\((\d+), 62%, 52%\)$/.exec(color);
    expect(match).not.toBeNull();
    const hue = Number(match?.[1]);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});
