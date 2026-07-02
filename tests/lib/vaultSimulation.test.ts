import {
  parseProposalSimulation,
  sortWarnings,
  serverRecipientsFromSimulation,
  detectDecodeMismatch,
  ProposalSimulation,
  SimWarning,
} from '../../src/lib/vaultSimulation';
import type { VaultDecodedTx } from '../../src/lib/transactions';

const RECIPIENT = '0xAbCdEf0123456789abcdef0123456789ABCDEF01';
const OTHER = '0x1111111111111111111111111111111111111111';

function makeSimulation(
  overrides: Partial<ProposalSimulation> = {},
): ProposalSimulation {
  return {
    status: 'ok',
    balanceChanges: [],
    warnings: [],
    ...overrides,
  };
}

function makeDecoded(overrides: Partial<VaultDecodedTx> = {}): VaultDecodedTx {
  return {
    sender: '0xsender',
    recipients: [{ address: RECIPIENT, amount: '1000000' }],
    fee: '0',
    ...overrides,
  };
}

describe('parseProposalSimulation', () => {
  test('returns null for null/undefined', () => {
    expect(parseProposalSimulation(null)).toBeNull();
    expect(parseProposalSimulation(undefined)).toBeNull();
  });

  test('parses a JSON string payload', () => {
    const sim = makeSimulation({ provider: 'tenderly' });
    const parsed = parseProposalSimulation(JSON.stringify(sim));
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe('ok');
    expect(parsed?.provider).toBe('tenderly');
  });

  test('returns null on a malformed JSON string', () => {
    expect(parseProposalSimulation('{not json')).toBeNull();
  });

  test('returns null when status is invalid or missing', () => {
    expect(
      parseProposalSimulation({
        status: 'bogus',
      } as unknown as ProposalSimulation),
    ).toBeNull();
    expect(
      parseProposalSimulation({} as unknown as ProposalSimulation),
    ).toBeNull();
  });

  test('returns null on non-object payloads', () => {
    expect(parseProposalSimulation('"just a string"')).toBeNull();
    expect(parseProposalSimulation('42')).toBeNull();
  });

  test('defaults balanceChanges/warnings to arrays when absent', () => {
    const parsed = parseProposalSimulation({
      status: 'unavailable',
    } as ProposalSimulation);
    expect(parsed?.balanceChanges).toEqual([]);
    expect(parsed?.warnings).toEqual([]);
  });
});

describe('sortWarnings', () => {
  test('sorts critical → high → medium → info without mutating input', () => {
    const warnings: SimWarning[] = [
      { code: 'NEW_RECIPIENT', severity: 'info', message: 'i' },
      { code: 'UNVERIFIED_CONTRACT', severity: 'medium', message: 'm' },
      { code: 'UNLIMITED_APPROVAL', severity: 'critical', message: 'c' },
      { code: 'SIMULATION_REVERTED', severity: 'high', message: 'h' },
    ];
    const sorted = sortWarnings(warnings);
    expect(sorted.map((w) => w.severity)).toEqual([
      'critical',
      'high',
      'medium',
      'info',
    ]);
    // original untouched
    expect(warnings[0].severity).toBe('info');
  });
});

describe('serverRecipientsFromSimulation', () => {
  test('returns empty when there is no decodedCall (UTXO/native providers)', () => {
    expect(serverRecipientsFromSimulation(makeSimulation())).toEqual([]);
  });

  test('projects transfer recipient + base-unit amount', () => {
    const sim = makeSimulation({
      decodedCall: {
        method: 'transfer',
        args: { recipient: RECIPIENT, amount: '1000000' },
      },
    });
    expect(serverRecipientsFromSimulation(sim)).toEqual([
      { address: RECIPIENT.toLowerCase(), amount: 1000000n },
    ]);
  });

  test('projects approve() spender as the grant recipient', () => {
    const sim = makeSimulation({
      decodedCall: { method: 'approve', args: { spender: OTHER, amount: '5' } },
    });
    expect(serverRecipientsFromSimulation(sim)).toEqual([
      { address: OTHER.toLowerCase(), amount: 5n },
    ]);
  });

  test('projects setApprovalForAll() operator with null amount', () => {
    const sim = makeSimulation({
      decodedCall: { method: 'setApprovalForAll', args: { operator: OTHER } },
    });
    expect(serverRecipientsFromSimulation(sim)).toEqual([
      { address: OTHER.toLowerCase(), amount: null },
    ]);
  });

  test('non-integer amount projects as null (not comparable)', () => {
    const sim = makeSimulation({
      decodedCall: {
        method: 'transfer',
        args: { recipient: RECIPIENT, amount: '1.5' },
      },
    });
    expect(serverRecipientsFromSimulation(sim)).toEqual([
      { address: RECIPIENT.toLowerCase(), amount: null },
    ]);
  });
});

describe('detectDecodeMismatch', () => {
  test('no mismatch when simulation is absent or pending/unavailable', () => {
    expect(detectDecodeMismatch(undefined, makeDecoded()).mismatch).toBe(false);
    expect(
      detectDecodeMismatch(makeSimulation({ status: 'pending' }), makeDecoded())
        .mismatch,
    ).toBe(false);
    expect(
      detectDecodeMismatch(
        makeSimulation({ status: 'unavailable' }),
        makeDecoded(),
      ).mismatch,
    ).toBe(false);
  });

  test('no mismatch when the device decode is missing or errored', () => {
    const sim = makeSimulation({
      decodedCall: {
        method: 'transfer',
        args: { recipient: OTHER, amount: '1' },
      },
    });
    expect(detectDecodeMismatch(sim, null).mismatch).toBe(false);
    expect(
      detectDecodeMismatch(sim, makeDecoded({ error: 'decode failed' }))
        .mismatch,
    ).toBe(false);
  });

  test('no mismatch when the server projects no recipients', () => {
    expect(detectDecodeMismatch(makeSimulation(), makeDecoded()).mismatch).toBe(
      false,
    );
  });

  test('mismatch when a server recipient is absent from the device decode', () => {
    const sim = makeSimulation({
      decodedCall: {
        method: 'transfer',
        args: { recipient: OTHER, amount: '1000000' },
      },
    });
    const result = detectDecodeMismatch(sim, makeDecoded());
    expect(result.mismatch).toBe(true);
    expect(result.reason).toContain(OTHER.toLowerCase());
  });

  test('mismatch on base-unit amount divergence for a matched recipient', () => {
    const sim = makeSimulation({
      decodedCall: {
        method: 'transfer',
        args: { recipient: RECIPIENT, amount: '2000000' },
      },
    });
    const result = detectDecodeMismatch(sim, makeDecoded());
    expect(result.mismatch).toBe(true);
    expect(result.reason).toContain('differs');
  });

  test('compares on reverted simulations too (lying relay)', () => {
    const sim = makeSimulation({
      status: 'reverted',
      decodedCall: {
        method: 'transfer',
        args: { recipient: OTHER, amount: '1000000' },
      },
    });
    expect(detectDecodeMismatch(sim, makeDecoded()).mismatch).toBe(true);
  });

  test('skips amount comparison when the device amount is not base-unit integer', () => {
    const sim = makeSimulation({
      decodedCall: {
        method: 'transfer',
        args: { recipient: RECIPIENT, amount: '2000000' },
      },
    });
    const decoded = makeDecoded({
      recipients: [{ address: RECIPIENT, amount: '1.5' }],
    });
    expect(detectDecodeMismatch(sim, decoded).mismatch).toBe(false);
  });

  test('no mismatch when recipient and amount both match (case-insensitive)', () => {
    const sim = makeSimulation({
      decodedCall: {
        method: 'transfer',
        args: {
          recipient: RECIPIENT.toUpperCase().replace('0X', '0x'),
          amount: '1000000',
        },
      },
    });
    expect(detectDecodeMismatch(sim, makeDecoded()).mismatch).toBe(false);
  });
});
