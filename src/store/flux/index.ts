import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface FluxState {
  xpubWallet: string;
  xpubKey: string;
  xprivKey: string;
  address: string;
  redeemScript: string;
  sspWalletKeyIdentity: string;
  sspWalletIdentity: string;
}

const initialState: FluxState = {
  xpubWallet: '', // encrypted
  xpubKey: '', // encrypted
  xprivKey: '', // encrypted
  address: '',
  redeemScript: '', // encrypted
  sspWalletKeyIdentity: '',
  sspWalletIdentity: '',
};

const fluxSlice = createSlice({
  name: 'flux',
  initialState,
  reducers: {
    setAddress: (state, action: PayloadAction<string>) => {
      state.address = action.payload;
    },
    setRedeemScript: (state, action: PayloadAction<string>) => {
      state.redeemScript = action.payload;
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
      state.address = '';
      state.redeemScript = '';
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
