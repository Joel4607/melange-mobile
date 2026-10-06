# Mobile project memory

Updated: 2026-09-22. Scope: final-year project demonstration.

## Map markers and optional buyer GPS — 2026-10-01

Requested update: Leaflet runners use centered green dots; iPhone Expo Go uses standard green runner and blue buyer pins. iOS tracking, shared-route and destination-picker maps provide a manual OpenStreetMap fallback for blank Apple tiles. Buyers can explicitly share live GPS during an assigned active errand; access is limited to that buyer and their assigned enabled runner, with separate consent and records for each shared-run member. Saved destination pins remain orange and authoritative for pairing/stop order. A separate new API/table preserves denial of retired clients and old stored buyer positions. Leaving the buyer page, backgrounding native apps, terminal status, revocation and 30-second expiry stop sharing or revoke access. See MAPS-WEB-ANDROID.md. Device walkthrough pending.

## Native pull-to-refresh — 2026-10-01

Buyer and runner pages using the shared page container now support pulling down from the top on Android/iOS, including short pages. The indicator waits for a unique Convex query to acknowledge the current consistent subscription snapshot. Refresh preserves form entries, pagination and GPS sessions; failures show a retry message and stop after 12 seconds. Leaving the page cancels the temporary subscription. Browser refresh stays with the browser, and the separate live chat list retains its existing behavior. No records are modified by refresh.

Validation: 369 tests across 38 files, frontend/backend type checks and Android/iOS/web exports passed. Development backend synced at 21:39:22 UTC. Reload Expo Go and pull down on both dashboards; repeat without internet to check the message and recovery. The physical gesture walkthrough remains pending.

## Location accountability progress — 2026-09-30

Tasks 1–6 of the saved location plan are implemented: pure policy, private saved destination maps, persistent backend tracking obligations, buyer-authorized pickup with separate shared approvals, automatic private runner publishing with recovery UI, shared isolation, deduplicated tracking alerts and terminal GPS cleanup. Enforcement remains guarded by the off-by-default Convex setting `ENABLE_LOCATION_ACCOUNTABILITY`; enable it only for the rehearsal after reloading the verified integrated clients. Existing assignments remain legacy with manual sharing. See `TRACKING-ACCOUNTABILITY.md`. Task 7 automated validation: 352 tests across 35 files, both type checks and Android/iOS/web exports pass (30 static web routes); fresh-context final review has no actionable findings. Development backend deployed to agile-capybara-94 at 10:42:46 on 2026-09-30. Enforcement is still off until updated clients are reloaded and the development flag is activated for the user-led rehearsal. Joel explicitly left browser/phone rehearsal to himself. See LOCATION-ACCOUNTABILITY.md for steps and pending evidence; do not call this a verified live defence.

## Core project features

- **Errand Share implemented:** confirmed map pins enable automatic compatible two-buyer pairing, individual quotes and approvals, a reserved/active four-stop runner route, private GPS until each delivery, separate proof/completion/reviews and timeout/withdrawal recovery. Mobile requires pin confirmation in errand details before enrollment because original requests only contain written addresses. See `ERRAND-SHARE.md` for rules and the three-account walkthrough. Phone walkthrough pending.
- Preserve the mobile pricing agreement: runner quotes, buyer approval, direct MoMo/other externally arranged payments. Do not bring the old web escrow/wallet design into mobile.
- Source inspection confirms web implementations exist; it does not verify their live deployment. Earlier claims of demonstration completeness covered the ordinary errand workflow and missed these two core aims.

## Completed additions — phone walkthrough pending

**Errand Share validation, 2026-09-22:** 209 tests across 23 files, frontend/backend TypeScript, and Android/iOS/web exports passed. Synced to Convex development at 17:20:58 UTC. No real-device map/GPS walkthrough has been performed for the shared flow yet.

**Mobile trust system (`mobile-v1`) implemented:** server-derived, time-decayed and smoothed completion/review/first-reply evidence; neutral new-runner label; runner score explanations; buyer trust-based quote suggestions and assigned-runner record. Existing real confirmed history counts automatically. Daily clock refresh maintains decay. This adapts the web algorithm to signals mobile actually records; dispute adjudication, attributable failures, verification bonuses and fraud detection are not implemented and must not be claimed. See `TRUST-SYSTEM.md` for formula, limits and walkthrough. Validation: 178 tests, frontend/backend TypeScript and all-platform exports passed on 2026-09-22. Trust phone walkthrough remains pending.

1. Runner profile finishing touches: photo, short introduction, clear profile preview alongside existing contact, area, services and transport editing.
2. Better errand discovery: category, urgency, area/text and budget filters, saved service/area shortcuts, ordering and clear empty/loading states. Budgets are purchase/proposed budgets, never runner earnings.
3. Navigation assistance: external maps directions for pickup and delivery, appropriate next stop and travel mode. Existing addresses are text; do not fabricate coordinates, distance or ETAs.

Implementation details and phone walkthrough: `RUNNER-PROFILE-DISCOVERY-NAVIGATION.md`.

Verified 2026-09-22: 165 tests passed across 19 files; frontend/backend TypeScript passed; Android, iOS and web exports passed. Convex development sync completed at 09:27 UTC. Camera/gallery and external Maps behavior still require a phone walkthrough.

## Later / validation

- Both core migrations (trust and Errand Share) now have implementation and automated coverage. Next: the three-account Errand Share walkthrough, followed by fixes arising from real-device testing. Do not describe the entire project as device-validated.
- Real-device two-account walkthrough remains necessary, including photos, tracking, completion and notifications.
- Push notification code exists, but native credentials/build/device delivery are not verified. The user has no paid Apple Developer membership. Do not describe Android/iOS push as device-tested.
- Avoid adding production-only scope unless requested. No payment provider, wallet or in-app payouts.
