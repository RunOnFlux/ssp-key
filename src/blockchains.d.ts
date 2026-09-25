declare module '@storage/blockchains' {
  export interface Token {
    contract: string;
    name: string;
    symbol: string;
    decimals: number;
    logo: string;
  }
  interface Blockchain {
    id: string;
    libid: string;
    name: string;
    symbol: string;
    decimals: number;
    node: string;
    api: string;
    slip: number;
    scriptType: string;
    messagePrefix: string;
    pubKeyHash: string;
    scriptHash: string;
    wif: string;
    logo: string;
    bip32: {
      public: number;
      private: number;
    };
    txVersion: number;
    txGroupID: number;
    backend: string;
    bech32: string;
    dustLimit: number;
    minFeePerByte: number;
    feePerByte: number;
    maxMessage: number;
    maxTxSize: number;
    rbf: boolean;
    cashaddr: string;
    txExpiryHeight: number;
    hashType: number;
    // evm
    chainType: string;
    accountSalt: string;
    factorySalt: string;
    factoryAddress: string;
    entrypointAddress: string;
    baseFee: number;
    priorityFee: number;
    gasLimit: number;
    tokens: Token[];
    // sol
    programId?: string; // on-chain Solana program for chainType='sol'
    // kas: chainType 'kas'; libid is the address prefix ('kaspa'); fee
    // fields are sompi per gram of mass; maxTxSize is the mass cap.
    maxFee?: number;
  }
  type blockchains = Record<string, Blockchain>;
  let blockchains: blockchains;
}
