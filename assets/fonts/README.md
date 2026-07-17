# Inter Fonts — Canonical Source Files

These are the canonical Inter v4.1 static TTFs (Regular, Medium, SemiBold, Bold) used by SSP Key.

## How they are wired into each platform

- **iOS**: linked manually — listed in `ios/SSPKey/Info.plist` under `UIAppFonts` and referenced
  as plain file resources in `ios/SSPKey.xcodeproj/project.pbxproj` (paths point at this directory).
- **Android**: NOT sourced from here at build time. Android uses the XML font family at
  `android/app/src/main/res/font/inter.xml` (with `inter_*.ttf` copies in the same directory),
  registered in `MainApplication.kt` via `ReactFontManager.addCustomFont(this, "Inter", R.font.inter)`.

## react-native-asset is deliberately NOT used

There is no `assets` entry in `react-native.config.js` on purpose. react-native-asset used to copy
these TTFs into `android/app/src/main/assets/fonts/`, duplicating the `res/font/` copies (~1.6 MB of
dead weight in the APK — Android resolves the `Inter` family exclusively through `res/font/inter.xml`).

Do not re-add an `assets` config or run `npx react-native-asset` — it would reintroduce the
duplicates. This directory exists to document provenance and to serve as the source for the iOS
resource references and any future re-generation of the Android `res/font` copies.
