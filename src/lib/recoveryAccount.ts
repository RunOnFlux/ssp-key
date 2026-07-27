import { getMasterXpriv, getMasterXpub } from './wallet';
import { blockchains } from '@storage/blockchains';
import { cryptos } from '../types';

/**
 * Recovery account.
 *
 *   m/48'/coin'/99'/scriptType'          recovery account
 *   m/48'/coin'/99'/scriptType'/0/i      sk_r(i), released to the wallet
 *
 * Recovery is the only flow in which SSP Key hands a private key to the wallet,
 * so those keys live in their own hardened account. Nothing under it signs or
 * derives an address; its whole purpose is to hold keys that get released.
 *
 * 99' sits in the gap SSP leaves at the BIP-48 `account'` level: 0' is the
 * consumer account and 100'-99999' are enterprise org indices. `scriptType'`
 * keeps the chain's own value so this reuses the standard derivation with no
 * special case — the level carries no meaning for a key that is never an
 * address, and inventing a value there would need a bespoke helper on both
 * sides of the protocol.
 *
 * The final level is non-hardened by design: the wallet holds this account's
 * xpub, so it derives pk_r(i) for a fresh i on every envelope rebuild. That
 * makes the recovery key rotatable per envelope.
 */
export const RECOVERY_ACCOUNT_INDEX = 99;

/** Non-hardened `change` level. 0 = external, per BIP-48. */
export const RECOVERY_CHANGE_INDEX = 0;

export interface RecoveryAccountKeys {
  xpriv: string;
  xpub: string;
}

/**
 * Derive the recovery account keypair from the mnemonic. Called once at
 * setup/restore and once when provisioning an existing install; the recovery
 * request path uses the stored account key and never the mnemonic.
 */
export function deriveRecoveryAccount(
  mnemonic: string,
  identityChain: keyof cryptos,
): RecoveryAccountKeys {
  const blockchainConfig = blockchains[identityChain];
  const xpriv = getMasterXpriv(
    mnemonic,
    48,
    blockchainConfig.slip,
    RECOVERY_ACCOUNT_INDEX,
    blockchainConfig.scriptType,
    identityChain,
  );
  const xpub = getMasterXpub(
    mnemonic,
    48,
    blockchainConfig.slip,
    RECOVERY_ACCOUNT_INDEX,
    blockchainConfig.scriptType,
    identityChain,
  );
  return { xpriv, xpub };
}
