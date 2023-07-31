import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface seedPhraseState {
  seedPhrase: string;
}

const initialStateSeedPhrase: seedPhraseState = {
  seedPhrase: '',
};

const seedPhraseSlice = createSlice({
  name: 'seedphrase',
  initialState: initialStateSeedPhrase,
  reducers: {
    setSeedPhrase: (state, action: PayloadAction<string>) => {
      state.seedPhrase = action.payload;
    },
    setSeedPhraseInitialState: (state) => {
      state.seedPhrase = '';
    },
  },
});

export const { setSeedPhrase, setSeedPhraseInitialState } =
  seedPhraseSlice.actions;

export default seedPhraseSlice.reducer;
