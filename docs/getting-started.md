# Getting Started

## Prerequisites

- Node.js 18 or newer
- npm
- Chrome for extension development
- Xcode or Android Studio for native mobile development

## Install

Install root dependencies:

```bash
npm install
```

Install mobile dependencies when working on the Expo app:

```bash
cd mobile-wallet
npm install
```

## CLI

Run the TypeScript source directly:

```bash
npm run dev
```

Build and run compiled JavaScript:

```bash
npm start
```

`npm start` runs `npm run build` before `node dist/index.js`.

## Chrome Extension

Build the extension:

```bash
npm run build:extension
```

Load `dist-extension/` as an unpacked extension in `chrome://extensions/`.
During development, run:

```bash
npm run watch:extension
```

Reload the extension from `chrome://extensions/` after each rebuild.

## Mobile App

Run commands from `mobile-wallet/`:

```bash
npm start
npm run ios
npm run android
```

Native crypto uses `react-native-quick-crypto`, so wallet unlock flows require a
development build. Expo Go is useful only for limited UI work.

## Environment

You don't have to configure anything up front: on first launch each app walks
you through entering an Alchemy API key (validated live) or signing up at
[dashboard.alchemy.com](https://dashboard.alchemy.com/). The CLI writes the
key to `.env`; the extension stores it in `chrome.storage.local`; mobile
stores it in the OS keychain. See
[How Simple Wallet uses Alchemy](./alchemy.md#entering-the-key-at-runtime).

To configure via files instead: copy `.env.example` to `.env` for local CLI
development. Extension build-time variables must use the `VITE_` prefix.
Mobile public build variables use the `EXPO_PUBLIC_` prefix where supported
by `mobile-wallet/app.config.js`.

The primary key is `ALCHEMY_API_KEY` and its platform variants:

- `ALCHEMY_API_KEY`: CLI and Node contexts
- `VITE_ALCHEMY_API_KEY`: extension build
- `EXPO_PUBLIC_ALCHEMY_API_KEY`: mobile app config

See [external APIs and environment variables](./external-apis-and-env.md) for
the full API inventory.
