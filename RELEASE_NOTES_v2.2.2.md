# SSP Key v2.2.2

_Release date: 4 November 2026_

iOS-only fix for v2.2.1. Android stays on v2.2.1.

## Fixed

- **SSP Key opens on iOS 27 again.** Builds made with the iOS 27 SDK must use
  the UIScene app lifecycle, and iOS 27 stops apps that don't at launch. SSP
  Key now creates its window from a scene delegate, so it starts normally.
