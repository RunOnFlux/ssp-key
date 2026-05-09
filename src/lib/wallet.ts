import utxolib from '@runonflux/utxo-lib';
import * as aaSchnorrMultisig from '@runonflux/aa-schnorr-multisig-sdk';
import { Buffer } from 'buffer';
import { HDKey } from '@scure/bip32';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { toCashAddress } from 'bchaddrjs';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import {
  deriveMultisigAddress as deriveSolanaMultisigAddress,
  deriveVaultAddress as deriveSolanaVaultAddress,
  createInitializationMessage,
} from '@runonflux/solana-multisig';
import {
  keyPair,
  minHDKey,
  multisig,
  xPrivXpub,
  cryptos,
  publicPrivateNonce,
} from '../types';
import { blockchains } from '@storage/blockchains';

function getSolanaProgramId(chain: keyof cryptos): PublicKey {
  const id = blockchains[chain].programId;
  if (!id) {
    throw new Error(`Chain ${chain} has no programId in spec`);
  }
  return new PublicKey(id);
}

export function getLibId(chain: keyof cryptos): string {
  return blockchains[chain].libid;
}

export function getScriptType(type: string): number {
  switch (type) {
    case 'p2sh':
      return 0;
    case 'p2sh-p2wsh':
      return 1;
    case 'p2wsh':
      return 2;
    default:
      return 0;
  }
}

function generatexPubxPriv(
  mnemonic: string,
  bip = 48,
  coin: number,
  account = 0,
  type = 'p2sh',
  chain: keyof cryptos,
): xPrivXpub {
  const scriptType = getScriptType(type);

  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const bipParams = blockchains[chain].bip32;
  const masterKey = HDKey.fromMasterSeed(seed, bipParams);
  const externalChain = masterKey.derive(
    `m/${bip}'/${coin}'/${account}'/${scriptType}'`,
  );
  return externalChain.toJSON();
}

// generate random mnemonic provided strength
export function generateMnemonic(strength: 128 | 256 = 256): string {
  return bip39.generateMnemonic(wordlist, strength);
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic, wordlist);
}

// returns xpub of hardened derivation path for a particular coin
export function getMasterXpub(
  mnemonic: string,
  bip = 48,
  coin: number,
  account = 0,
  type = 'p2sh',
  chain: keyof cryptos,
): string {
  const xPubxPriv = generatexPubxPriv(
    mnemonic,
    bip,
    coin,
    account,
    type,
    chain,
  );
  return xPubxPriv.xpub;
}

// returns xpriv of hardened derivation path for a particular coin
export function getMasterXpriv(
  mnemonic: string,
  bip = 48,
  coin: number,
  account = 0,
  type = 'p2sh',
  chain: keyof cryptos,
): string {
  const xPubxPriv = generatexPubxPriv(
    mnemonic,
    bip,
    coin,
    account,
    type,
    chain,
  );
  return xPubxPriv.xpriv;
}

// given xpubs of two parties, generate multisig address and its redeem script
export function generateMultisigAddress(
  xpub1: string,
  xpub2: string,
  typeIndex: 0 | 1 | 10, // normal, change, internal identity
  addressIndex: number,
  chain: keyof cryptos,
): multisig {
  if (blockchains[chain].chainType === 'evm') {
    return generateMultisigAddressEVM(
      xpub1,
      xpub2,
      typeIndex,
      addressIndex,
      chain,
    );
  }
  if (blockchains[chain].chainType === 'sol') {
    // For Solana, xpub1/xpub2 are JSON-stringified arrays of 20 base58
    // Ed25519 leaf pubkeys. Look up the pubkey for the requested index
    // and derive the vault PDA via the multisig SDK.
    let walletPubkeys: string[];
    let keyPubkeys: string[];
    try {
      walletPubkeys = JSON.parse(xpub1) as string[];
      keyPubkeys = JSON.parse(xpub2) as string[];
    } catch {
      throw new Error(
        'generateMultisigAddress: sol xpub fields are not JSON arrays',
      );
    }
    if (
      !Array.isArray(walletPubkeys) ||
      !Array.isArray(keyPubkeys) ||
      walletPubkeys.length !== 20 ||
      keyPubkeys.length !== 20
    ) {
      throw new Error('generateMultisigAddress: sol pubkey arrays malformed');
    }
    const idx = typeIndex === 10 ? 0 : addressIndex;
    if (idx < 0 || idx >= 20) {
      throw new Error(
        `generateMultisigAddress: sol address index ${idx} out of range`,
      );
    }
    return generateMultisigAddressSOL(
      walletPubkeys[idx],
      keyPubkeys[idx],
      0, // vaultIndex — SSP uses single vault per multisig
      chain,
    );
  }
  const libID = getLibId(chain);
  const network = utxolib.networks[libID];
  const bipParams = blockchains[chain].bip32;
  const type = blockchains[chain].scriptType;
  const networkBipParams = utxolib.networks[libID].bip32;
  const cashAddrPrefix = blockchains[chain].cashaddr;
  let externalChain1, externalChain2;
  try {
    externalChain1 = HDKey.fromExtendedKey(xpub1, bipParams);
  } catch (e) {
    console.log(e);
    externalChain1 = HDKey.fromExtendedKey(xpub1, networkBipParams);
  }
  try {
    externalChain2 = HDKey.fromExtendedKey(xpub2, bipParams);
  } catch (e) {
    console.log(e);
    externalChain2 = HDKey.fromExtendedKey(xpub2, networkBipParams);
  }

  const externalAddress1 = externalChain1
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);
  const externalAddress2: HDKey = externalChain2
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);

  const publicKey1 = externalAddress1.publicKey;
  const publicKey2 = externalAddress2.publicKey;

  if (!publicKey1 || !publicKey2) {
    throw new Error('Failed to derive public keys from extended keys');
  }

  const pubKeyBuffer1 = Buffer.from(publicKey1).toString('hex');
  const pubKeyBuffer2 = Buffer.from(publicKey2).toString('hex');

  const sortedPublicKeys: string[] = [pubKeyBuffer1, pubKeyBuffer2].sort();
  const publicKeysBuffer: Buffer[] = sortedPublicKeys.map((hex: string) =>
    Buffer.from(hex, 'hex'),
  );

  if (type === 'p2wsh') {
    const witnessScript = utxolib.script.multisig.output.encode(
      2,
      publicKeysBuffer,
    );
    const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
      utxolib.crypto.sha256(witnessScript),
    );
    let address = utxolib.address.fromOutputScript(scriptPubKey, network);
    if (cashAddrPrefix) {
      address = toCashAddress(address);
    }
    const witnessScriptHex: string = Buffer.from(witnessScript).toString('hex');
    return {
      address,
      witnessScript: witnessScriptHex,
    };
  } else if (type === 'p2sh-p2wsh') {
    const witnessScript = utxolib.script.multisig.output.encode(
      2,
      publicKeysBuffer,
    );
    const redeemScript = utxolib.script.witnessScriptHash.output.encode(
      utxolib.crypto.sha256(witnessScript),
    );
    const scriptPubKey = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(redeemScript),
    );
    let address = utxolib.address.fromOutputScript(scriptPubKey, network);
    const witnessScriptHex: string = Buffer.from(witnessScript).toString('hex');
    const redeemScriptHex: string = Buffer.from(redeemScript).toString('hex');
    if (cashAddrPrefix) {
      address = toCashAddress(address);
    }
    return {
      address,
      redeemScript: redeemScriptHex,
      witnessScript: witnessScriptHex,
    };
  } else {
    // p2sh
    const redeemScript: Uint8Array = utxolib.script.multisig.output.encode(
      2,
      publicKeysBuffer,
    );
    const scriptPubKey = utxolib.script.scriptHash.output.encode(
      utxolib.crypto.hash160(redeemScript),
    );

    let address: string = utxolib.address.fromOutputScript(
      scriptPubKey,
      network,
    );

    if (cashAddrPrefix) {
      address = toCashAddress(address);
    }

    const redeemScriptHex: string = Buffer.from(redeemScript).toString('hex');
    return {
      address,
      redeemScript: redeemScriptHex,
    };
  }
}

// given xpubs of two parties, generate multisig address. EVM chains
export function generateMultisigAddressEVM(
  xpub1: string,
  xpub2: string,
  typeIndex: 0 | 1 | 10, // normal, change, internal identity
  addressIndex: number,
  chain: keyof cryptos,
): multisig {
  const bipParams = blockchains[chain].bip32;
  const { accountSalt, factorySalt, factoryAddress, entrypointAddress } =
    blockchains[chain];
  const externalChain1 = HDKey.fromExtendedKey(xpub1, bipParams);
  const externalChain2 = HDKey.fromExtendedKey(xpub2, bipParams);

  const externalAddress1 = externalChain1
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);
  const externalAddress2: HDKey = externalChain2
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);

  // Uint8Array(32)
  const publicKey1 = externalAddress1.publicKey;
  const publicKey2 = externalAddress2.publicKey;

  if (!publicKey1 || !publicKey2) {
    throw new Error('Failed to derive public keys from extended keys');
  }

  const pubKeyBuffer1 = Buffer.from(publicKey1);
  const pubKeyBuffer2 = Buffer.from(publicKey2);

  const keyPubKey1 = new aaSchnorrMultisig.types.Key(pubKeyBuffer1);
  const keyPubKey2 = new aaSchnorrMultisig.types.Key(pubKeyBuffer2);

  const publicKeys = [keyPubKey1, keyPubKey2];

  const combinedAddresses =
    aaSchnorrMultisig.helpers.SchnorrHelpers.getAllCombinedAddrFromKeys(
      publicKeys,
      publicKeys.length,
    );

  const accountImplementationAddress =
    aaSchnorrMultisig.helpers.create2Helpers.predictAccountImplementationAddrOffchain(
      factorySalt,
      factoryAddress,
      entrypointAddress,
    );

  const address =
    aaSchnorrMultisig.helpers.create2Helpers.predictAccountAddrOffchain(
      factoryAddress,
      accountImplementationAddress,
      combinedAddresses,
      accountSalt,
    );

  return {
    address,
  };
}

// given xpriv of our party, generate keypair consisting of privateKey in and public key belonging to it
export function generateAddressKeypairEVM(
  xpriv: string,
  typeIndex: number, // 0: normal, 1: change, 10: identity, or vaultIndex for enterprise
  addressIndex: number,
  chain: keyof cryptos,
): keyPair {
  const bipParams = blockchains[chain].bip32;
  const externalChain = HDKey.fromExtendedKey(xpriv, bipParams);

  const externalAddress = externalChain
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);

  if (!externalAddress.publicKey || !externalAddress.privateKey) {
    throw new Error('Failed to derive keypair from extended private key');
  }

  const publicKey = Buffer.from(externalAddress.publicKey).toString('hex');
  const privateKey =
    '0x' + Buffer.from(externalAddress.privateKey).toString('hex');

  return { privKey: privateKey as `0x${string}`, pubKey: publicKey };
}

/**
 * Solana key derivation: BIP32 leaf private key bytes are used as the
 * Ed25519 seed. Keeps the HD tree unified — Ed25519 only enters at the leaf.
 *
 * Returns:
 *   privKey — 64-byte Ed25519 secret key (seed + public, hex)
 *   pubKey  — 32-byte Ed25519 public key, base58-encoded (Solana convention)
 */
export function generateAddressKeypairSOL(
  xpriv: string,
  typeIndex: number,
  addressIndex: number,
  chain: keyof cryptos,
): keyPair {
  const bipParams = blockchains[chain].bip32;
  const externalChain = HDKey.fromExtendedKey(xpriv, bipParams);

  const externalAddress = externalChain
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);

  if (!externalAddress.privateKey) {
    throw new Error(
      `generateAddressKeypairSOL: no private key derivable for ${chain}`,
    );
  }

  const ed25519Pair = nacl.sign.keyPair.fromSeed(externalAddress.privateKey);
  const pubKeyBase58 = bs58.encode(ed25519Pair.publicKey);
  const privKeyHex = Buffer.from(ed25519Pair.secretKey).toString('hex');

  return { privKey: privKeyHex, pubKey: pubKeyBase58 };
}

/**
 * Pre-derive an array of 20 leaf Ed25519 public keys (base58-encoded) for
 * a Solana chain. Exchanged via pairing.
 *
 * ⚠️  See ssp-wallet/src/lib/wallet.ts for the full coupling notes if you
 *    change this. TL;DR: the 20 mirrors several other call sites here and
 *    in ssp-relay; the sync QR fits at errorLevel H up to ~25 pubkeys.
 *    Past that, Key.tsx in ssp-wallet must drop to errorLevel L.
 */
export function generateSolanaPubkeyArray(
  xpriv: string,
  chain: keyof cryptos,
): string[] {
  const pubkeys: string[] = [];
  for (let i = 0; i < 20; i++) {
    const { pubKey } = generateAddressKeypairSOL(xpriv, 0, i, chain);
    pubkeys.push(pubKey);
  }
  return pubkeys;
}

/**
 * Compute the deposit address (vault PDA) for a 2-of-2 SSP multisig on
 * Solana, given both members' Ed25519 public keys (base58).
 */
export function generateMultisigAddressSOL(
  myEd25519PubkeyBase58: string,
  partnerEd25519PubkeyBase58: string,
  vaultIndex: number,
  chain: keyof cryptos,
): multisig {
  const programId = getSolanaProgramId(chain);
  const members = [
    new PublicKey(myEd25519PubkeyBase58),
    new PublicKey(partnerEd25519PubkeyBase58),
  ];
  const threshold = 2; // SSP is always 2-of-2 (wallet + key)
  const [multisigPda] = deriveSolanaMultisigAddress(
    members,
    threshold,
    programId,
  );
  const [vaultPda] = deriveSolanaVaultAddress(
    multisigPda,
    vaultIndex,
    programId,
  );
  return {
    address: vaultPda.toBase58(),
  };
}

/**
 * Sign the SSP Solana Multisig init message off-chain. Returns base64
 * Ed25519 signature. See ssp-wallet's wallet.ts for the message format.
 */
export function signSolanaInitMessage(
  privKeyHex: string,
  walletPubkeyBase58: string,
  keyPubkeyBase58: string,
): string {
  const members = [
    new PublicKey(walletPubkeyBase58),
    new PublicKey(keyPubkeyBase58),
  ];
  const threshold = 2;
  const message = createInitializationMessage(members, threshold);
  const secretKey = new Uint8Array(Buffer.from(privKeyHex, 'hex'));
  const signature = nacl.sign.detached(message, secretKey);
  return Buffer.from(signature).toString('base64');
}

// given xpriv of our party, generate keypair consisting of privateKey in WIF format and public key belonging to it
export function generateAddressKeypair(
  xpriv: string,
  typeIndex: number, // 0: normal, 1: change, 10: identity, or vaultIndex for enterprise
  addressIndex: number,
  chain: keyof cryptos,
): keyPair {
  const { chainType } = blockchains[chain];
  if (chainType === 'evm') {
    return generateAddressKeypairEVM(xpriv, typeIndex, addressIndex, chain);
  }
  if (chainType === 'sol') {
    return generateAddressKeypairSOL(xpriv, typeIndex, addressIndex, chain);
  }
  const libID = getLibId(chain);
  const bipParams = blockchains[chain].bip32;
  const networkBipParams = utxolib.networks[libID].bip32;
  let externalChain;
  let network = utxolib.networks[libID];
  try {
    externalChain = HDKey.fromExtendedKey(xpriv, bipParams);
    network = Object.assign({}, network, {
      bip32: bipParams,
    });
  } catch (e) {
    console.log(e);
    externalChain = HDKey.fromExtendedKey(xpriv, networkBipParams);
  }

  const externalAddress = externalChain
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);

  const derivedExternalAddress: minHDKey = utxolib.HDNode.fromBase58(
    // to get priv key in wif via lib
    externalAddress.toJSON().xpriv,
    network,
  );

  const privateKeyWIF: string = derivedExternalAddress.keyPair.toWIF();

  const publicKey = derivedExternalAddress.keyPair
    .getPublicKeyBuffer()
    .toString('hex'); // same as Buffer.from(externalAddress.pubKey).toString('hex);. Library does not expose keypair from just hex of private key, workaround

  return { privKey: privateKeyWIF, pubKey: publicKey };
}

// given xpub of our party, generate address of identity of xpub. INTERNAL SSP
export function generateInternalIdentityAddress(
  xpub: string,
  chain: keyof cryptos,
): string {
  const typeIndex = 10; // identity index
  const addressIndex = 0; // identity index

  const libID = getLibId(chain);
  const bipParams = blockchains[chain].bip32;
  const networkBipParams = utxolib.networks[libID].bip32;
  let externalChain;
  try {
    externalChain = HDKey.fromExtendedKey(xpub, bipParams);
  } catch (e) {
    console.log(e);
    externalChain = HDKey.fromExtendedKey(xpub, networkBipParams);
  }

  const externalAddress = externalChain
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);

  const publicKey = externalAddress.publicKey;

  if (!publicKey) {
    throw new Error('Failed to derive public key from extended public key');
  }

  const pubKeyBuffer = Buffer.from(publicKey);

  const network = utxolib.networks[libID];

  const genKeypair = utxolib.ECPair.fromPublicKeyBuffer(pubKeyBuffer, network);
  const address = genKeypair.getAddress();

  return address;
}

export function generatePublicNonce(): publicPrivateNonce {
  // generate public nonce for evm
  const publicNonce = aaSchnorrMultisig.core._generateNonce();

  const ppNonce = {
    k: publicNonce.k.toString('hex'),
    kTwo: publicNonce.kTwo.toString('hex'),
    kPublic: publicNonce.kPublic.toString('hex'),
    kTwoPublic: publicNonce.kTwoPublic.toString('hex'),
  };
  return ppNonce;
}

export function deriveEVMPublicKey(
  xpub2: string,
  typeIndex: number, // 0: normal, 1: change, 10: identity, or vaultIndex for enterprise
  addressIndex: number,
  chain: keyof cryptos,
): string {
  const bipParams = blockchains[chain].bip32;
  const externalChain2 = HDKey.fromExtendedKey(xpub2, bipParams);

  const externalAddress2: HDKey = externalChain2
    .deriveChild(typeIndex)
    .deriveChild(addressIndex);

  const publicKey2 = externalAddress2.publicKey;

  if (!publicKey2) {
    throw new Error('Failed to derive public key from extended public key');
  }

  const pubKeyBuffer2 = Buffer.from(publicKey2);

  return pubKeyBuffer2.toString('hex');
}

/**
 * Convert a WIF private key to hex format.
 *
 * @param privateKeyWIF - Private key in WIF format
 * @param chain - The blockchain
 * @returns Private key in hex format
 */
export function wifToPrivateKey(
  privateKeyWIF: string,
  chain: keyof cryptos,
): string {
  const libID = getLibId(chain);
  const network = utxolib.networks[libID];
  const keyPair = utxolib.ECPair.fromWIF(privateKeyWIF, network);
  return (keyPair as any).getPrivateKeyBuffer().toString('hex');
}
