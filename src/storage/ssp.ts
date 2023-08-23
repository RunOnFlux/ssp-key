import { storage } from '../store/index'; // mmkv

interface config {
  relay?: string;
}

let storedLocalForgeSSPConfig: config = {};

export function loadSSPConfig() {
  const localForgeSSPConfig = storage.getString('sspConfig');
  if (localForgeSSPConfig) {
    console.log(localForgeSSPConfig);
    storedLocalForgeSSPConfig = JSON.parse(localForgeSSPConfig);
  }
}

loadSSPConfig();

const ssp = {
  relay: 'relay.ssp.runonflux.io',
};

export function sspConfig() {
  return {
    relay: storedLocalForgeSSPConfig?.relay ?? ssp.relay,
  };
}

export function sspConfigOriginal() {
  return ssp;
}
