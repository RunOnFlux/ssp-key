declare module '@storage/backends' {
  interface Backend {
    node: string;
    explorer: string;
  }
  type backends = Record<string, Backend>;
  let backends: () => backends;
  let backendsOriginal: () => backends;
  let loadBackendsConfig: () => void;
}
