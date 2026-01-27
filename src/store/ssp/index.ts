import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface seedPhraseState {
  seedPhrase: string;
  sspWalletKeyInternalIdentity: string;
  sspWalletKeyInternalIdentityWitnessScript: string;
  sspWalletKeyInternalIdentityPubKey: string;
  sspWalletInternalIdentity: string;
  sspKeyInternalIdentity: string;
  publicNonces: string;
  identityChain: 'btc';
}

const initialStateSeedPhrase: seedPhraseState = {
  seedPhrase: '',
  sspWalletKeyInternalIdentity: '',
  sspWalletKeyInternalIdentityWitnessScript: '',
  sspWalletKeyInternalIdentityPubKey: '',
  sspWalletInternalIdentity: '',
  sspKeyInternalIdentity: '',
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
    setSspWalletKeyInternalIdentityWitnessScript: (
      state,
      action: PayloadAction<string>,
    ) => {
      state.sspWalletKeyInternalIdentityWitnessScript = action.payload;
    },
    setSspWalletKeyInternalIdentityPubKey: (
      state,
      action: PayloadAction<string>,
    ) => {
      state.sspWalletKeyInternalIdentityPubKey = action.payload;
    },
    setSspWalletInternalIdentity: (state, action: PayloadAction<string>) => {
      state.sspWalletInternalIdentity = action.payload;
    },
    setSspKeyInternalIdentity: (state, action: PayloadAction<string>) => {
      state.sspKeyInternalIdentity = action.payload;
    },
    setSspKeyPublicNonces: (state, action: PayloadAction<string>) => {
      state.publicNonces = action.payload;
    },
    setSSPInitialState: (state) => {
      state.seedPhrase = '';
      state.sspWalletKeyInternalIdentity = '';
      state.sspWalletKeyInternalIdentityWitnessScript = '';
      state.sspWalletKeyInternalIdentityPubKey = '';
      state.sspWalletInternalIdentity = '';
      state.sspKeyInternalIdentity = '';
      state.identityChain = 'btc';
      state.publicNonces = '';
    },
  },
});

export const {
  setSeedPhrase,
  setSspWalletKeyInternalIdentity,
  setSspWalletKeyInternalIdentityWitnessScript,
  setSspWalletKeyInternalIdentityPubKey,
  setSspWalletInternalIdentity,
  setSspKeyInternalIdentity,
  setSspKeyPublicNonces,
  setSSPInitialState,
} = seedPhraseSlice.actions;

export default seedPhraseSlice.reducer;
