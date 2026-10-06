# Saved destination maps — task 2

Implemented 2026-09-29. Tracking-policy enforcement (tasks 3–6) is not active yet.

Buyer errand details now offer **Pickup and delivery pins** before assignment, including express/ordinary requests. Place pins manually or use current GPS once. Confirm both pins before saving. Existing quotes become stale when pins change; the buyer must review refreshed quotes. Address edits clear saved pins. Leave shared matching before changing pins; assigned errands cannot change their destinations through this editor.

Buyer tracking shows the runner and only that buyer's saved pickup/delivery pins. **Show route** frames the available markers. Saved stops remain visible while waiting for the first runner position. Missing pins are never inferred from address text. Demo routes remain clearly simulated and are not connected to real destinations.

Runner errand and shared next-stop screens use the saved destinations. Navigation uses a confirmed pin when available and the written address otherwise. The runner retains access to both shared errands' assigned stops; one buyer cannot query the other buyer's destinations.

Continuous buyer GPS sharing is retired. Compatibility endpoints deny start/publish and never return old positions. Stop remains idempotent. The bounded internal buyerLocations:purgeRetired migration clears 100 rows per transaction and schedules remaining batches. A daily cleanup provides a fallback. Read denial does not wait for cleanup. Nearby-runner discovery still uses the buyer's optional search origin locally and for their requested proximity search; it is not published as a buyer tracking position.

Web and Android Expo Go use Leaflet, iOS Expo Go uses Apple Maps, and custom-build tracking retains Mapbox. No dependency or schema change is required. Tests cover private reads, stale versions, invalid pins, assigned edit rejection, shared isolation, cleanup, address fallback and map framing.

## Manual walkthrough

1. Refresh buyer and runner browser tabs / Expo Go.
2. As buyer, open an unassigned errand, choose and confirm both destination pins without enabling live location.
3. Have the runner refresh their quote; approve the latest quote. Open both errand screens and start the existing runner location control.
4. Confirm the map shows runner and saved stops; pan, then tap Show route. Stop runner GPS and verify the last-known label, with destination pins still visible.
5. Open directions; confirm the saved destination is used. Repeat with an older errand without saved pins and verify address-based directions.
6. For a shared run, verify each buyer sees only their own destinations; the runner sees the full assigned route and next stop. Delivery still ends that buyer's runner tracking access.
7. Device GPS, permission dialogs and native marker appearance require physical-phone checks. Bundle export is not device validation.

## Verification

57 targeted tests, frontend/backend TypeScript and Android/iOS/web exports passed. Convex development sync succeeded on 2026-09-29 at 16:46:36 UTC. Actual browser/phone walkthrough remains pending. Refresh existing tabs and Expo Go to load the changed screens.
