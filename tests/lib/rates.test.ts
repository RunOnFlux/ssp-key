// Mock axios before importing the module under test
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

// Mock storage config so the test does not pull in mmkv/redux store
jest.mock('../../src/storage/ssp', () => ({
  sspConfig: () => ({ relay: 'relay.sspwallet.io' }),
}));

import axios from 'axios';
import { getCryptoUsdRate, formatUsdAmount } from '../../src/lib/rates';

const mockedGet = axios.get as jest.Mock;

describe('rates', () => {
  describe('getCryptoUsdRate', () => {
    // NOTE: tests share the module-level rates cache and are order-dependent
    // by design (the cache behaviour is part of what is under test).
    test('returns the crypto rate for a known chain from the relay', async () => {
      mockedGet.mockResolvedValue({
        data: { fiat: { USD: 1 }, crypto: { btc: 65000 } },
      });
      const rate = await getCryptoUsdRate('btc');
      expect(rate).toBe(65000);
      expect(mockedGet).toHaveBeenCalledTimes(1);
      expect(mockedGet).toHaveBeenCalledWith(
        'https://relay.sspwallet.io/v1/rates',
        { timeout: 10000 },
      );
    });

    test('serves a second call within the TTL from cache (no re-fetch)', async () => {
      const rate = await getCryptoUsdRate('btc');
      expect(rate).toBe(65000);
      expect(mockedGet).toHaveBeenCalledTimes(1);
    });

    test('returns 0 for an unknown chain', async () => {
      const rate = await getCryptoUsdRate('unknownchain');
      expect(rate).toBe(0);
    });

    test('returns 0 instead of throwing when the network request fails', async () => {
      // Expire the cache by moving time forward past the 5-minute TTL
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + 6 * 60 * 1000);
      mockedGet.mockRejectedValue(new Error('network down'));
      const rate = await getCryptoUsdRate('btc');
      expect(rate).toBe(0);
      nowSpy.mockRestore();
    });

    test('returns 0 on a malformed response (missing crypto map)', async () => {
      const nowSpy = jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + 12 * 60 * 1000);
      mockedGet.mockResolvedValue({ data: { fiat: { USD: 1 } } });
      const rate = await getCryptoUsdRate('btc');
      expect(rate).toBe(0);
      nowSpy.mockRestore();
    });
  });

  describe('formatUsdAmount', () => {
    test('formats with thousands separators and 2 decimals', () => {
      expect(formatUsdAmount(1234.5)).toBe('1,234.50');
    });

    test('rounds to 2 decimals', () => {
      expect(formatUsdAmount(0.005)).toBe('0.01');
      expect(formatUsdAmount(1000000)).toBe('1,000,000.00');
    });
  });
});
