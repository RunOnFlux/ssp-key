import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface ChainState {
  xpubWallet: string;
  xpubKey: string;
  xprivKey: string;
}

const initialState: ChainState = {
  xpubWallet: '', // encrypted
  xpubKey: '', // encrypted
  xprivKey: '', // encrypted
};

const chainSlice = createSlice({
  name: 'ltc',
  initialState,
  reducers: {
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
    },
  },
});

export const { setXpubWallet, setXpubKey, setXprivKey, setChainInitialState } =
  chainSlice.actions;

export default chainSlice;
