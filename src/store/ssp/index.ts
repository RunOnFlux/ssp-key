import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface seedPhraseState {
  seedPhrase: string;
  sspWalletKeyIdentity: string;
  sspWalletIdentity: string;
  identityChain: 'flux';
}

const initialStateSeedPhrase: seedPhraseState = {
  seedPhrase: '',
  sspWalletKeyIdentity: '',
  sspWalletIdentity: '',
  identityChain: 'flux',
};

const seedPhraseSlice = createSlice({
  name: 'seedphrase',
  initialState: initialStateSeedPhrase,
  reducers: {
    setSeedPhrase: (state, action: PayloadAction<string>) => {
      state.seedPhrase = action.payload;
    },
    setSspWalletKeyIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletKeyIdentity = action.payload;
    },
    setsspWalletIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletIdentity = action.payload;
    },
    setSSPInitialState: (state) => {
      state.seedPhrase = '';
      state.sspWalletKeyIdentity = '';
      state.sspWalletIdentity = '';
    },
  },
});

export const {
  setSeedPhrase,
  setSspWalletKeyIdentity,
  setsspWalletIdentity,
  setSSPInitialState,
} = seedPhraseSlice.actions;

export default seedPhraseSlice.reducer;
