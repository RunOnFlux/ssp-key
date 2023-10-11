import { configureStore, combineReducers } from '@reduxjs/toolkit';
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
import autoMergeLevel2 from 'redux-persist/lib/stateReconciler/autoMergeLevel2';
import { MMKV } from 'react-native-mmkv';
import { cryptos } from '../types';

// ********** Import chains **********
import flux from './flux';
import fluxTestnet from './fluxTestnet';
import rvn from './fluxTestnet';

const chains = {
  flux,
  fluxTestnet,
  rvn,
};
// ********** Import chains **********

import theme from './theme';
import ssp from './ssp';

const reducers = combineReducers({
  theme,
  ssp,
  flux: flux.reducer,
  fluxTestnet: fluxTestnet.reducer,
  rvn: rvn.reducer,
});

export const storage = new MMKV();
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
    storage.delete(key);
    return Promise.resolve();
  },
};

const persistConfig = {
  key: 'root',
  storage: reduxStorage,
  stateReconciler: autoMergeLevel2,
};

const persistedReducer = persistReducer<ReturnType<typeof reducers>>(
  persistConfig,
  reducers,
);

const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) => {
    const middlewares = getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    });

    if (__DEV__ && !process.env.JEST_WORKER_ID) {
      const createDebugger = require('redux-flipper').default;
      middlewares.push(createDebugger());
    }

    return middlewares;
  },
});

const persistor = persistStore(store);

setupListeners(store.dispatch);

export { store, persistor };

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
  store.dispatch(chains.flux.actions.setXpubWallet(data));
}
export function setXpubKeyIdentity(data: string) {
  store.dispatch(chains.flux.actions.setXpubKey(data));
}
export function setXprivKeyIdentity(data: string) {
  store.dispatch(chains.flux.actions.setXprivKey(data));
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
