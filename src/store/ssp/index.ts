import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface seedPhraseState {
  seedPhrase: string;
  sspWalletKeyInternalIdentity: string;
  sspWalletInternalIdentity: string;
  publicNonces: string;
  identityChain: 'btc';
}

const initialStateSeedPhrase: seedPhraseState = {
  seedPhrase: '',
  sspWalletKeyInternalIdentity: '',
  sspWalletInternalIdentity: '',
  publicNonces: '',
  identityChain: 'btc',
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
    setSspKeyPublicNonces: (state, action: PayloadAction<string>) => {
      state.publicNonces = action.payload;
    },
    setSSPInitialState: (state) => {
      state.seedPhrase = '';
      state.sspWalletKeyInternalIdentity = '';
      state.sspWalletInternalIdentity = '';
      state.identityChain = 'btc';
      state.publicNonces = '';
    },
  },
});

export const {
  setSeedPhrase,
  setSspWalletKeyInternalIdentity,
  setSspWalletInternalIdentity,
  setSspKeyPublicNonces,
  setSSPInitialState,
} = seedPhraseSlice.actions;

export default seedPhraseSlice.reducer;
