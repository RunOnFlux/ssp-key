import axios, { AxiosError } from 'axios';
import type { AxiosResponse } from 'axios';
import {
  broadcastTx,
  BroadcastRejectedError,
  getBroadcastRejectReason,
} from '../../src/lib/constructTx';

function httpError(status: number, data: unknown): AxiosError {
  return new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
    undefined,
    undefined,
    { status, data, statusText: '', headers: {}, config: {} } as AxiosResponse,
  );
}

describe('broadcast reject reasons', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('insight (Flux): the 400 body becomes the reason', async () => {
    jest
      .spyOn(axios, 'post')
      .mockRejectedValue(
        httpError(400, '64: bad-txns-too-many-sigops. Code:-26'),
      );
    const failure = broadcastTx('00', 'flux');
    await expect(failure).rejects.toBeInstanceOf(BroadcastRejectedError);
    await expect(failure).rejects.toMatchObject({
      reason: '64: bad-txns-too-many-sigops. Code:-26',
    });
  });

  it('blockbook: the { error } field becomes the reason', async () => {
    jest
      .spyOn(axios, 'post')
      .mockRejectedValue(
        httpError(400, { error: '-26: min relay fee not met' }),
      );
    await expect(broadcastTx('00', 'btc')).rejects.toMatchObject({
      name: 'BroadcastRejectedError',
      reason: '-26: min relay fee not met',
    });
  });

  it('keeps the original error when there is no node reason', async () => {
    const proxyPage = httpError(502, '<!DOCTYPE html><html>Bad gateway</html>');
    jest.spyOn(axios, 'post').mockRejectedValue(proxyPage);
    await expect(broadcastTx('00', 'flux')).rejects.toBe(proxyPage);

    const offline = new AxiosError('Network Error', 'ERR_NETWORK');
    jest.spyOn(axios, 'post').mockRejectedValue(offline);
    await expect(broadcastTx('00', 'flux')).rejects.toBe(offline);
  });

  it('getBroadcastRejectReason handles each body shape', () => {
    expect(
      getBroadcastRejectReason(httpError(400, { error: { message: 'x' } })),
    ).toBe('x');
    expect(getBroadcastRejectReason(httpError(400, '  a\n  b  '))).toBe('a b');
    expect(getBroadcastRejectReason(httpError(400, ''))).toBeNull();
    expect(getBroadcastRejectReason(httpError(400, '<html>x</html>'))).toBe(
      null,
    );
    expect(getBroadcastRejectReason(httpError(503, 'down'))).toBeNull();
    expect(getBroadcastRejectReason(new Error('plain'))).toBeNull();
    const long = getBroadcastRejectReason(httpError(400, 'r'.repeat(300)));
    expect(long).toHaveLength(201);
    expect(long?.endsWith('…')).toBe(true);
  });
});
