import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface seedPhraseState {
  seedPhrase: string;
  sspWalletKeyInternalIdentity: string;
  sspWalletKeyInternalIdentityWitnessScript: string;
  sspWalletKeyInternalIdentityPubKey: string;
  sspWalletInternalIdentity: string;
  sspKeyInternalIdentity: string;
  publicNonces: string;
  enterprisePublicNonces: string;
  identityChain: 'btc';
  /**
   * Encrypted xpriv/xpub of the recovery account m/48'/coin'/99'/scriptType',
   * whose keys are what the recovery flow releases. Stored rather than derived
   * on demand so that path works from this key alone and never the mnemonic.
   * See lib/recoveryAccount.ts.
   */
  xprivRecovery: string;
  xpubRecovery: string;
}

const initialStateSeedPhrase: seedPhraseState = {
  seedPhrase: '',
  sspWalletKeyInternalIdentity: '',
  sspWalletKeyInternalIdentityWitnessScript: '',
  sspWalletKeyInternalIdentityPubKey: '',
  sspWalletInternalIdentity: '',
  sspKeyInternalIdentity: '',
  publicNonces: '',
  enterprisePublicNonces: '',
  identityChain: 'btc',
  xprivRecovery: '',
  xpubRecovery: '',
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
    setSspKeyEnterprisePublicNonces: (state, action: PayloadAction<string>) => {
      state.enterprisePublicNonces = action.payload;
    },
    setSspKeyRecoveryKeys: (
      state,
      action: PayloadAction<{ xpriv: string; xpub: string }>,
    ) => {
      state.xprivRecovery = action.payload.xpriv;
      state.xpubRecovery = action.payload.xpub;
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
      state.enterprisePublicNonces = '';
      state.xprivRecovery = '';
      state.xpubRecovery = '';
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
  setSspKeyEnterprisePublicNonces,
  setSspKeyRecoveryKeys,
  setSSPInitialState,
} = seedPhraseSlice.actions;

export default seedPhraseSlice.reducer;
