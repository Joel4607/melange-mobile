# Runner availability, handover photos and background location

## What is available

- **Dashboard → Available for errands → Go online** requests location access and advertises fresh GPS on the nearby-buyer map. **Go offline** removes availability and stops this device's watcher. Accepting a job ends the availability session. Go online again when ready for another job.
- **Active errand → Share my live location** shares GPS only with the assigned buyer. It ends at delivery. It does not advertise availability to other buyers.
- **Picked-up errand → Handover photo** takes/selects a photo, previews it, then saves it. A saved photo is required before **Mark delivered**. The photo is immutable after saving; check the preview first. The buyer can view it before confirming delivery and afterwards. Existing delivered jobs without a photo remain accessible.
- Both location controls offer **Keep sharing when the screen locks** in development builds. This setting is optional and requires background permission. Expo Go/web keep the foreground-only behavior.

## Android development build (Windows)

The JavaScript and native permission configuration are prepared, including an EAS `development` profile. No cloud build has been submitted, and no application ID or paid account has been created.

From this app directory, with Android SDK/JDK installed and USB debugging enabled:

```powershell
npx expo run:android --device
```

Expo may ask for your permanent Android application ID. Rebuild an existing development client too, because background permissions and TaskManager are native changes. Once installed:

```powershell
npx expo start --dev-client --clear
```

Alternatively, use an Expo/EAS account to configure a cloud build:

```powershell
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile development
```

Configure `EXPO_PUBLIC_CONVEX_URL` and `EXPO_PUBLIC_CONVEX_SITE_URL` in the EAS development environment; ignored `.env.local` is not uploaded. Install the resulting APK, then start Metro with `--dev-client`. EAS account limits/queues apply. iPhone background testing requires a signed iOS development build; Expo Go cannot test it.

## Location lifecycle and limits

Android uses a visible foreground-service notification. iOS uses its background location indicator. Background updates request approximately ten-second fixes, but delivery depends on the operating system, GPS, network and battery settings. Force-stopping the app ends updates. There is no claim that location continues after force-stop.

Only the latest location is stored. Server expiry marks stale private GPS paused after 30 seconds and availability offline after 45 seconds (subject to scheduler latency). Offline updates are not queued as a historical route. Reconnection uses fresh readings.

A background task stores its current authenticated session in device SecureStore, accessible after the first unlock. It does not retain a refresh token. The foreground app refreshes that credential while open. If the sign-in token expires during an extended background run, tracking stops; reopen the app and start sharing again. Task/session cleanup is scoped so a delayed stop cannot disable a newer session. Restarting the application clears old background registration and requires opting in again.

## Privacy and proof

Online coordinates are visible to signed-in nearby buyers. Private errand coordinates and handover photos are available only to the buyer and assigned runner through authorized queries. Photo download links are bearer URLs like existing chat images: someone with a copied URL can access that photo. Images are converted to JPEG, with longest side at most 1,920 pixels; the server validates supported image signatures and a 5 MB cap. Upload retries reuse a request ID and do not duplicate proof/storage records.

## Checks still required on a device

1. Expo Go: camera and gallery upload fixes, delivery confirmation, online/offline map visibility, handover photo and review.
2. Development build: deny/allow foreground and background permission; lock/unlock during an active job; switch to chat; observe buyer updates on another device.
3. Stop sharing, go offline, deliver, sign out and restart; verify the notification disappears and no new location arrives.
4. Disconnect/reconnect, force-stop and test an expired sign-in; check that stale GPS is not shown as live.

Automated tests and JavaScript exports do not replace these native permission/lifecycle tests.
