/**
 * lib/keychain moves iOS keychain items into the app group's access group, so
 * they survive the app's transfer to another Apple developer team (whose builds
 * can't read the old team-prefixed default group).
 *
 * The mock below models the iOS rules the move relies on: an add without an
 * access group lands in the default group; a query or delete without one
 * matches every group; one with an access group matches only that group.
 */
import { Platform } from 'react-native';

import * as Keychain from '../../src/lib/keychain';

type Item = {
  group: string;
  service: string;
  username: string;
  password: string;
  accessControl?: string;
};
type Options = {
  service?: string;
  accessGroup?: string;
  accessControl?: string;
};

const mockState: { items: Item[]; entitled: boolean; failAdd: boolean } = {
  items: [],
  entitled: true,
  failAdd: false,
};
const mockDefaultGroup = 'URVD95GYQ7.io.runonflux.sspkey';
const mockAppGroup = 'group.io.runonflux.sspkey';

jest.mock('react-native-keychain', () => {
  const matches = (item: Item, o: Options = {}) =>
    item.service === o.service &&
    (o.accessGroup === undefined || item.group === o.accessGroup);
  // The native module rejects (never throws) when the build isn't entitled.
  const denied = (o: Options = {}) =>
    o.accessGroup === mockAppGroup && !mockState.entitled
      ? Promise.reject(
          Object.assign(new Error('missing entitlement'), { code: '-34018' }),
        )
      : null;
  return {
    ACCESSIBLE: {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'AccessibleWhenUnlockedThisDeviceOnly',
    },
    ACCESS_CONTROL: { BIOMETRY_CURRENT_SET: 'BiometryCurrentSet' },
    getGenericPassword: jest.fn((o: Options = {}) => {
      const no = denied(o);
      if (no) return no;
      const item = mockState.items.find((i) => matches(i, o));
      return Promise.resolve(
        item
          ? {
              service: item.service,
              username: item.username,
              password: item.password,
              storage: 'keychain',
            }
          : false,
      );
    }),
    hasGenericPassword: jest.fn((o: Options = {}) => {
      const no = denied(o);
      if (no) return no;
      return Promise.resolve(mockState.items.some((i) => matches(i, o)));
    }),
    setGenericPassword: jest.fn(
      (username: string, password: string, o: Options = {}) => {
        const no = denied(o);
        if (no) return no;
        const group = o.accessGroup ?? mockDefaultGroup;
        mockState.items = mockState.items.filter(
          (i) => !(i.service === o.service && i.group === group),
        );
        if (mockState.failAdd) {
          return Promise.reject(new Error('add failed'));
        }
        mockState.items.push({
          group,
          service: o.service ?? '',
          username,
          password,
          accessControl: o.accessControl,
        });
        return Promise.resolve({ service: o.service, storage: 'keychain' });
      },
    ),
    resetGenericPassword: jest.fn((o: Options = {}) => {
      const no = denied(o);
      if (no) return no;
      mockState.items = mockState.items.filter((i) => !matches(i, o));
      return Promise.resolve(true);
    }),
  };
});

const legacy = (
  service: string,
  password: string,
  accessControl?: string,
): Item => ({
  group: mockDefaultGroup,
  service,
  username: service,
  password,
  accessControl,
});
const groupsOf = (service: string) =>
  mockState.items.filter((i) => i.service === service).map((i) => i.group);

beforeEach(() => {
  mockState.items = [];
  mockState.entitled = true;
  mockState.failAdd = false;
  Platform.OS = 'ios';
});

describe('lib/keychain on iOS', () => {
  it('moves an item left by an earlier build into the app group as it is read', async () => {
    mockState.items = [legacy('enc_key', 'k1')];

    const read = await Keychain.getGenericPassword({ service: 'enc_key' });

    expect(read && read.password).toBe('k1');
    expect(groupsOf('enc_key')).toEqual([mockAppGroup]);
  });

  it('moves every item readable without the user at launch, but not the biometric one', async () => {
    mockState.items = [
      legacy('enc_key', 'k1'),
      legacy('salt', 's1'),
      legacy('sspkey_pw_hash', 'h1'),
      legacy('sspkey_pw', 'p1'),
      legacy('fcm_key_token', 'f1'),
      legacy('sspkey_sign_history', 'x1'),
      legacy('sspkey_pw_bio', 'p1', 'BiometryCurrentSet'),
    ];

    await Keychain.migrateKeychainToAppGroup();

    for (const service of [
      'enc_key',
      'salt',
      'sspkey_pw_hash',
      'sspkey_pw',
      'fcm_key_token',
      'sspkey_sign_history',
    ]) {
      expect(groupsOf(service)).toEqual([mockAppGroup]);
    }
    expect(groupsOf('sspkey_pw_bio')).toEqual([mockDefaultGroup]);
  });

  it('moves the biometric item on the next biometric read and keeps its protection', async () => {
    mockState.items = [legacy('sspkey_pw_bio', 'p1', 'BiometryCurrentSet')];

    const read = await Keychain.getGenericPassword({
      service: 'sspkey_pw_bio',
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    });

    expect(read && read.password).toBe('p1');
    expect(mockState.items).toEqual([
      expect.objectContaining({
        group: mockAppGroup,
        service: 'sspkey_pw_bio',
        accessControl: 'BiometryCurrentSet',
      }),
    ]);
  });

  it('is a no-op once an item is in the app group', async () => {
    mockState.items = [{ ...legacy('enc_key', 'k1'), group: mockAppGroup }];

    await Keychain.migrateKeychainToAppGroup();
    const read = await Keychain.getGenericPassword({ service: 'enc_key' });

    expect(read && read.password).toBe('k1');
    expect(groupsOf('enc_key')).toEqual([mockAppGroup]);
  });

  it('never deletes the original when the copy could not be made', async () => {
    mockState.items = [legacy('enc_key', 'k1')];
    mockState.failAdd = true;

    const read = await Keychain.getGenericPassword({ service: 'enc_key' });

    expect(read && read.password).toBe('k1');
    expect(groupsOf('enc_key')).toEqual([mockDefaultGroup]);
  });

  it('writes to the app group and drops a stale copy left by an earlier build', async () => {
    mockState.items = [legacy('fcm_key_token', 'old')];

    await Keychain.setGenericPassword('fcm_key_token', 'new', {
      service: 'fcm_key_token',
    });

    expect(mockState.items).toEqual([
      expect.objectContaining({ group: mockAppGroup, password: 'new' }),
    ]);
  });

  it('keeps the old behaviour when the build lacks the app group entitlement', async () => {
    mockState.entitled = false;
    mockState.items = [legacy('enc_key', 'k1')];

    const read = await Keychain.getGenericPassword({ service: 'enc_key' });
    await Keychain.setGenericPassword('salt', 's1', { service: 'salt' });

    expect(read && read.password).toBe('k1');
    expect(groupsOf('enc_key')).toEqual([mockDefaultGroup]);
    expect(groupsOf('salt')).toEqual([mockDefaultGroup]);
  });

  it('reset removes every copy', async () => {
    mockState.items = [
      legacy('enc_key', 'k1'),
      { ...legacy('enc_key', 'k1'), group: mockAppGroup },
    ];

    await Keychain.resetGenericPassword({ service: 'enc_key' });

    expect(groupsOf('enc_key')).toEqual([]);
  });
});

describe('lib/keychain on Android', () => {
  it('passes calls through without an access group', async () => {
    Platform.OS = 'android';

    await Keychain.setGenericPassword('enc_key', 'k1', { service: 'enc_key' });
    await Keychain.migrateKeychainToAppGroup();

    expect(groupsOf('enc_key')).toEqual([mockDefaultGroup]);
  });
});
