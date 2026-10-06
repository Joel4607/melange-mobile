# Location accountability: release and defence walkthrough

Updated 2026-09-30. Tasks 1–6 are implemented. Task 7 automated integration, exports, final review and development backend deployment passed. Joel explicitly chose to perform the live rehearsal himself; browser and physical-phone results remain pending.

## Release state

The backend was deployed with `npx convex dev --once --typecheck enable` to **agile-capybara-94**, project **melange-mobile**, development only. The CLI reported **Convex functions ready at 10:42:46**, including the new `runnerLocations.by_publisherId` index. The matching frontend is the current local source and verified export `dist/location-accountability-check`. There was no production deployment, database reset, dependency upgrade or new frontend cloud host.

**Enforcement remains off:** `ENABLE_LOCATION_ACCOUNTABILITY` was absent when checked. The agent did not activate it. Reload updated clients before enabling the development flag. Existing accepted/picked-up jobs stay legacy; obligations already created remain enforced even if the flag is disabled later.

## Policy to explain

| Situation | Server behavior |
| --- | --- |
| New assignment | Rechecks a fresh eligible runner position; buyer still chooses the runner |
| Reading at most 30 seconds old | Current tracking |
| Reading older than 30 seconds | Delayed/last-known; interruption begins at the freshness deadline |
| Before collection, 90 seconds without fresh GPS | Pickup progression locks |
| Collection | Runner requests; this buyer approves the named runner; runner confirms Items received |
| Approval unused for ten minutes | Expires; a new request has a new version |
| After first pickup | Cumulative 30-minute vehicle or 40-minute walking interruption allowance |
| Recovery | Two increasing fresh readings spanning ten seconds of capture and server receipt time |
| Allowance exhausted | Needs attention; progression locks until sustained recovery, without replenishing allowance |
| Shared errands | One runner/clock; separate fees, approvals, destinations, chat, proof, completion and review |
| Delivery of A before B | A immediately loses tracking access before confirmation; B keeps the session and allowance |
| Final delivery/cancellation/revocation | Collection ends; private tokens/coordinates are fenced and cleanup is scheduled |

GPS is device-reported evidence, not identity or possession verification. Buyer approval authorizes collection, not vendor verification. Location loss causes no automatic trust penalty, payment action or cancellation. Chat, addresses, directions, approval requests and photo upload remain accessible during a lock. Trust ranks eligible runners descending; the buyer selects. Payments remain externally arranged MoMo/other payments, without a wallet.

## Maps and privacy

Buyers do not continuously broadcast GPS. They can manually save pickup/delivery pins or use GPS once to position a pin. Nearby search coordinates are used for that requested search. Private maps show the assigned runner and saved destinations. Missing pins use written-address directions, never invented coordinates.

Web uses Leaflet in an iframe; Android Expo Go uses Leaflet in a WebView; iPhone Expo Go uses Apple Maps; custom builds retain Mapbox. Walking symbols indicate runners; orange pins indicate destinations. Show runner and destination/Show route frames available markers. Last-known markers stay paused until server-confirmed recovery. Shared buyers cannot read each other’s records or pins, but live movement can reveal travel near another stop; do not promise spatial anonymity.

Online maps require internet. Web/Expo Go use foreground GPS, which browser/OS suspension can interrupt. Three accounts on one PC use the PC’s reported position, not three separate physical positions. Stationary fresh readings are valid; a moving icon alone proves nothing. Real native push and background tracking remain unverified and are not required for the browser defence.

## Start the three accounts

Run each command in its own PowerShell terminal from this app directory:

```powershell
cd "C:\Users\Joel Ago\Desktop\melange-main\melange mobile\app"
npx expo start --go --web --port 8081
```

```powershell
cd "C:\Users\Joel Ago\Desktop\melange-main\melange mobile\app"
npx expo start --go --web --port 8082
```

```powershell
cd "C:\Users\Joel Ago\Desktop\melange-main\melange mobile\app"
npx expo start --go --web --port 8083
```

Open [runner](http://localhost:8081/runner), [buyer A](http://localhost:8082), and [buyer B](http://localhost:8083). Keep the hostname consistent. Each port has separate account storage. Verify the displayed role/name, sign in to existing accounts and reload all clients. Use dedicated test accounts and clearly named test errands; ordinary confirmed jobs contribute to those test accounts’ trust history.

Once updated clients are ready, activate **development only**:

```powershell
npx convex env set ENABLE_LOCATION_ACCOUNTABILITY true --deployment agile-capybara-94
npx convex env get ENABLE_LOCATION_ACCOUNTABILITY --deployment agile-capybara-94
```

The second command must print `true`. Do not use `--prod`. Create new assignments after activation; earlier accepted errands do not acquire approval or automatic publishing. These activation commands were not executed by the agent. The hosted backend keeps running when its watcher closes; Metro must run to serve the local app.

## Solo rehearsal

1. Runner finishes profile/transport/pricing, goes online and allows location. Check the recent timestamp. Denied permission must leave them unavailable.
2. Buyer A posts a normal delivery and saves destination pins manually without buyer GPS permission. Runner quotes; show trust ranking and buyer choice before approval. A stale runner position must reject assignment until refreshed.
3. Private publishing starts automatically after assignment. Verify current runner GPS, busy status and removal from public online discovery. Both maps show saved destinations; pan/zoom and frame them.
4. Runner requests collection approval; buyer reviews and approves the named runner; runner confirms Items received. Repeated taps must create one pickup event. A screenshot or runner checkbox is insufficient.
5. On another fresh assignment before pickup, disconnect only the runner or deny runner location. Keep the buyer connected. Check delayed/last-known state after 30 seconds and pickup lock after 90 seconds even with buyer approval. Chat, directions and requests remain available.
6. Restore location/connection and use Restore location if needed. Keep the app open for at least ten seconds of fresh readings. One returning reading must not clear the lock. Reload and change runner tabs/chat; the assignment clock must survive.
7. After pickup, briefly interrupt again and show the cumulative allowance. Recovery retains time spent. Demonstrate full 30/40-minute exhaustion using controlled-clock tests below rather than changing the deployed timing.
8. Upload handover photo, report delivery, and check buyer tracking disappears **before** completion confirmation. Buyer separately confirms receipt and reviews. Show runner history and externally arranged payment records without claiming provider verification.

## Shared rehearsal

1. With a fresh available runner, both buyers post compatible normal delivery requests and confirm their own pins. Missing pins must request confirmation; express requests are excluded. Example synthetic destinations:

   | Buyer | Pickup latitude, longitude | Delivery latitude, longitude |
   | --- | --- | --- |
   | A | 5.56000, -0.20000 | 5.56000, -0.18000 |
   | B | 5.56050, -0.20000 | 5.56050, -0.18000 |

2. Runner quotes each buyer’s separate fee. A’s first approval reserves the runner privately. Keep runner eligibility GPS fresh. B’s approval assigns one shared run; an old stale second approval must fail.
3. Follow the server-selected four-stop order; labels A/B do not dictate route order. Each collection needs that buyer’s own approval. Interrupt GPS after the first pickup: the run countdown applies and the remaining collection independently locks at 90 seconds.
4. Recover for ten seconds and continue. The second pickup must not replenish allowance. Switch ports to show only each buyer’s own fees, approval and pins; the runner sees the full route.
5. Deliver to the first buyer with their handover photo. Before receipt confirmation, their tracking must end while the other buyer still receives GPS, even if the publisher originally used the delivered member as its anchor. A queued runner alert may open the remaining errand; the delivered buyer must never be redirected to the other buyer’s errand.
6. Finish remaining stops with separate proof/completion/reviews. Final delivery releases capacity and ends private tracking. Runner deliberately goes online for another job.
7. Repeat permission denial, connection loss and runner reload. In-app tracking and collection cards must work without push tokens. Complete the evidence table below.

## Migration and rollback

Schema references and push context are optional. Old posted records acquire policy only at a new assignment after activation. Existing accepted/picked-up records retain manual sharing and ordinary progression. Delivered/completed history remains readable. No record backfill or reset was performed.

Retired buyer-location endpoints remain for old clients: `current` returns null, `start` rejects, `publish` returns false. Owner stop/expiry clear points. The nightly retirement cron removes old buyer-position rows in bounded batches; this release did not manually purge or export live user coordinates. Terminal private cleanup protects fresh replacement sessions. Saved destination pins and minimal timing/activity evidence remain.

Update requested 2026-10-01: optional live buyer GPS is available through the separate `buyerLocationShares` consent API/table. Its latest position is private to the owner and assigned runner, independently per shared member, and expires after 30 seconds without fresh GPS. It supplements saved destinations and does not change matching, stop order or tracking obligations. Old endpoints remain retired. See MAPS-WEB-ANDROID.md for the revised walkthrough and iOS OpenStreetMap fallback.

To stop policy creation for future assignments during investigation:

```powershell
npx convex env set ENABLE_LOCATION_ACCOUNTABILITY false --deployment agile-capybara-94
```

Existing obligations remain enforced. This does not restore buyer sharing, erase trust evidence or reset interrupted time. Restore fresh GPS rather than deleting/backfilling records to bypass a lock.

## Verification — 2026-09-30

| Check | Result |
| --- | --- |
| Frontend and Convex TypeScript | Pass |
| Full Vitest suite | 352 tests passed across 35 files |
| Task 7 added coverage | Seven compatibility/privacy cases; six approval, deadline, recovery and shared eligibility boundary cases |
| Android/iOS/web exports | Pass; `dist/location-accountability-check`; 30 static web routes |
| Web bundle inspection | Leaflet and saved-pin framing present; no RNMBXMapView/RNMBXModule or RNCWebView signatures |
| Fresh-context final code review | No actionable findings in reviewed integration |
| Development deployment | Functions ready at 10:42:46; schema/index checks passed |
| Production / activation | No production deployment; development enforcement remains off |
| Live browser, physical Android/iPhone, native push/background | Pending; explicitly not claimed as verified |

Tests execute real Convex handlers against isolated convex-test databases. Competing calls and both serialized recovery/deadline orders are covered; these are not hosted-load measurements. Full exhaustion uses fake clocks; live policy remains 30/40 minutes.

```powershell
npm run typecheck
npx vitest run
npx vitest run tests/tracking-policy.test.ts tests/tracking-lifecycle.test.ts tests/shared-tracking-policy.test.ts tests/pickup-approval.test.ts tests/location-compatibility.test.ts
```

## Live evidence to fill in

| Check | Observed result / date |
| --- | --- |
| Reload updated clients, activate development flag | Pending |
| Solo assignment, maps, collection approval, recovery | Pending |
| Denial, offline state and reload continuity | Pending |
| Photo, delivery, immediate tracking end, completion/review | Pending |
| Shared four-stop route and first-delivery privacy | Pending |
| Android Expo Go runner dot and framing | Pending |
| iPhone Expo Go standard pins, framing and fallback | Pending |

A successful export/deployment is not a verified live defence. Complete the browser rehearsal and resolve observed failures before presenting. See `TRACKING-ACCOUNTABILITY.md`, `TRUST-SYSTEM.md` and `ERRAND-SHARE.md` for implementation and algorithm details.
