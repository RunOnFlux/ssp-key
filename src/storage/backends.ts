import { storage } from '../store/index'; // mmkv

interface Backend {
  node: string;
}
type backends = Record<string, Backend>;

let localForgeBackends: backends = {};

export function loadBackendsConfig() {
  const localForgeBackendsStorage = storage.getString('backends');
  if (localForgeBackendsStorage) {
    console.log(localForgeBackendsStorage);
    localForgeBackends = JSON.parse(localForgeBackendsStorage);
  }
}

loadBackendsConfig();

// *** BACKENDS ***
const flux = {
  node: 'explorer.runonflux.io',
};
const fluxTestnet = {
  node: 'testnet.runonflux.io',
};
const rvn = {
  node: 'blockbookravencoin.app.runonflux.io',
};
const ltc = {
  node: 'blockbooklitecoin.app.runonflux.io',
};
const btc = {
  node: 'blockbookbitcoin.app.runonflux.io',
};
const doge = {
  node: 'blockbookdogecoin.app.runonflux.io',
};
const zec = {
  node: 'blockbookzcash.app.runonflux.io',
};
const bch = {
  node: 'blockbookbitcoincash.app.runonflux.io',
};
const btcTestnet = {
  node: 'blockbookbitcointestnet.app.runonflux.io',
};
const btcSignet = {
  node: 'blockbookbitcoinsignet.app.runonflux.io',
};
const sepolia = {
  node: 'node.ethereum-sepolia.runonflux.io',
};
const eth = {
  node: 'node.ethereum-mainnet.runonflux.io',
};

export function backends() {
  return {
    flux: localForgeBackends?.flux || flux,
    fluxTestnet: localForgeBackends?.fluxTestnet || fluxTestnet,
    rvn: localForgeBackends?.rvn || rvn,
    ltc: localForgeBackends?.ltc || ltc,
    btc: localForgeBackends?.btc || btc,
    doge: localForgeBackends?.doge || doge,
    zec: localForgeBackends?.zec || zec,
    bch: localForgeBackends?.bch || bch,
    btcTestnet: localForgeBackends?.btcTestnet || btcTestnet,
    btcSignet: localForgeBackends?.btcSignet || btcSignet,
    sepolia: localForgeBackends?.sepolia || sepolia,
    eth: localForgeBackends?.eth || eth,
  };
}

export function backendsOriginal() {
  return {
    flux,
    fluxTestnet,
    rvn,
    ltc,
    btc,
    doge,
    zec,
    bch,
    btcTestnet,
    btcSignet,
    sepolia,
    eth,
  };
}
