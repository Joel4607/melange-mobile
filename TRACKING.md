> Release 2026-09-30: development backend deployed and automated integration passes (352 tests, both type checks, Android/iOS/web exports). New enforcement remains off until updated clients are reloaded and the development flag is enabled. Browser/phone rehearsal is explicitly left to Joel. See [LOCATION-ACCOUNTABILITY.md](LOCATION-ACCOUNTABILITY.md).

# Runner maps: setup and operation

The existing private errand tracker and demo are preserved. Mapbox custom builds use a registered walking-person PNG, one GeoJSON ShapeSource and a SymbolLayer. iPhone Expo Go uses standard colored Apple Maps pins with an optional OpenStreetMap fallback. Android Expo Go and web use a centered green runner dot on Leaflet in a WebView/iframe. Buyers may explicitly share their live GPS with their assigned runner; their blue pin stays separate from orange saved destinations. Nearby discovery, private delivery tracking and Errand Share have interactive web maps. See MAPS-WEB-ANDROID.md for setup, limitations and verification.

## Try the existing demo now

When explicitly enabled on the development backend, the legacy demo-only tracker can play a labelled sample route. Real assigned errands use actual GPS; new policy assignments use automatic private publishing after activation. Start Expo Go with `npx expo start --go --clear`. The runner marker follows the illustrative route. Demo coordinates never enter nearby-runner discovery.

Home > Runners near you > Use my location requests foreground permission. Location watching and the nearby subscription stop when you leave Home or background the app. An empty map is expected until a real runner is enrolled and publishing.

## Enable Mapbox on the Pixel

1. Create/copy a **public** Mapbox access token at https://console.mapbox.com/account/access-tokens/.
2. Add this line to the existing `.env.local`, leaving the Convex values intact:

   ```dotenv
   EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_public_token
   ```

   Never put a secret `sk.*` token into an `EXPO_PUBLIC_*` variable.
3. Mapbox requires a custom native build; it is not included in Expo Go. The packages and Expo config plugins are already installed.
4. With the Android SDK/JDK environment installed, USB debugging enabled, and the Pixel connected, run from this app directory:

   ```powershell
   npx expo run:android --device
   ```

   Expo may ask you to choose an Android application ID on the first native build. Pick the project's permanent ID. This compiles native dependencies and installs the development app. No Mac/Xcode is needed for Android.
5. For later JavaScript-only work, start Metro with:

   ```powershell
   npx expo start --dev-client --clear
   ```

If you prefer to avoid installing Android Studio/SDK locally, use an EAS cloud development build. Create an Expo project with `npx eas-cli@latest build:configure`, then use a development profile with `developmentClient: true` and `distribution: "internal"`, and run `npx eas-cli@latest build --platform android --profile development`. Install the resulting APK. Configure EXPO_PUBLIC_CONVEX_URL and EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN in the EAS development environment too if bundling remotely; ignored `.env.local` files are not uploaded. EAS may have queues or charges depending on your plan. No build has been submitted by this change.

Official setup references: [Mapbox](https://rnmapbox.github.io/docs/install), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [Expo 57 location](https://docs.expo.dev/versions/v57.0.0/sdk/location/).

## Backend contract

- `errandRunners` keeps one latest position per authenticated runner. Resolution 8 / gridDisk radius 1 covers the user's cell and adjacent cells, not an exact circular distance.
- Required `by_h3Index` index is present. Queries use the additional compound `by_h3Index_and_status` index to skip offline/busy records during the index scan.
- `runners.updateLocation({lat, lng, capturedAt, status})` derives runnerId/name from authentication. It rejects customers without trusted runner access, invalid coordinates, and outdated/out-of-order readings. The existing fresh-position feed rejects cached timestamps and polls for a new provider fix when the watcher has not emitted one recently. Availability and private sessions remain separate.
- `runners.setOffline({})` immediately removes availability. Call it when the runner opts out or stops sharing. The server also expires a GPS lease after 45 seconds without a new accepted reading (subject to scheduler latency). Scheduled writes update subscribers; queries do not depend on a stale Date.now() filter.
- This is runner availability tied to GPS freshness, not a multi-session online/chat presence system.
- Runner accounts enroll through the runner signup and profile flow. Internal `runners:setRunnerAccess` remains available for maintenance or revocation; ordinary buyer accounts cannot enroll as runners.
- Accepted errands now have private foreground GPS sharing: `locations.startRunner({id, sessionId})`, `locations.publishRunner({id, sessionId, point})`, and `locations.stopRunner({id, sessionId})`. Only the assigned runner can publish. Session checks prevent delayed updates or cleanup from interfering with a newer session. The server expires live status after 30 seconds without a fresh reading.
- The runner workspace keeps sharing active across tabs and chat. Web and Expo Go sharing can pause on browser/OS suspension, phone lock or connection loss. Development builds retain the existing opt-in background path with its documented permission/credential limits. Legacy errands require a manual start. Once the accountability rollout is enabled, new assignments start private sharing automatically after permission checks.
- Runner acceptance immediately sets existing nearby availability to busy; delivery sets it offline. The private tracker does not publish online availability. Go online/Go offline controls manage availability. Active sharing never re-enables public discovery by itself.
- Location queries require authentication. Online runner coordinates are visible to signed-in customers querying nearby cells. Private assigned-runner locations remain restricted to the errand's owner and assigned runner.
- The query returns all online runners in the requested H3 ring. A larger deployment should add viewport pagination/clustering and application-level abuse limits before advertising unrestricted city-wide discovery; exceptionally dense results remain subject to Convex transaction limits.

## Main source files

- `convex/schema.ts`: tables and indexes.
- `convex/runners.ts`: enrollment, updates, nearby query and expiry.
- `convex/locations.ts`: existing private tracking; hides busy runners from discovery.
- `src/components/RunnerMap.tsx`: reactive nearby query and GeoJSON conversion.
- `src/components/maps/map-surface-mapbox.tsx`: Images, ShapeSource and SymbolLayer.
- `src/components/runner-map.tsx`: existing private tracker bridge and smooth motion.
- `src/components/nearby-runners.tsx`: foreground location lifecycle and error handling.
- `src/components/runner-location-sharing.tsx`: assigned-runner GPS sharing, permissions and lifecycle.
- `src/components/runner-progress.tsx`: confirmed pickup and delivery controls.
- `assets/images/runner-walk-figure.png`: original local walking figure asset.

## Checks

Run `npm test` and `npm run typecheck`. An Android JS export checks module resolution but does not prove native SDK compatibility. Complete a development build and device smoke test before release: permission denied, permission accepted, background/resume, empty nearby list, live updates, Mapbox token/network failure, and the existing simulated route. Native Mapbox rendering is not yet verified on the Pixel.
