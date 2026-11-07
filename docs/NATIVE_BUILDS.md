# Native builds

No native iOS or Android build has been made from this repository. The only check that has run is `expo export`, which produces JavaScript bundles and proves nothing about a native build.

## Run in development

```bash
cd apps/mobile
pnpm start            # Expo dev server
pnpm android          # needs Android Studio and an emulator or device
pnpm ios              # needs macOS with Xcode
```

The app talks to the local dev gateway. Point it at an address the device can reach:

- iOS simulator: `EXPO_PUBLIC_GATEWAY_URL=http://localhost:8787`
- Android emulator: `EXPO_PUBLIC_GATEWAY_URL=http://10.0.2.2:8787`
- Physical device: the computer's LAN address, and add the Expo dev origin to `GATEWAY_ALLOWED_ORIGINS` if needed.

The app uses `expo-secure-store` and `expo-crypto`, both included in Expo Go for SDK 52, so Expo Go works for a first look. A development build is the closer match to production.

## Development build with EAS (not yet configured)

1. Create an Expo account and run `npx eas-cli login`.
2. In `apps/mobile`, run `npx eas-cli build:configure`. This writes `eas.json`; commit it.
3. Replace the placeholder bundle identifiers in `app.json` (`org.openseason.dev`) with ones you own.
4. Build: `npx eas-cli build --profile development --platform ios` (needs an Apple Developer account) or `--platform android`.
5. Install the build on a device and run `pnpm start --dev-client`.

## Internal distribution

- iOS: an EAS `preview` profile with `"distribution": "internal"` and registered device UDIDs, or TestFlight internal testing.
- Android: an EAS `preview` profile that builds an APK, or a Play Console internal testing track.

## Not done, and needs separate authorization

- No store submission (`eas submit`), store listing or review.
- No push notification credentials (APNs key, FCM project).
- No production gateway or hosted Supabase URL for the app to use.
