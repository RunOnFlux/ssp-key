import axios from 'axios';
import { createMMKV } from 'react-native-mmkv';
import { sspConfig } from '@storage/ssp';

interface RelayRates {
  fiat: Record<string, number>;
  crypto: Record<string, number>;
}

// 5-minute freshness — rates are display data plus a USD ceiling on the fee
// cap, no need to re-fetch on every decode.
const RATES_TTL_MS = 5 * 60 * 1000;
// A last-known rate older than this is not used at all.
const RATES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// How long the fee-cap check waits for a fresh rate before using the
// last-known one (or none: the per-chain hard cap alone).
const CAP_RATE_WAIT_MS = 1500;

const RATES_STORE_KEY = 'relayRates';

const ratesCache: { data: RelayRates | null; fetchedAt: number } = {
  data: null,
  fetchedAt: 0,
};
let persistedLoaded = false;
let inflight: Promise<RelayRates | null> | null = null;

let rateStore: ReturnType<typeof createMMKV> | null = null;
const store = () => {
  if (!rateStore) {
    rateStore = createMMKV({ id: 'ssp-relay-rates' });
  }
  return rateStore;
};

function isRelayRates(value: unknown): value is RelayRates {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as RelayRates).crypto === 'object' &&
    (value as RelayRates).crypto !== null
  );
}

/** Seed the in-memory cache from the last rates saved on this device. */
function loadPersistedRates(): void {
  if (persistedLoaded) {
    return;
  }
  persistedLoaded = true;
  try {
    const raw = store().getString(RATES_STORE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as { data?: unknown; fetchedAt?: unknown };
    if (
      isRelayRates(parsed.data) &&
      typeof parsed.fetchedAt === 'number' &&
      parsed.fetchedAt > ratesCache.fetchedAt
    ) {
      ratesCache.data = parsed.data;
      ratesCache.fetchedAt = parsed.fetchedAt;
    }
  } catch (error) {
    console.log(error);
  }
}

function rateFrom(data: RelayRates | null, chain: string): number {
  const rate = data?.crypto[chain];
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0
    ? rate
    : 0;
}

function isFresh(now: number): boolean {
  return !!ratesCache.data && now - ratesCache.fetchedAt < RATES_TTL_MS;
}

/** Last-known rate if not older than RATES_MAX_AGE_MS, else 0. */
function lastKnownRate(chain: string): number {
  if (
    !ratesCache.data ||
    Date.now() - ratesCache.fetchedAt >= RATES_MAX_AGE_MS
  ) {
    return 0;
  }
  return rateFrom(ratesCache.data, chain);
}

/**
 * One GET /v1/rates at a time: every caller that needs fresh rates while a
 * request is in flight shares it. Resolves null on any failure; never throws.
 */
function fetchRates(): Promise<RelayRates | null> {
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    try {
      const response = await axios.get<RelayRates>(
        `https://${sspConfig().relay}/v1/rates`,
        { timeout: 10000 },
      );
      if (!isRelayRates(response.data)) {
        return null;
      }
      ratesCache.data = response.data;
      ratesCache.fetchedAt = Date.now();
      try {
        store().set(
          RATES_STORE_KEY,
          JSON.stringify({
            data: ratesCache.data,
            fetchedAt: ratesCache.fetchedAt,
          }),
        );
      } catch (error) {
        console.log(error);
      }
      return response.data;
    } catch (error) {
      console.log(error);
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Start fetching rates if they are stale, without waiting. Called when a
 * request arrives so the price is usually ready by the time it is needed.
 */
export function prefetchRates(): void {
  loadPersistedRates();
  if (!isFresh(Date.now())) {
    void fetchRates();
  }
}

/**
 * Fetch the USD price for a chain's native asset from the public relay
 * GET /v1/rates endpoint. Crypto rates are keyed by lowercase chain id
 * (btc, flux, eth, sol, ...) — testnet chains have no rate and resolve to 0.
 * When the relay cannot be reached, a last-known rate up to a day old is
 * used.
 *
 * NEVER throws — returns 0 on any error (unknown chain, network failure,
 * malformed response). USD display is decorative and must never block or
 * fail an approval.
 */
export async function getCryptoUsdRate(chain: string): Promise<number> {
  loadPersistedRates();
  if (isFresh(Date.now())) {
    return rateFrom(ratesCache.data, chain);
  }
  const data = await fetchRates();
  return data ? rateFrom(data, chain) : lastKnownRate(chain);
}

/**
 * USD price for the fee cap's USD ceiling, without holding up the approval.
 * Uses fresh rates when available; otherwise waits at most `maxWaitMs` for
 * the relay and then falls back to the last-known rate (up to a day old), or
 * 0 — with 0 the fee is checked against the per-chain hard cap alone, as it
 * always was when the relay could not be reached. Never throws.
 */
export async function getCryptoUsdRateForCap(
  chain: string,
  maxWaitMs: number = CAP_RATE_WAIT_MS,
): Promise<number> {
  loadPersistedRates();
  if (isFresh(Date.now())) {
    return rateFrom(ratesCache.data, chain);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), maxWaitMs);
  });
  const data = await Promise.race([fetchRates(), timedOut]);
  if (timer) {
    clearTimeout(timer);
  }
  return data ? rateFrom(data, chain) : lastKnownRate(chain);
}

/** Drop cached and persisted rates (tests). */
export function clearRatesCache(): void {
  ratesCache.data = null;
  ratesCache.fetchedAt = 0;
  persistedLoaded = false;
  inflight = null;
  try {
    store().remove(RATES_STORE_KEY);
  } catch {
    // nothing persisted
  }
}

/**
 * Format a USD value with thousands separators and exactly 2 decimals.
 * Formatted by hand rather than via toLocaleString: on Hermes builds where
 * Intl data is unavailable the locale options are silently ignored and the
 * raw float (with its full decimal tail) leaks onto the approval screen.
 */
export function formatUsdAmount(value: number): string {
  const fixed = value.toFixed(2);
  const [whole, frac] = fixed.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`;
}
