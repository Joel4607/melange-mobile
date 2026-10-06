# Runner profile, discovery and navigation

Implemented 2026-09-22 for the final-year demonstration. Mobile trust scoring and quote suggestions are documented in `TRUST-SYSTEM.md`; the subsequent shared-route implementation is documented in `ERRAND-SHARE.md`. Both require the device walkthroughs recorded in `PROJECT-ROADMAP.md`.

## Profile

- Edit a 300-character introduction along with the existing phone, working area, services and transport.
- Choose or take a photo, preview it, then save it separately; replace or remove it later. Existing profiles remain valid without a photo or introduction.
- Photos appear on the runner dashboard, in Settings, and alongside the runner's introduction on the buyer's quote cards.
- Photos are converted to JPEG on the client and resized to at most 800 pixels on the longer side. The authenticated HTTP upload accepts up to 5 MB and checks image signatures. It never accepts a target user ID from the client.
- Only enrolled runners can upload. Retries of the same current request reuse the saved photo, stale replacement/removal fails, and superseded storage objects are deleted. Quotes expose profile details only through the existing buyer-owned errand query.
- Display-name editing remains in Settings. Notification preferences remain in the existing notification settings card.

## Discovery

- Search request titles, descriptions and pickup/delivery addresses.
- Combine service, preferred service categories, address area, urgency and inclusive budget bounds. Sort newest or oldest first.
- The working-area shortcut copies the saved profile area into the editable address search.
- Tap **Find errands** to apply drafts; **Clear all filters** resets them.
- Budgets describe the buyer's purchase/proposed budget, not the runner's service fee or earnings.
- Text/area matching is case-insensitive substring matching over paginated batches. Empty batches automatically continue until a match or exhaustion. After results are found, **Find more matching errands** loads more batches. Counts label loaded results versus exhausted matching results accurately.
- This is address search, not geographic distance ranking. Existing errands do not store validated pickup/drop-off map coordinates.

## Navigation

- Errand details show pickup directions and a pickup-to-delivery route preview before quoting.
- Once assigned, the primary destination follows the stage: accepted → pickup; picked up → delivery. Ended errands hide navigation controls.
- The profile transport sets the initial travel mode. Runners can choose Walk, Cycle, Motorbike or Drive for this route without changing their profile.
- Uses encoded Google Maps universal HTTPS URLs, opening the app where supported or a browser. No new API key is needed. Maps resolves the written addresses and handles the origin/location permission; Melange does not invent pins, distances or ETAs.
- The external route does not advance the errand. In Expo Go, foreground sharing pauses outside Melange; return to resume. Existing background sharing still requires its configured native build and permissions.
- Mode coverage and ambiguous addresses must be checked in Maps. An opening failure leaves the errand unchanged and shows a retry message.

Reference: https://developers.google.com/maps/documentation/urls/get-started and Expo SDK 57 Linking/ImagePicker documentation.

## Verification and phone walkthrough

2026-09-22 results: `npm run typecheck` passed; `npm test` passed all 165 tests in 19 files; `npx expo export --platform all --output-dir dist/runner-improvements-check` passed for Android, iOS and web. `npx convex dev --once` synced the development backend successfully at 09:27 UTC.

Automated coverage includes profile authorization, invalid image rejection, upload retries, replacement/removal cleanup, buyer quote visibility, combined discovery filters, sparse pagination, travel modes, stage-to-stop selection, URL encoding and currency parsing.

Phone checks still required:
1. On the runner account, edit the introduction; choose a gallery photo, save it, replace it with a camera photo, then reopen Settings to confirm persistence.
2. Submit a quote and check the photo/introduction from the buyer account.
3. Post requests with different categories, timings, areas and budgets; test combined filters, reset, and additional result pages.
4. Open a posted errand's route preview. After buyer assignment, test pickup directions; after confirming pickup, check that the primary button changes to delivery.
5. Return from Maps and verify location sharing resumes as expected for the current build.

Bundle export is a build check, not proof of native camera or external-app behavior. Native permission wording in app.json takes effect in a new native build; no new dependency was installed for these features.
