/**
 * KEY-9: app-switcher snapshot protection must also cover RN Modals (seed
 * phrase / xpriv reveal), which iOS presents above the root view.
 *
 * Every Modal renders its own BlurOverlay; these tests pin that all instances
 * flip together from ONE app-state store as soon as the app goes 'inactive'
 * (before 'background', when iOS snapshots), that an instance mounted while the
 * app is already inactive covers on its first render, and that the cover is
 * opaque rather than a blur.
 */
import React from 'react';
import { AppState, View } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

jest.mock('../../src/hooks', () => ({
  useTheme: () => ({
    darkMode: false,
    NavigationColors: { background: '#FAFAF9' },
  }),
}));

import BlurOverlay from '../../src/BlurOverlay';

const mockedAddEventListener = AppState.addEventListener as jest.Mock;
const setCurrentState = (state: string) => {
  (AppState as unknown as { currentState: string }).currentState = state;
};

const lastListener = () => {
  const calls = mockedAddEventListener.mock.calls;
  return calls[calls.length - 1][1] as (state: string) => void;
};

// Root overlay plus two "modals" (each Modal renders its own BlurOverlay).
const Screen = () => (
  <View>
    <BlurOverlay />
    <View testID="seed-modal">
      <BlurOverlay />
    </View>
    <View testID="xpriv-modal">
      <BlurOverlay />
    </View>
  </View>
);

beforeEach(() => {
  mockedAddEventListener.mockClear();
  setCurrentState('active');
});

describe('BlurOverlay', () => {
  it('renders nothing while the app is active', () => {
    const { unmount } = render(<Screen />);
    expect(screen.queryAllByTestId('privacy-cover')).toHaveLength(0);
    unmount();
  });

  it('covers the root and every modal at once on inactive, uncovers on active', () => {
    const { unmount } = render(<Screen />);
    // one shared AppState subscription for all instances
    expect(mockedAddEventListener).toHaveBeenCalledTimes(1);
    act(() => lastListener()('inactive'));
    expect(screen.getAllByTestId('privacy-cover')).toHaveLength(3);
    act(() => lastListener()('background'));
    expect(screen.getAllByTestId('privacy-cover')).toHaveLength(3);
    act(() => lastListener()('active'));
    expect(screen.queryAllByTestId('privacy-cover')).toHaveLength(0);
    unmount();
  });

  it('covers on first render when mounted while the app is already inactive', () => {
    setCurrentState('inactive');
    const { unmount } = render(<BlurOverlay />);
    expect(screen.getByTestId('privacy-cover')).toBeTruthy();
    unmount();
  });

  it('is an opaque cover in the theme background colour', () => {
    const { unmount } = render(<BlurOverlay />);
    act(() => lastListener()('inactive'));
    const cover = screen.getByTestId('privacy-cover');
    const flat = Object.assign({}, ...[cover.props.style].flat(2));
    expect(flat.backgroundColor).toBe('#FAFAF9');
    expect(flat.position).toBe('absolute');
    unmount();
  });

  it('releases the shared subscription when the last overlay unmounts', () => {
    const { unmount } = render(<Screen />);
    const subscription = mockedAddEventListener.mock.results[0].value as {
      remove: jest.Mock;
    };
    unmount();
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });
});
