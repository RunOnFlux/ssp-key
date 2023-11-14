import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface seedPhraseState {
  seedPhrase: string;
  sspWalletKeyInternalIdentity: string;
  sspWalletInternalIdentity: string;
  sspWalletKeyExternalIdentity: string;
  sspWalletExternalIdentity: string;
  identityChain: 'flux';
}

const initialStateSeedPhrase: seedPhraseState = {
  seedPhrase: '',
  sspWalletKeyInternalIdentity: '',
  sspWalletInternalIdentity: '',
  sspWalletKeyExternalIdentity: '',
  sspWalletExternalIdentity: '',
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
    // external for logging into services
    setSspWalletKeyExternalIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletKeyExternalIdentity = action.payload;
    },
    setSspWalletExternalIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletExternalIdentity = action.payload;
    },
    setSSPInitialState: (state) => {
      state.seedPhrase = '';
      state.sspWalletKeyInternalIdentity = '';
      state.sspWalletInternalIdentity = '';
      state.sspWalletKeyExternalIdentity = '';
      state.sspWalletExternalIdentity = '';
    },
  },
});

export const {
  setSeedPhrase,
  setSspWalletKeyInternalIdentity,
  setSspWalletInternalIdentity,
  setSspWalletKeyExternalIdentity,
  setSspWalletExternalIdentity,
  setSSPInitialState,
} = seedPhraseSlice.actions;

export default seedPhraseSlice.reducer;
