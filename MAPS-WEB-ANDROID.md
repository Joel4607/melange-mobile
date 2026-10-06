# Web maps and Expo Go compatibility

Updated 2026-10-01. Development backend synced at 22:13:53 UTC; 379 tests across 41 files and frontend/backend TypeScript pass. Android, iOS and web exports pass in `dist/map-pins-check` (30 static web routes). Live browser/phone rehearsal remains pending, explicitly left to Joel. See [LOCATION-ACCOUNTABILITY.md](LOCATION-ACCOUNTABILITY.md).

## Current renderers

Android APK packaging update, 2026-10-05: the standalone `preview` profile also uses Leaflet in WebView and excludes the unused Mapbox native SDK. Standalone builds without a public Mapbox token fall back to this compatibility renderer. Configured custom builds may still use Mapbox. See [ANDROID-APK.md](ANDROID-APK.md).

- Web: Leaflet 1.9.4 in an iframe. Android Expo Go: the same Leaflet document in a WebView. iPhone Expo Go: Apple Maps through react-native-maps, with standard green runner pins and blue buyer pins. Tracking, shared-route and pin-selection maps offer **Map blank? Use OpenStreetMap instead**; switching keeps the same coordinates and picking behavior. This fallback avoids depending on Apple tile loading for a demonstration. Custom builds retain Mapbox.
- Saved pickup/delivery pins remain orange. As requested on 2026-10-01, an assigned buyer may explicitly choose **Share my live location** in errand details. Their current position appears as a separate blue pin for themselves and their assigned runner, including independently for each shared-run buyer. Other buyers cannot see it. Sharing stops on page exit, native backgrounding, delivery/cancellation, revocation or a 30-second expired GPS lease. Saved route pins and tracking obligations remain independent.
- Leaflet uses a centered green runner dot instead of a walking image, updated in place as readings arrive. Apple Maps uses its standard green pin, avoiding the custom image dependency. Custom Mapbox builds keep their registered runner symbol. Stale styling, zoom/pan, route framing/recenter and map-click selection remain. Missing pins retain written-address navigation.
- The iframe/WebView receives updates without map reloads and never requests GPS itself. Frame/channel and picking validation, pinned CDN assets with integrity checks, safe text labels and visible OpenStreetMap attribution remain.
- The fresh-position feed rejects old capture timestamps and requests new provider fixes when stationary watchers do not emit. Browser requests use maximumAge=0. Session/watch cancellation fences late async results.
- The web bundle was inspected: Leaflet/saved-pin controls are present and native RNMBX/RNCWebView signatures are absent. This is compilation inspection, not proof of rendered phone tiles.

## Rehearsal

Run separate Expo web ports 8081/8082/8083 as documented in LOCATION-ACCOUNTABILITY.md. Reload updated clients before enabling the development accountability flag. Use separate existing runner and buyer accounts.

1. Confirm saved pickup/delivery pins manually without buyer GPS permission. Nearby-runner search may optionally use buyer GPS; it is not broadcast to runners.
   Separately, after assignment, test the optional live-sharing button in the buyer’s errand details. Check its blue pin on both accounts, stop sharing, and confirm removal. Repeat with two shared-run buyers and verify neither can read the other’s live position. On an iPhone showing blank Apple tiles, switch to OpenStreetMap and verify the same positions and saved stops. Reported GPS accuracy can be coarse; a fresh timestamp does not imply a precise position.
2. With a fresh available runner, approve a quote. New policy assignments automatically start private GPS after permission checks; older legacy assignments keep manual sharing.
3. Pan/zoom and use Show runner and destination/Show route. Check both distinct and coincident markers, timestamp and paused styling; recovery requires sustained fresh GPS, not just marker motion.
4. Switch tabs and reload the runner page. Browser suspension may interrupt readings; server deadlines must still update the connected buyer’s state.
5. Complete the shared four-stop route; confirm one buyer’s delivery ends only their access while the other receives the same session.
6. Repeat marker framing and permissions on physical Android/iPhone Expo Go. These checks have not been performed by the agent.

## Limits and historical findings

Online tiles/CDN require internet; no offline download or prefetch is implemented. Public OSM tiles serve this small demonstration, not an unlimited production SLA. Tile requests reveal the viewed geographic area; private messages, credentials and buyer identities are not put in tile URLs.

The original Android screenshot showed a black Google map with its logo. The exact device/native cause was not established; the Expo Go path was replaced with Leaflet rather than attributing it to a guessed API key. Original web components were coordinate placeholders. Previous Show both people/live buyer-sharing instructions are retired.

Web/Expo Go are foreground demonstrations. Each localhost origin has its own runner location permission; the PC supplies its own reported position. Stationary fresh coordinates are valid. Native push and custom native SDK/device compatibility remain unverified.

Historical 2026-09-28 checks: 24 targeted tests and all-platform exports passed in `dist/maps-web-android-check`; no browser/device rendering walkthrough was completed then. The current 352-test integration result supersedes that count without claiming device verification.
