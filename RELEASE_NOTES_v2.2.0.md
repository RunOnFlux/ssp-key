# SSP Key v2.2.0

_Release date: 2 November 2026_

A security release that follows the October 2026 security review, released
together with SSP Wallet v2.2.0. Typed data signing needs both updated.

## Behaviour changes you will notice

- **Typed data (EIP-712) signing.** SSP Key can co-sign
  `eth_signTypedData_v3` / `_v4` requests from SSP Wallet. It shows the
  requesting domain, the contract, the type and every field, warns that typed
  data can authorise spending (token approvals / permits, trades, orders), and
  only offers approval after you confirm that. The digest is recomputed on
  the device from what is shown. Typed data for a different network is
  refused. Personal messages work as before.
- **Restoring a non-standard seed phrase.** A phrase that does not pass the
  BIP-39 check (words from another word list, or a wrong checksum) is no
  longer simply rejected: SSP Key explains what is non-standard and restores
  it only after you choose "Restore anyway". Phrases SSP creates are always
  standard.
- **Re-pairing asks first.** A pairing request that would replace the SSP
  Wallet already paired for a chain shows what would change and a new
  verification code, and needs a slide to confirm.
- **Pairing signs every synced chain.** SSP Key signs each chain it syncs so
  SSP Wallet can verify it came from this device.
- **Sign-in and critical enterprise actions are shown in full.** SSP
  Enterprise sign-ins show the site you are signing in at. Critical actions
  (ownership transfer, deleting an organisation, removing a member, changing
  the enterprise email, vault admin changes, freezing or archiving a vault)
  show the action, organisation, target and what it does. Messages that are
  not a valid SSP request, or not signed by your paired SSP Wallet, are
  refused.
- **First request for an enterprise vault asks you to confirm its signers.**
  SSP Key shows the vault's signing mode, threshold and every signer, and
  remembers the vault once you confirm. Later requests whose signers differ
  are refused. Confirmed vaults can be reset in Settings › Vault pins.
- **An outdated SSP Enterprise or SSP Wallet is refused** for vault signing
  with "Update required: vault descriptor missing".
- **Too many wrong passwords lock unlocking for a while.** The wait grows
  with each further wrong attempt.
- **Finishing security upgrade.** Some older installs re-encrypt their keys
  once after updating. Keep the app open while "Finishing security upgrade"
  is shown; your seed phrase is not affected.

## Security fixes

- Transactions are checked against the keys you hold before signing: UTXO
  inputs must belong to your 2-of-2 address, fees are computed on
  the device and capped, and EVM user operations have their hash recomputed
  on the device. Contract calls are never shown as plain sends, and unknown
  tokens are shown in raw units with an "unverified token" warning.
- Solana transactions that cannot be decoded are blocked. Approvals of an
  existing on-chain proposal are read from the network and shown in full.
- Transactions that pay several destinations list every destination.
- Enterprise vault requests are checked against the vault's signers and
  derivation path. A signing nonce is recorded as used before the signature
  leaves the device and is never reused.
- Every relay request is signed; if it cannot be signed, nothing is sent.
- The app-switcher snapshot is covered with an opaque screen, including over
  the seed phrase and password dialogs.
- iOS: keychain items move into the app's shared group so they keep working
  through the planned App Store ownership transfer. This runs automatically
  at launch. Please open SSP Key 2.2.0 at least once after updating.

**Full Changelog**: https://github.com/RunOnFlux/ssp-key/compare/v2.1.1...v2.2.0
