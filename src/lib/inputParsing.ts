import { cryptos } from '../types';

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

// Splits a `chain:wallet:data` / `chain:data` / `data` input into its
// parts. Exact logic the manual-input and QR-scan handlers in Home.tsx
// both used inline (they were verbatim-identical copies).
export function splitSSPInput(
  input: string,
  defaultChain: keyof cryptos,
): { chain: keyof cryptos; wallet: string; dataToProcess: string } {
  const splittedInput = input.split(':');
  let chain: keyof cryptos = defaultChain;
  let wallet = '0-0';
  let dataToProcess = '';
  if (splittedInput[1]) {
    // all is default
    chain = splittedInput[0] as keyof cryptos;
    if (splittedInput[1].includes('-')) {
      // wallet specifiedd
      wallet = splittedInput[1];
      dataToProcess = splittedInput[2];
    } else {
      // wallet default
      dataToProcess = splittedInput[1];
    }
  } else {
    // only data
    dataToProcess = splittedInput[0];
  }
  return { chain, wallet, dataToProcess };
}
