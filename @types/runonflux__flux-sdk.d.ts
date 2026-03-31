declare module '@runonflux/flux-sdk' {
  interface DelegateData {
    version?: number;
    type?: number;
    delegatePublicKeys?: string[];
  }

  export const fluxnode: {
    startFluxNodev6WithPubKey: (
      collateralOutHash: string,
      collateralOutIndex: number,
      collateralPrivateKey: string,
      fluxnodePublicKey: string,
      timestamp: string,
      compressedCollateralPrivateKey: boolean,
      redeemScript: string,
      delegateData?: DelegateData,
    ) => string;
    signMessage: (
      message: string,
      privateKeyHex: string,
      isCompressed: boolean,
      messagePrefix: string,
      options?: { extraEntropy?: Buffer },
    ) => string;
  };
}
