import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { wallets, wallet } from '../../types';

export interface FluxState {
  xpubWallet: string;
  xpubKey: string;
  xprivKey: string;
  wallets: wallets;
  sspWalletKeyIdentity: string;
  sspWalletIdentity: string;
}

const initialState: FluxState = {
  xpubWallet: '', // encrypted
  xpubKey: '', // encrypted
  xprivKey: '', // encrypted
  wallets: {},
  sspWalletKeyIdentity: '',
  sspWalletIdentity: '',
};

const initialWalletState: wallet = {
  address: '',
  redeemScript: '',
};

const fluxSlice = createSlice({
  name: 'flux',
  initialState,
  reducers: {
    setAddress: (
      state,
      action: PayloadAction<{ wallet: string; data: string }>,
    ) => {
      state.wallets = state.wallets || {};
      state.wallets[action.payload.wallet] = state.wallets[
        action.payload.wallet
      ] || { ...initialWalletState };
      state.wallets[action.payload.wallet].address = action.payload.data;
    },
    setRedeemScript: (
      state,
      action: PayloadAction<{ wallet: string; data: string }>,
    ) => {
      state.wallets = state.wallets || {};
      state.wallets[action.payload.wallet] = state.wallets[
        action.payload.wallet
      ] || { ...initialWalletState };
      state.wallets[action.payload.wallet].redeemScript = action.payload.data;
    },
    setXpubWallet: (state, action: PayloadAction<string>) => {
      state.xpubWallet = action.payload;
    },
    setXpubKey: (state, action: PayloadAction<string>) => {
      state.xpubKey = action.payload;
    },
    setXprivKey: (state, action: PayloadAction<string>) => {
      state.xprivKey = action.payload;
    },
    setSspWalletKeyIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletKeyIdentity = action.payload;
    },
    setsspWalletIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletIdentity = action.payload;
    },
    // to reset data
    setFluxInitialState: (state) => {
      state.xpubWallet = '';
      state.xpubKey = '';
      state.xprivKey = '';
      state.wallets = {};
      state.sspWalletKeyIdentity = '';
      state.sspWalletIdentity = '';
    },
  },
});

export const {
  setAddress,
  setRedeemScript,
  setXpubWallet,
  setXpubKey,
  setXprivKey,
  setFluxInitialState,
  setsspWalletIdentity,
  setSspWalletKeyIdentity,
} = fluxSlice.actions;

export default fluxSlice.reducer;
