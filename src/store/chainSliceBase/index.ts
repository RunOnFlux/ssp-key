import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { chainStateKey } from '../../types';

const initialState: chainStateKey = {
  xpubWallet: '', // encrypted
  xpubKey: '', // encrypted
  xprivKey: '', // encrypted
};

function makeChainSlice(chainName: string) {
  const chainSlice = createSlice({
    name: chainName,
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
  return chainSlice;
}

export default makeChainSlice;
