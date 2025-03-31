import { storage } from '../store/index'; // mmkv

interface Backend {
  node?: string;
  api?: string;
  explorer?: string;
}
type backends = Record<string, Backend>;

let localForgeBackends: backends = {};

export function loadBackendsConfig() {
  const localForgeBackendsStorage = storage.getString('backends');
  if (localForgeBackendsStorage) {
    console.log(localForgeBackendsStorage);
    localForgeBackends = JSON.parse(localForgeBackendsStorage);
  } else {
    localForgeBackends = {};
  }
}

loadBackendsConfig();

// *** BACKENDS ***
const assetBackends: backends = {
  flux: {
    node: 'explorer.runonflux.io',
  },
  fluxTestnet: {
    node: 'testnet.runonflux.io',
  },
  rvn: {
    node: 'blockbookravencoin.app.runonflux.io',
  },
  ltc: {
    node: 'blockbooklitecoin.app.runonflux.io',
  },
  btc: {
    node: 'blockbookbitcoin.app.runonflux.io',
  },
  doge: {
    node: 'blockbookdogecoin.app.runonflux.io',
  },
  zec: {
    node: 'blockbookzcash.app.runonflux.io',
  },
  bch: {
    node: 'blockbookbitcoincash.app.runonflux.io',
  },
  btcTestnet: {
    node: 'blockbookbitcointestnet.app.runonflux.io',
  },
  btcSignet: {
    node: 'blockbookbitcoinsignet.app.runonflux.io',
  },
  sepolia: {
    node: 'node.ethereum-sepolia.runonflux.io',
    api: 'api.ethereum-sepolia.runonflux.io/api',
    explorer: 'sepolia.etherscan.io',
  },
  eth: {
    node: 'node.ethereum-mainnet.runonflux.io',
    api: 'api.ethereum-mainnet.runonflux.io/api',
    explorer: 'etherscan.io',
  },
  amoy: {
    node: 'node.polygon-amoy.runonflux.io',
    api: 'api.polygon-amoy.runonflux.io/api',
    explorer: 'amoy.polygonscan.com',
  },
  polygon: {
    node: 'node.polygon-mainnet.runonflux.io',
    api: 'api.polygon-mainnet.runonflux.io/api',
    explorer: 'polygonscan.com',
  },
  base: {
    node: 'node.base-mainnet.runonflux.io',
    api: 'api.base-mainnet.runonflux.io/api',
    explorer: 'basescan.org',
  },
  avax: {
    node: 'node.avax-mainnet.runonflux.io',
    api: 'api.avax-mainnet.runonflux.io/api',
    explorer: 'snowtrace.io',
  },
  bsc: {
    node: 'node.bsc-mainnet.runonflux.io',
    api: 'api.bsc-mainnet.runonflux.io/api',
    explorer: 'bscscan.com',
  },
};

export function backends() {
  const backendKeys = Object.keys(assetBackends);
  const currentBackends: backends = backendKeys.reduce((acc, key) => {
    const localBackend = localForgeBackends[key];
    acc[key] = {
      node: localBackend?.node ?? assetBackends[key].node,
      api: localBackend?.api ?? assetBackends[key].api,
      explorer: localBackend?.explorer ?? assetBackends[key].explorer,
    };
    return acc;
  }, {} as backends);
  return currentBackends;
}

export function backendsOriginal() {
  return assetBackends;
}
