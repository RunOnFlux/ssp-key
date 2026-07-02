import axios from 'axios';
import { sspConfig } from '@storage/ssp';

interface RelayRates {
  fiat: Record<string, number>;
  crypto: Record<string, number>;
}

// 5-minute in-memory cache — rates are decorative data on a signing screen,
// no need to re-fetch on every decode.
const RATES_TTL_MS = 5 * 60 * 1000;

const ratesCache: { data: RelayRates | null; fetchedAt: number } = {
  data: null,
  fetchedAt: 0,
};

/**
 * Fetch the USD price for a chain's native asset from the public relay
 * GET /v1/rates endpoint. Crypto rates are keyed by lowercase chain id
 * (btc, flux, eth, sol, ...) — testnet chains have no rate and resolve to 0.
 *
 * NEVER throws — returns 0 on any error (unknown chain, network failure,
 * malformed response). USD display is decorative and must never block or
 * fail an approval.
 */
export async function getCryptoUsdRate(chain: string): Promise<number> {
  try {
    const now = Date.now();
    if (ratesCache.data && now - ratesCache.fetchedAt < RATES_TTL_MS) {
      return ratesCache.data.crypto[chain] ?? 0;
    }
    const response = await axios.get<RelayRates>(
      `https://${sspConfig().relay}/v1/rates`,
      { timeout: 10000 },
    );
    if (!response.data || typeof response.data.crypto !== 'object') {
      return 0;
    }
    ratesCache.data = response.data;
    ratesCache.fetchedAt = now;
    return response.data.crypto[chain] ?? 0;
  } catch (error) {
    console.log(error);
    return 0;
  }
}

/** Format a USD value with thousands separators and exactly 2 decimals. */
export function formatUsdAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
