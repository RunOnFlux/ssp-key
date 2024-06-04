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
import autoMergeLevel2 from 'redux-persist/lib/stateReconciler/autoMergeLevel2'; // here we need to be careful with updates to our initial state!
import { MMKV } from 'react-native-mmkv';
import { cryptos } from '../types';

// ********** Import chains **********
import chainSliceBase from './chainSliceBase';

const chains = {
  flux: chainSliceBase('flux'),
  fluxTestnet: chainSliceBase('fluxTestnet'),
  rvn: chainSliceBase('rvn'),
  ltc: chainSliceBase('ltc'),
  btc: chainSliceBase('btc'),
  doge: chainSliceBase('doge'),
  btcTestnet: chainSliceBase('btcTestnet'),
  btcSignet: chainSliceBase('btcSignet'),
};
// ********** Import chains **********

import theme from './theme';
import ssp from './ssp';

const reducers = combineReducers({
  theme,
  ssp,
  // === IMPORT CHAINS ===
  flux: chains.flux.reducer,
  fluxTestnet: chains.fluxTestnet.reducer,
  rvn: chains.rvn.reducer,
  ltc: chains.ltc.reducer,
  btc: chains.btc.reducer,
  doge: chains.doge.reducer,
  btcTestnet: chains.btcTestnet.reducer,
  btcSignet: chains.btcSignet.reducer,
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
