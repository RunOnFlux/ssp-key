import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface FluxState {
  xpubWallet: string;
  xpubKey: string;
  xprivKey: string;
  address: string;
  redeemScript: string;
}

const initialState: FluxState = {
  xpubWallet: '',
  xpubKey: '',
  xprivKey: '',
  address: '',
  redeemScript: '',
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
    // to reset data
    setFluxInitialState: (state) => {
      state.xpubWallet = '';
      state.xpubKey = '';
      state.xprivKey = '';
      state.address = '';
      state.redeemScript = '';
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
} = fluxSlice.actions;

export default fluxSlice.reducer;
