# SSP Key v2.3.0

_Release date: 24 November 2026_

A feature and performance release for v2.2.3, on Android and iOS. Update SSP Wallet to v2.3.0 as well.

## Improved

- **Much faster vault approvals and EVM signing.** Verifying an enterprise vault and signing on Ethereum and other EVM chains could take several seconds, longest on Android and for larger vaults. The signing math now uses a faster library: about ten times faster for the same result. A 3-of-4 vault check drops from several seconds to under a second.
- **No more frozen screen.** A vault request now opens right away with "Verifying vault…" while SSP Key checks it. Nothing can be approved until the check has finished.

## New

- **Zcash TEX addresses shown as entered.** When you send ZEC to a TEX address (`tex1…`, ZIP 320) from SSP Wallet, SSP Key shows that `tex1…` address after checking on the phone that it matches the transaction, instead of its `t1…` form. If it doesn't match, SSP Key refuses the request. Enterprise vault payments to TEX addresses are shown the same way.

## Fixed

- **A readable reason when the network rejects a transaction.** Instead of "Request failed with status code 400", SSP Key now shows the network's own reason and confirms that nothing was sent.
