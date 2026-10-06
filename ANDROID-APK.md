# Android APK for demonstration

The `preview` EAS profile produces a signed, standalone APK with the app's JavaScript included. It opens without Expo Go, Metro, Android Studio or a running PC. Internet is still needed for Convex, map tiles and photo uploads.

- App name: Melange; Android package: `com.joel61.melangemobile`.
- Existing Expo project: `@joel61/melange-mobile` (`33fea92d-6ddd-44e3-a5cf-940f36d671b7`).
- Backend: the existing `agile-capybara-94` Convex development deployment. No backend deployment or production migration is performed by building the APK.
- Maps: Leaflet/OpenStreetMap in WebView, including green runner dots, blue optional buyer GPS and saved orange destination pins. The preview omits the unused Mapbox native SDK and plugin. Configured Mapbox builds remain supported separately.
- The public Convex URLs are supplied explicitly by `eas.json`; local environment files and credentials are excluded from the upload.
- Android signing credentials are managed by EAS. Do not expose them or replace the signing key when creating updates.

From this app directory, build another APK:

```powershell
eas build --platform android --profile preview
```

Use the finished build's install/download link on an Android phone, download the APK and allow installation from that browser if Android asks. Open **Melange** and sign in with an existing buyer or runner account. Updated frontend code requires a new APK build; changes to this cloud backend do not require leaving a local backend terminal open.

Building an APK does not configure Firebase/FCM credentials or verify push delivery. Those remain separate from ordinary in-app updates. Real-device login, maps, GPS, photos and delivery flow still require a phone walkthrough.

## Validation — 2026-10-05

382 tests across 42 files and frontend/backend TypeScript checks passed. The Android preview bundle compiled to Hermes bytecode in `dist/apk-preview-check`. Preview config resolves to the existing Expo project and excludes the Mapbox plugin; native autolinking excludes Mapbox while retaining WebView and react-native-maps.

Cloud build submitted: [3151caad-44c7-404d-b3e1-0850099625a6](https://expo.dev/accounts/joel61/projects/melange-mobile/builds/3151caad-44c7-404d-b3e1-0850099625a6), version 1.0.0 (1), APK/internal distribution. Latest check at 15:49 UTC on 2026-10-05: `IN_QUEUE`, no log files or APK artifact yet, and no queue estimate returned. The remote build continues independently of the chat or local terminal. Native compilation success and device installation have not been verified. Download the APK from that page only after it reports a successful finished build.
