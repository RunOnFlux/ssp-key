# SSP Key v2.2.2

_Release date: 4 November 2026_

Fix release for v2.2.1, on Android and iOS.

## Fixed

- **Sending on Ethereum and other EVM chains works again.** In v2.2.1,
  approving an EVM send in SSP Key failed with "Signature from unknown
  signer" and nothing was broadcast. SSP Key now records its signature
  under the correct signer address. Android and iOS.
- **iOS: SSP Key opens on iOS 27 again.** Builds made with the iOS 27 SDK must use
  the UIScene app lifecycle, and iOS 27 stops apps that don't at launch. SSP
  Key now creates its window from a scene delegate, so it starts normally.
