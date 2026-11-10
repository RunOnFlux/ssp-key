import { cryptos } from '../types';

// Same literal as lib/kaspa.ts KAS_BUNDLE_FORMAT; kept local so this pure
// parsing module does not pull in the Kaspa library and chain registry.
const KAS_BUNDLE_FORMAT = 'kaspa-core-signing-bundle';

// Pure helpers for classifying and splitting scanned / manually entered
// SSP input. Relocated verbatim from src/screens/Home/Home.tsx.

export const xpubRegex = /^([a-zA-Z]{2}ub[1-9A-HJ-NP-Za-km-z]{79,140})$/; // xpub start is the most usual, but can also be Ltub

// Solana repurposes the "xpub" field as a JSON-stringified array of 20
// base58-encoded Ed25519 leaf pubkeys. Accept that format too in sync
// QR / manual input. Each HD slot derives a distinct leaf so the array
// must have 20 unique entries — duplicates indicate a malformed input.
export function isSolanaPubkeyArrayString(input: string): boolean {
  try {
    const arr = JSON.parse(input.trim());
    if (!Array.isArray(arr) || arr.length !== 20) return false;
    const base58Pk = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const seen = new Set<string>();
    for (const pk of arr) {
      if (typeof pk !== 'string' || !base58Pk.test(pk)) return false;
      if (seen.has(pk)) return false;
      seen.add(pk);
    }
    return true;
  } catch {
    return false;
  }
}

export function looksLikeXpub(input: string): boolean {
  return xpubRegex.test(input) || isSolanaPubkeyArrayString(input);
}

// A wallet segment is always `typeIndex-addressIndex` (both numeric, see
// generateAddressDetailsForSending). Anything else in that position is the
// first segment of the payload itself, not a wallet specifier.
const walletSegmentRegex = /^\d+-\d+$/;

// Splits a `chain:wallet:data` / `chain:data` / `data` input into its
// parts. Exact logic the manual-input and QR-scan handlers in Home.tsx
// both used inline (they were verbatim-identical copies).
// The payload may itself contain colons — EVM operations arrive as
// JSON-stringified userOps — so the tail is always rejoined in full.
export function splitSSPInput(
  input: string,
  defaultChain: keyof cryptos,
): { chain: keyof cryptos; wallet: string; dataToProcess: string } {
  // A bare Kaspa SigningBundle (JSON, full of colons) carries no chain
  // prefix of its own: route it to `kas` at the DEFAULT vault path 0-0. The
  // path is never guessed from the bundle (the vault must be derived from
  // this device's xpubs + a path the user/wallet named, contract §4.1). A
  // bare bundle that spends another vault address therefore fails CLOSED in
  // the approval decode with a clear "different vault address" error
  // (transactions.ts KasWrongVaultError → home:err_kas_wrong_vault). The
  // relay is the primary transport for Kaspa; `kas:0-1:{…}` selects any
  // other path through the normal split below.
  const trimmed = input.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { format?: unknown };
      if (parsed && parsed.format === KAS_BUNDLE_FORMAT) {
        return { chain: 'kas', wallet: '0-0', dataToProcess: trimmed };
      }
    } catch {
      // not JSON — fall through
    }
  }
  const splittedInput = input.split(':');
  let chain: keyof cryptos = defaultChain;
  let wallet = '0-0';
  let dataToProcess = '';
  if (splittedInput[1]) {
    // all is default
    chain = splittedInput[0] as keyof cryptos;
    if (walletSegmentRegex.test(splittedInput[1])) {
      // wallet specified
      wallet = splittedInput[1];
      dataToProcess = splittedInput.slice(2).join(':');
    } else {
      // wallet default
      dataToProcess = splittedInput.slice(1).join(':');
    }
  } else {
    // only data
    dataToProcess = splittedInput[0];
  }
  return { chain, wallet, dataToProcess };
}
