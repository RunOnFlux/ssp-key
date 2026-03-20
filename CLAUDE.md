# SSP Key

Mobile app (iOS/Android) holding the second private key for 2-of-2 multisig with SSP Wallet. Public, open source.

## Part of SSP Ecosystem

See `../CLAUDE.md` for full ecosystem overview. Key relationships:
- **SSP Key** (this) + **SSP Wallet** (browser ext) = 2-of-2 multisig WK Identity
- Communicates with **SSP Relay** (`relay.sspwallet.com`) via WebSocket
- Enterprise features handled by **ssp-relay-enterprise** (submodule in ssp-relay)
- **Do not work in** `ssp-walletOK` or `ssp-walletNodes` — those are deprecated archives

## Stack

- React Native 0.84 (NOT Expo — pure RN)
- React 19 + TypeScript 5.9
- Redux Toolkit + Redux Persist
- React Navigation (stack navigator)
- Crypto: ethers, viem, @alchemy/aa-core, react-native-keychain, MMKV
- Camera: react-native-vision-camera (QR scanning)
- Notifications: @notifee/react-native
- i18n with i18next
- Node.js 24+ required

## Commands

```bash
yarn start          # Metro bundler
yarn android        # Run on Android
yarn ios            # Run on iOS simulator
yarn ios:device     # Run on physical iOS device
yarn lint           # ESLint
yarn lint:fix       # ESLint auto-fix
yarn test           # Jest tests
yarn podinstall     # iOS CocoaPods install
yarn prettier --check .   # Format check (config in .prettierrc.js)
yarn prettier --write .   # Format fix
```

## Before Every Commit

All must pass — no exceptions:
1. `yarn lint` — no lint errors
2. `yarn prettier --check .` — properly formatted
3. `yarn test` — tests pass

## Key Rules

- **Always yarn**, never npm
- **Dependencies strictly locked** — exact versions only, no `^` or `~` in package.json
- **This is a PUBLIC repo** — no business logic, no analytics, no proprietary algorithms
- TypeScript strict mode, no `any` without justification
- Path aliases: `@/*` → `./src/*`

## Source Structure

```
src/
├── components/     # React components (28 dirs)
├── screens/        # Screen components (9 dirs)
├── navigators/     # Navigation config
├── lib/            # Utility libraries
├── store/          # Redux state
├── hooks/          # Custom hooks
├── contexts/       # React contexts
├── storage/        # Persistent storage
├── theme/          # Theming
├── translations/   # i18n
├── assets/         # Images, fonts, icons
└── types.d.ts      # Global type definitions
```
