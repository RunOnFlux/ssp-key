declare module '@runonflux/flux-sdk' {
  export const fluxnode: {
    signMessage: (
      message: string,
      privateKeyHex: string,
      isCompressed: boolean,
      messagePrefix: string,
      options?: { extraEntropy?: Buffer },
    ) => string;
  };
}
