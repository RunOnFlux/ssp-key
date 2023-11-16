import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface seedPhraseState {
  seedPhrase: string;
  sspWalletKeyInternalIdentity: string;
  sspWalletInternalIdentity: string;
  identityChain: 'flux';
}

const initialStateSeedPhrase: seedPhraseState = {
  seedPhrase: '',
  sspWalletKeyInternalIdentity: '',
  sspWalletInternalIdentity: '',
  identityChain: 'flux',
};

const seedPhraseSlice = createSlice({
  name: 'seedphrase',
  initialState: initialStateSeedPhrase,
  reducers: {
    setSeedPhrase: (state, action: PayloadAction<string>) => {
      state.seedPhrase = action.payload;
    },
    // internal for ssp communication
    setSspWalletKeyInternalIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletKeyInternalIdentity = action.payload;
    },
    setSspWalletInternalIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletInternalIdentity = action.payload;
    },
    setSSPInitialState: (state) => {
      state.seedPhrase = '';
      state.sspWalletKeyInternalIdentity = '';
      state.sspWalletInternalIdentity = '';
    },
  },
});

export const {
  setSeedPhrase,
  setSspWalletKeyInternalIdentity,
  setSspWalletInternalIdentity,
  setSSPInitialState,
} = seedPhraseSlice.actions;

export default seedPhraseSlice.reducer;
