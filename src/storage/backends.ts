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

const flux = {
  node: 'explorer.runonflux.io',
};
const fluxTestnet = {
  node: 'testnet.runonflux.io',
};
const rvn = {
  node: 'api.ravencoin.org',
};

export function backends() {
  return {
    flux: localForgeBackends?.flux || flux,
    fluxTestnet: localForgeBackends?.fluxTestnet || fluxTestnet,
    rvn: localForgeBackends?.rvn || rvn,
  };
}

export function backendsOriginal() {
  return {
    flux,
    fluxTestnet,
    rvn,
  };
}
