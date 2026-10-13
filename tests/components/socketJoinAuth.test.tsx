/**
 * RA-1 / RLY-2: the Key's socket join is always authenticated.
 *
 * The relay used to accept `join` without a signature, letting anyone join
 * any identity's room and harvest its pending actions. The relay now refuses
 * those, and the Key must never send one: without auth material it does not
 * join at all (pending requests still arrive through the signed GET poll) and
 * it joins — signed — as soon as auth becomes available.
 */
import React from 'react';
import { AppState, Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

type Handler = (...args: unknown[]) => void;

const mockSockets: {
  handlers: Record<string, Handler>;
  emit: jest.Mock;
  close: jest.Mock;
  connected: boolean;
}[] = [];

jest.mock('socket.io-client', () => ({
  __esModule: true,
  default: jest.fn(() => {
    const socket = {
      handlers: {} as Record<string, Handler>,
      emit: jest.fn(),
      close: jest.fn(),
      connected: false,
      on(event: string, handler: Handler) {
        socket.handlers[event] = handler;
        return socket;
      },
    };
    mockSockets.push(socket);
    return socket;
  }),
}));

jest.mock('@storage/ssp', () => ({
  sspConfig: () => ({ relay: 'relay.example.com' }),
}));

const mockAuthState: {
  isAuthAvailable: boolean;
  createWkIdentityAuth: jest.Mock;
} = {
  isAuthAvailable: false,
  createWkIdentityAuth: jest.fn(),
};

jest.mock('../../src/hooks', () => ({
  useAppSelector: (selector: (state: unknown) => unknown) =>
    selector({ ssp: { sspWalletKeyInternalIdentity: 'bc1qwk' } }),
  useRelayAuth: () => ({ ...mockAuthState }),
}));

import { SocketProvider } from '../../src/contexts/SocketContext';

const AUTH = {
  signature: 'sig',
  message: '{"action":"join"}',
  publicKey: '02ab',
  witnessScript: '52ae',
};

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const joins = () =>
  mockSockets.flatMap((socket) =>
    socket.emit.mock.calls.filter((call) => call[0] === 'join'),
  );

const tree = () => (
  <SocketProvider>
    <Text>child</Text>
  </SocketProvider>
);

beforeEach(() => {
  mockSockets.length = 0;
  mockAuthState.isAuthAvailable = false;
  mockAuthState.createWkIdentityAuth = jest.fn(() => Promise.resolve(AUTH));
  (AppState as unknown as { currentState: string }).currentState = 'active';
});

const connect = async () => {
  const socket = mockSockets[mockSockets.length - 1];
  socket.connected = true;
  await act(async () => {
    socket.handlers.connect();
    await Promise.resolve();
  });
  await flush();
  return socket;
};

describe('SocketProvider join', () => {
  it('never emits an unauthenticated join when auth is unavailable', async () => {
    render(tree());
    await connect();
    expect(joins()).toHaveLength(0);
    expect(mockAuthState.createWkIdentityAuth).not.toHaveBeenCalled();
  });

  it('joins with auth fields once auth becomes available', async () => {
    const { rerender } = render(tree());
    await connect();
    expect(joins()).toHaveLength(0);

    mockAuthState.isAuthAvailable = true;
    mockAuthState.createWkIdentityAuth = jest.fn(() => Promise.resolve(AUTH));
    rerender(tree());
    await flush();

    expect(joins()).toEqual([['join', { wkIdentity: 'bc1qwk', ...AUTH }]]);
    expect(mockAuthState.createWkIdentityAuth).toHaveBeenCalledWith(
      'join',
      'bc1qwk',
      { wkIdentity: 'bc1qwk' },
    );
  });

  it('joins signed on connect when auth is already available', async () => {
    mockAuthState.isAuthAvailable = true;
    render(tree());
    await connect();
    expect(joins()).toEqual([['join', { wkIdentity: 'bc1qwk', ...AUTH }]]);
  });

  it('does not fall back to an unsigned join when signing fails', async () => {
    mockAuthState.isAuthAvailable = true;
    mockAuthState.createWkIdentityAuth = jest.fn(() => Promise.resolve(null));
    render(tree());
    await connect();
    expect(joins()).toHaveLength(0);
  });

  it('re-joins (signed) after a reconnect', async () => {
    mockAuthState.isAuthAvailable = true;
    render(tree());
    const socket = await connect();
    await act(async () => {
      socket.handlers.disconnect();
      await Promise.resolve();
    });
    await connect();
    expect(joins()).toHaveLength(2);
    for (const call of joins()) {
      expect(call[1]).toMatchObject({ signature: 'sig', publicKey: '02ab' });
    }
  });
});
