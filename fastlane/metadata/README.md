# Store listing metadata

Source of truth for the SSP Key store listings. Standard fastlane layout so it can be pushed with `fastlane supply` (Android) / `fastlane deliver` (iOS) later, or copy-pasted into the consoles manually.

| File | Store field | Limit |
| --- | --- | --- |
| `android/en-US/title.txt` | Play Store app name | 30 chars |
| `android/en-US/short_description.txt` | Play Store short description | 80 chars |
| `android/en-US/full_description.txt` | Play Store full description | 4000 chars |
| `en-US/name.txt` | App Store name | 30 chars |
| `en-US/subtitle.txt` | App Store subtitle | 30 chars |
| `en-US/promotional_text.txt` | App Store promotional text (editable without review) | 170 chars |
| `en-US/keywords.txt` | App Store keywords (comma-separated, no spaces needed) | 100 chars |
| `en-US/description.txt` | App Store description | 4000 chars |

Only English is maintained here; other locales are handled separately (Crowdin for in-app strings).

Screenshot assets live in `../screenshots/` (see its README for sizes and regeneration).
