# Oink Android app (Trusted Web Activity)

The APK is a thin Trusted Web Activity around the deployed PWA. It contains no wallet code,
keys or API secrets: Chrome opens `https://<host>/app`, so custody, Bell signing and Seeker
wallets (Mobile Wallet Adapter) behave exactly as they do on the web. This is the packaging
path Solana Mobile documents for publishing PWAs to the dApp Store.

## Prerequisites (one-time, user-level, no sudo)

- **JDK 17**: Eclipse Temurin, extracted to `~/Library/Java/JavaVirtualMachines/`
  (`/usr/libexec/java_home -v 17` must find it).
- **Android SDK** in `~/Library/Android/sdk`: Google's command-line tools in
  `cmdline-tools/latest`, then
  `sdkmanager --licenses` and `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"`.
- `cd twa && bun install --frozen-lockfile`

## Build against the real domain

```bash
cd twa
export OINK_TWA_HOST=app.your-domain.com        # bare host, no https://
export OINK_KEYSTORE_PASSWORD=...   # from your password manager; one password (PKCS12)
export OINK_TWA_VERSION_CODE=2  OINK_TWA_VERSION_NAME=1.0.1  # bump on every upload
bun build-apk.ts                   # add --create-keystore only the very first time
```

Outputs:

- `twa/dist/oink-<host>-<version>.apk`: the signed release APK (gitignored).
- `public/.well-known/assetlinks.json`: package id plus the signing certificate's SHA-256.
  Commit and deploy it so `https://<host>/.well-known/assetlinks.json` serves it; without
  it, Android shows a URL bar (Custom Tab fallback) instead of a full-screen app.

Before the site is live you can build against a local production server by setting
`OINK_ICON_ORIGIN=http://localhost:3200` (icons and the web manifest are fetched at build time).

## The signing keystore

- It lives at `~/.oink/android/oink-release.keystore` (override with `OINK_KEYSTORE`),
  **outside the repository**. `.gitignore` also blocks `*.keystore` and `*.jks`, and the
  script refuses a keystore path inside the repo.
- Back it up and its passwords together (e.g. password manager plus an offline copy). If you
  lose it, you cannot ship updates to the same dApp Store listing. Never commit it, send it to
  CI logs or share it.
- The package id (`OINK_TWA_PACKAGE`, default `app.oink.wallet`) must never change after
  publishing.

## Verify

```bash
SDK=~/Library/Android/sdk/build-tools/35.0.0
$SDK/apksigner verify --print-certs twa/dist/*.apk
$SDK/aapt2 dump badging twa/dist/*.apk | head
adb install -r twa/dist/*.apk        # device or emulator
```

On a device, check that the app opens full-screen (proves assetlinks), sign-in works, a Bell
order can be signed, and "Pay with Seeker wallet" opens the wallet app (MWA).
