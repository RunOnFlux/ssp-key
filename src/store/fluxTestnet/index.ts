import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { wallets, wallet } from '../../types';

export interface ChainState {
  xpubWallet: string;
  xpubKey: string;
  xprivKey: string;
  wallets: wallets;
}

const initialState: ChainState = {
  xpubWallet: '', // encrypted
  xpubKey: '', // encrypted
  xprivKey: '', // encrypted
  wallets: {},
};

const initialWalletState: wallet = {
  address: '',
  redeemScript: '',
};

const chainSlice = createSlice({
  name: 'fluxTestnet',
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
    // to reset data
    setChainInitialState: (state) => {
      state.xpubWallet = '';
      state.xpubKey = '';
      state.xprivKey = '';
      state.wallets = {};
    },
  },
});

export const {
  setAddress,
  setRedeemScript,
  setXpubWallet,
  setXpubKey,
  setXprivKey,
  setChainInitialState,
} = chainSlice.actions;

export default chainSlice;
