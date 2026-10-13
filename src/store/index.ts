import {
  configureStore,
  combineReducers,
  Reducer,
  UnknownAction,
} from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import {
  persistReducer,
  persistStore,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
  Storage,
} from 'redux-persist';
import autoMergeLevel2 from 'redux-persist/lib/stateReconciler/autoMergeLevel2'; // here we need to be careful with updates to our initial state!
import { createMMKV } from 'react-native-mmkv';
import { cryptos, chainStateKey } from '../types';

// ********** Import chains **********
import chainSliceBase from './chainSliceBase';

const chains = {
  flux: chainSliceBase('flux'),
  fluxTestnet: chainSliceBase('fluxTestnet'),
  rvn: chainSliceBase('rvn'),
  ltc: chainSliceBase('ltc'),
  btc: chainSliceBase('btc'),
  doge: chainSliceBase('doge'),
  zec: chainSliceBase('zec'),
  bch: chainSliceBase('bch'),
  btcTestnet: chainSliceBase('btcTestnet'),
  btcSignet: chainSliceBase('btcSignet'),
  sepolia: chainSliceBase('sepolia'),
  eth: chainSliceBase('eth'),
  amoy: chainSliceBase('amoy'),
  polygon: chainSliceBase('polygon'),
  base: chainSliceBase('base'),
  avax: chainSliceBase('avax'),
  bsc: chainSliceBase('bsc'),
  solDevnet: chainSliceBase('solDevnet'),
  solMainnet: chainSliceBase('solMainnet'),
};
// ********** Import chains **********

const chainKeys = Object.keys(chains) as (keyof cryptos)[];

/** Every chain slice registered in the store. */
export const registeredChainKeys: readonly (keyof cryptos)[] = chainKeys;

import theme from './theme';
import ssp from './ssp';

const reducers = combineReducers({
  theme,
  ssp,
  // === IMPORT CHAINS ===
  ...chainKeys.reduce(
    (acc, key) => {
      acc[key] = chains[key].reducer;
      return acc;
    },
    {} as Record<keyof cryptos, Reducer<chainStateKey>>,
  ),
});

export const storage = createMMKV();
export const reduxStorage: Storage = {
  setItem: (key, value) => {
    storage.set(key, value);
    return Promise.resolve(true);
  },
  getItem: (key) => {
    const value = storage.getString(key);
    return Promise.resolve(value);
  },
  removeItem: (key) => {
    storage.remove(key);
    return Promise.resolve();
  },
};

const persistConfig = {
  key: 'root',
  storage: reduxStorage,
  stateReconciler: autoMergeLevel2,
};

/** redux-persist's MMKV key for the whole persisted root. */
export const PERSIST_ROOT_KEY = `persist:${persistConfig.key}`;

type CombinedState = ReturnType<typeof reducers>;

/**
 * Every AES ciphertext the app keeps in redux (all encrypted with
 * enc_key + app password). Used to re-encrypt them all under a new key in ONE
 * state transition (KEY-3 enc_key rotation): the persisted root is either
 * entirely old-key or entirely new-key, never a mix.
 */
export interface EncryptedStateBlobs {
  ssp: {
    seedPhrase: string;
    publicNonces: string;
    enterprisePublicNonces: string;
    xprivRecovery: string;
    xpubRecovery: string;
  };
  chains: Partial<Record<keyof cryptos, chainStateKey>>;
}

const REPLACE_ENCRYPTED_BLOBS = 'ssp/replaceEncryptedBlobs';

export const replaceEncryptedBlobs = (payload: EncryptedStateBlobs) => ({
  type: REPLACE_ENCRYPTED_BLOBS,
  payload,
});

const rootReducer: Reducer<CombinedState> = (state, action) => {
  if (action.type === REPLACE_ENCRYPTED_BLOBS && state) {
    const { ssp: sspBlobs, chains: chainBlobs } = (
      action as UnknownAction & { payload: EncryptedStateBlobs }
    ).payload;
    const next = { ...state, ssp: { ...state.ssp, ...sspBlobs } };
    for (const chain of chainKeys) {
      const blobs = chainBlobs[chain];
      if (blobs) {
        next[chain] = { ...state[chain], ...blobs };
      }
    }
    return next;
  }
  return reducers(state, action);
};

const persistedReducer = persistReducer<CombinedState>(
  persistConfig,
  rootReducer,
);

const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) => {
    const middlewares = getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    });

    return middlewares;
  },
});

const persistor = persistStore(store);

setupListeners(store.dispatch);

export { store, persistor };

/**
 * Write the current redux state to MMKV now (instead of on redux-persist's
 * next tick) and resolve once it is stored. Callers that must know a state
 * change is durable — e.g. before swapping the key its ciphertexts need —
 * await this.
 */
export async function flushPersistedState(): Promise<void> {
  await persistor.flush();
}

/**
 * The persisted (MMKV) value of one top-level slice, parsed — what the app
 * will rehydrate after a restart. Undefined when absent or unreadable.
 */
export function readPersistedSlice<T>(slice: string): T | undefined {
  try {
    const raw = storage.getString(PERSIST_ROOT_KEY);
    if (!raw) return undefined;
    const root = JSON.parse(raw) as Record<string, string>;
    return root[slice] ? (JSON.parse(root[slice]) as T) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compact the MMKV file (react-native-mmkv 4.x `trim()`: full write-back, then
 * truncate). MMKV is append-only, so an overwritten value — e.g. the old-key
 * `persist:root` copy after the KEY-3 enc_key rotation — stays in the file
 * until compaction. Best effort: never throws.
 */
export function compactPersistedStorage(): void {
  try {
    storage.trim();
  } catch (error) {
    console.log('[storage] trim failed', error);
  }
}

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;

// Chain control functions
export function setXpubWallet(chain: keyof cryptos, data: string) {
  store.dispatch(chains[chain].actions.setXpubWallet(data));
}
export function setXpubKey(chain: keyof cryptos, data: string) {
  store.dispatch(chains[chain].actions.setXpubKey(data));
}
export function setXprivKey(chain: keyof cryptos, data: string) {
  store.dispatch(chains[chain].actions.setXprivKey(data));
}
export function setXpubWalletIdentity(data: string) {
  store.dispatch(chains.btc.actions.setXpubWallet(data));
}
export function setXpubKeyIdentity(data: string) {
  store.dispatch(chains.btc.actions.setXpubKey(data));
}
export function setXprivKeyIdentity(data: string) {
  store.dispatch(chains.btc.actions.setXprivKey(data));
}
export function setChainInitialState(chain: keyof cryptos) {
  store.dispatch(chains[chain].actions.setChainInitialState());
}
export function setInitialStateForAllChains() {
  Object.keys(chains).forEach((chain: string) => {
    store.dispatch(
      chains[chain as keyof cryptos].actions.setChainInitialState(),
    );
  });
}
