# SSP Key v2.1.1

_Release date: 2 September 2026_

A hotfix for v2.1.0, released together with SSP Wallet v2.1.2. Update both to
restore Ethereum enterprise vault signing.

## Fixed

- **Ethereum enterprise vault proposals can be approved again.** Since
  v2.0.0 the Key rejected every Ethereum (and Sepolia) vault transaction
  with "the transaction does not match what was shown for approval". Nothing
  had been tampered with: the check that recomputes the transaction hash on
  the device was missing the Ethereum chain id and failed before it could
  compare anything. The chain id is now configured, and a test guards every
  EVM chain against the same gap.
- **A rejected vault request no longer burns a nonce.** The reserved signing
  nonce was removed from the Key before the request was verified, so each
  failed attempt cost a nonce and the retry failed with "nonces need to be
  synced". The nonce is now consumed only after verification passes, right
  before the signature is produced.
- **Syncing enterprise nonces no longer empties the pool.** Force sync used
  to purge every nonce on the relay before refilling, and the local wipe
  discarded nonces still reserved by pending proposals. Sync now reconciles
  against what the Key actually holds and only tops up what is missing.
- **A sent transaction is shown as sent.** After a transfer was signed,
  broadcast and confirmed, a failed status notification to the relay could
  still surface as "Request failed with status code 401". The confirmation
  screen with the transaction id now always appears, the relay call retries
  once with fresh authentication, and a failure there is only an
  informational notice.
- **Fetching pending requests can no longer hang.** The relay lookup for
  pending actions is bounded by a timeout.
