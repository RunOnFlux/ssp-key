# SSP Key v2.0.0

A complete redesign of SSP Key on the new SSP design system, with the approval
moment rebuilt from the ground up. Same keys, same 2-of-2 self-custody, zero
migration: updating in place keeps your Key, pairing, and history exactly as
they were.

## New

- **Slide to approve** — every signature is a deliberate gesture. Release
  early and nothing happens.
- **Clearer approvals** — every request type shares one clean layout with
  plain-language summaries decoded on your device, never trusted from the
  network. Token approvals now warn loudly about unlimited allowances and
  collection-wide NFT operator grants, naming the spender.
- **Batch chain sync** — approve once to activate multiple chains for your
  wallet, with live progress.
- **Pairing verification code** — your Key shows the same 6 words as your
  wallet after pairing; matching words prove your pairing wasn't tampered
  with. Scan your wallet's code to verify automatically.
- **Real backup verification** — a quick word challenge replaces the
  "I backed it up" checkbox when creating a new key.
- **Signing history** — a local, encrypted, biometric-gated log of everything
  this Key has co-signed. Never leaves your device.
- **Privacy mode** — mask identities in your history at a tap.

## Changed

- Complete visual refresh: the new SSP brand (amber, Inter with true bold on
  Android, Lucide icons, the pillar mark), light and dark.
- Smaller app: unused icon libraries and duplicate assets removed (~6 MB).
- Motion respects your system's reduce-motion setting.

## Security

- No changes to signing, key derivation, seed handling, or encryption —
  verified by independent audit, including token-level proof that the large
  internal refactor changed zero behavior.
- All dependencies updated and exactly pinned; every fixable vulnerability
  resolved.
- Works with SSP Wallet v1 and v2 — update in any order.
