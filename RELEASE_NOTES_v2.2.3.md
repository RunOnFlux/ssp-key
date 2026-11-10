# SSP Key v2.2.3

_Release date: 10 November 2026_

A fix release for v2.2.2, on Android and iOS. Ship it together with SSP Wallet v2.2.2: Zcash sends need both apps updated.

## Fixed

- **Zcash sends work again.** Since the Zcash NU7 network upgrade on 5 November 2026, the network only accepts version 5 transactions. SSP Key now checks and co-signs v5 transactions (ZIP 225 and ZIP 244), with the same checks as before: every input belongs to your wallet, values come from the network rather than the request, and the wallet's own signature is valid.
- **A clear explanation when public nonces are out of sync.** When SSP Wallet asks SSP Key to sign an EVM transaction with public nonces Key no longer holds, for example after a reinstall, Key used to show only "Public nonces do not match". It now explains that nothing was signed and that funds are safe, and shows how to fix it: in SSP Wallet, Settings › Advanced › Public Nonces › Sync Public Nonces.

## Improved

- **Faster transaction approval.** Signature checks use a faster library, the USD rate loads in parallel, and approvals with many inputs show their progress instead of an unchanging "Reading this transaction…".
