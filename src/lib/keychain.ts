/**
 * The app's only way into react-native-keychain. It re-exports the library
 * unchanged, except that on iOS every item lives in the app group's keychain
 * access group instead of the default one.
 *
 * Why: the default access group is `<App ID prefix>.io.runonflux.sspkey`.
 * Transferring the app to another Apple developer team changes that prefix to
 * the new Team ID, and the first build signed by the new team can no longer
 * read anything in the old group — `enc_key` included, without which the
 * stored seed can't be decrypted. An app group's access group carries no team
 * prefix and moves with the app group, so items in it survive the transfer.
 *
 * Builds before this one wrote to the default group. Their items move over as
 * they are read: `migrateKeychainToAppGroup` moves every item that needs no
 * authentication at launch; `sspkey_pw_bio` moves the next time the user
 * unlocks with biometrics. It is not recreated from `sspkey_pw` instead,
 * because that would bind it to the current biometric set without the user
 * having proven they belong to it.
 *
 * Android is untouched: the Keystore is tied to the app's signing key, which a
 * transfer doesn't change.
 */
import { Platform } from 'react-native';
import * as RNKeychain from 'react-native-keychain';

export * from 'react-native-keychain';

// Must match `com.apple.security.application-groups` in ios/SSPKey/SSPKey.entitlements.
const ACCESS_GROUP = 'group.io.runonflux.sspkey';
// Where builds signed by InFlux Technologies Limited (Team ID URVD95GYQ7) kept
// items. A build signed by any other team can't reach it; calls naming it then
// fail and are ignored.
const LEGACY_ACCESS_GROUP = 'URVD95GYQ7.io.runonflux.sspkey';
// errSecMissingEntitlement: this build isn't entitled to the app group.
const MISSING_ENTITLEMENT = '-34018';

// Read per call: Platform.OS is fixed in the app but switched by tests.
const isIOS = () => Platform.OS === 'ios';

// How each item is protected (iOS attributes only), so a moved item keeps the
// protection it was written with. A function, not a table: the enums must not
// be read at import time (tests mock the library without them).
function protectionFor(service: string): RNKeychain.SetOptions | null {
  const accessible = RNKeychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
  switch (service) {
    case 'enc_key':
    case 'salt':
    case 'sspkey_pw_hash':
    case 'sspkey_pw':
    case 'fcm_key_token':
    case 'sspkey_sign_history':
      return { accessible };
    case 'sspkey_pw_bio':
      return {
        accessible,
        accessControl: RNKeychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      };
    default:
      return null;
  }
}

// Services `migrateKeychainToAppGroup` moves at launch: readable without the user.
const SILENT_SERVICES = [
  'enc_key',
  'salt',
  'sspkey_pw_hash',
  'sspkey_pw',
  'fcm_key_token',
  'sspkey_sign_history',
];

function isMissingEntitlement(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === MISSING_ENTITLEMENT;
}

const moving = new Map<string, Promise<void>>();

// Copy an item read from the default group into the app group, confirm the
// copy is there, then delete the original. Any failure leaves the original in
// place for the next read to retry; nothing is deleted without a confirmed copy.
function moveToAppGroup(
  service: string,
  item: RNKeychain.UserCredentials,
): Promise<void> {
  const inFlight = moving.get(service);
  if (inFlight) {
    return inFlight;
  }
  const move = (async () => {
    const protection = protectionFor(service);
    if (!protection) {
      return;
    }
    await RNKeychain.setGenericPassword(item.username, item.password, {
      ...protection,
      service,
      accessGroup: ACCESS_GROUP,
    });
    // A biometric item can't be read back without prompting again; its
    // presence is enough (hasGenericPassword never shows UI).
    const copied = protection.accessControl
      ? await RNKeychain.hasGenericPassword({
          service,
          accessGroup: ACCESS_GROUP,
        })
      : await RNKeychain.getGenericPassword({
          service,
          accessGroup: ACCESS_GROUP,
        }).then(
          (copy) =>
            !!copy &&
            copy.username === item.username &&
            copy.password === item.password,
        );
    if (copied) {
      await RNKeychain.resetGenericPassword({
        service,
        accessGroup: LEGACY_ACCESS_GROUP,
      });
    }
  })()
    .catch((error) => {
      console.log(error);
    })
    .finally(() => {
      moving.delete(service);
    });
  moving.set(service, move);
  return move;
}

/**
 * Reads from the app group; falls back to a copy left by an earlier build and
 * moves it into the app group. Callers never pass `accessGroup`.
 */
export async function getGenericPassword(
  options?: RNKeychain.GetOptions,
): Promise<false | RNKeychain.UserCredentials> {
  if (!isIOS()) {
    return RNKeychain.getGenericPassword(options);
  }
  let entitled = true;
  try {
    const item = await RNKeychain.getGenericPassword({
      ...options,
      accessGroup: ACCESS_GROUP,
    });
    if (item) {
      return item;
    }
  } catch (error) {
    // A cancelled biometric prompt, a locked device, … — same as before.
    if (!isMissingEntitlement(error)) {
      throw error;
    }
    entitled = false;
  }
  // Nothing in the app group. Without an access group the query searches
  // every group the app can reach, so this finds an earlier build's copy.
  const legacy = await RNKeychain.getGenericPassword(options);
  if (legacy && options?.service && entitled) {
    await moveToAppGroup(options.service, legacy);
  }
  return legacy;
}

/** Writes to the app group and drops any copy an earlier build left behind. */
export async function setGenericPassword(
  username: string,
  password: string,
  options?: RNKeychain.SetOptions,
): Promise<false | RNKeychain.Result> {
  if (!isIOS()) {
    return RNKeychain.setGenericPassword(username, password, options);
  }
  let result: false | RNKeychain.Result;
  try {
    result = await RNKeychain.setGenericPassword(username, password, {
      ...options,
      accessGroup: ACCESS_GROUP,
    });
  } catch (error) {
    if (!isMissingEntitlement(error)) {
      throw error;
    }
    // Not entitled to the app group: keep the old behaviour rather than lose the write.
    return RNKeychain.setGenericPassword(username, password, options);
  }
  if (options?.service) {
    await RNKeychain.resetGenericPassword({
      service: options.service,
      accessGroup: LEGACY_ACCESS_GROUP,
    }).catch(() => undefined);
  }
  return result;
}

// resetGenericPassword and hasGenericPassword are re-exported unchanged: with no
// access group they act on every group the app can reach, the app group's copy
// and an earlier build's copy alike.

/**
 * Moves every item that can be read without the user into the app group. Safe
 * on every launch: a moved item is found in the app group and left alone, and
 * a failed read (e.g. before first unlock) is retried next launch.
 */
export async function migrateKeychainToAppGroup(): Promise<void> {
  if (!isIOS()) {
    return;
  }
  for (const service of SILENT_SERVICES) {
    try {
      await getGenericPassword({ service });
    } catch (error) {
      console.log(error);
    }
  }
}
