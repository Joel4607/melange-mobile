# Codebase scope audit

Date: 2026-09-22. Purpose: remove unnecessary work and clutter from the final-year demonstration while preserving trust-based runner comparison and Errand Share.

## Scope and method

Inspected the active mobile application's routes, frontend import graph, Convex functions/schema, configuration, scripts, installed dependency graph and project roadmap. Checked the workspace's older project folders at inventory level only; this is not a full audit of the old Next.js/Supabase app or every worktree. No application code, dependencies, data or settings were changed. This document is the only added artifact.

The unused-file findings come from static route reachability, including platform variants and literal dynamic imports/require calls, followed by repository reference searches. Dependency findings also consider package-lock dependencies and peers. They identify cleanup candidates, not measured bundle-size or performance savings. Tests and exports must be run after any future removal; they were not rerun for this read-only code inspection.

## 1. Clear cleanup candidates

### A. Unused Expo starter components — high confidence

Twelve TypeScript files are not reachable from the current mobile routes and their remaining references are within the unused starter group:

- `src/components/animated-icon.tsx`
- `src/components/animated-icon.web.tsx`
- `src/components/external-link.tsx`
- `src/components/hint-row.tsx`
- `src/components/themed-text.tsx`
- `src/components/themed-view.tsx`
- `src/components/ui/collapsible.tsx`
- `src/components/web-badge.tsx`
- `src/constants/theme.ts`
- `src/hooks/use-color-scheme.ts`
- `src/hooks/use-color-scheme.web.ts`
- `src/hooks/use-theme.ts`

`src/components/animated-icon.module.css` belongs to the same unused group. Current screens use `customer-ui.tsx` and the theme in `src/app/_layout.tsx`. Remove this group together rather than leaving its internal dependencies behind. Do not delete similarly named map components: they implement different live tracking and nearby-runner roles.

### B. Unused direct dependency declarations — high confidence, installation check required

No imports were found in app, backend or scripts for:

| Package | Assessment |
| --- | --- |
| `react-hook-form` | No forms use it. Current forms use React state. Remove with its unused resolver package. |
| `@hookform/resolvers` | No callers; unnecessary with current form implementation. |
| `zod` | No application usage. Its direct declaration can be removed; Expo CLI still depends on Zod transitively. |
| `@react-native-async-storage/async-storage` | No usage or installed reverse dependency found. Native authentication uses SecureStore; web uses localStorage. |
| `expo-device` | No usage or installed reverse dependency found, including in push registration. |

After removing the unused starter `external-link.tsx`, `expo-web-browser` also has no remaining application caller or installed reverse dependency found.

Do **not** remove packages solely because they lack direct imports. The installed graph shows `@auth/core` is a required Convex Auth peer; `@expo/ui`, `expo-glass-effect` and `expo-symbols` are Expo Router dependencies; `expo-font` is used by Expo/tooling dependencies. Web and native navigation also need framework packages not imported directly in application code. Reanimated/worklets/gesture-handler require a separate navigation/build check before considering removal.

### C. Starter reset script and README reset instructions — highest cleanup priority

`package.json:59` still exposes `reset-project`; `scripts/reset-project.js:14` targets the real `src` and `scripts` directories, and its implementation moves or recursively deletes them before creating a blank app. `README.md:30` still recommends this starter operation. It has no role in the developed project. Remove the command/script and replace the template README with actual startup and demonstration instructions. Do not run the reset command.

## 2. Implemented features that are optional for this demonstration

These are functioning or intentionally supported paths, not dead code. Some were explicitly requested earlier. Treat the following as scope choices rather than automatic removal instructions.

| Priority | Candidate | Evidence and assessment | Recommendation |
| --- | --- | --- | --- |
| High | Maintaining both Mapbox and react-native-maps | `src/components/maps/map-surface.tsx:8` selects Expo maps in Expo Go and Mapbox otherwise; `runner-map.tsx:27` also branches. `share-map.tsx` independently uses react-native-maps. Native builds therefore retain two rendering stacks. | Prefer one engine for a smaller project. For the current Expo Go demonstration, the existing react-native-maps path is the natural consolidation target. If Mapbox specifically remains a requirement, keep it and accept that this is a deliberate requirement, not dead code. Changing engines must retain live GPS, walker icons and shared-route pins. |
| High | Background GPS while the app is closed/locked | `src/lib/runner-background.ts:12`, `runner-location-sharing.tsx:103`, and the background permission flags in `app.json`. Adds a native task, saved authentication/session management and platform-specific permissions. | Defer if the defence keeps the runner app open. Foreground live GPS is sufficient for that demonstration. Remove background permissions and task wiring only as one coordinated change; retain session expiry and privacy controls. |
| Medium | Native push setup and delivery work | `src/lib/push-device.ts:6` gates push outside Expo Go; `getPushToken` requires an EAS project. Push provider and Convex delivery code are already implemented, with credential/device validation still pending in the roadmap. | Defer credentials/build/device rollout if it is not part of the marking requirements. Preserve the implementation you requested. Reactive in-app updates support an open-app demo. Do not strip retry, recipient or token-safety logic while still retaining push. |
| Medium | Separate job earnings screen | `src/app/runner/earnings.tsx:8` lists per-job agreed fees and manually reported payment receipt. History and individual errand screens already exist. | Merge the fee/payment summary into job history if reducing screens. Keep individual quoted fees, buyer approvals and external-payment arrangements. This is not a wallet or payout system. |
| Medium | Nearby unassigned runners map | `nearby-runners.tsx`, `RunnerMap.tsx`, and `api.runners.getNearbyRunners`; currently shown on buyer Home. It visualizes nearby available people but does not select a runner or assign an errand. | Optional visual polish. Keep if it helps explain the service; otherwise hide it for a tighter demo. Do not confuse it with assigned-runner live tracking, which should stay. H3 currently supports nearby discovery; shared pairing uses the separate distance algorithm. |
| Low | Dedicated Services tab | `src/app/(customer)/explore.tsx:6` explains categories; the same categories appear on Home and the Post form. | Optional to merge into Home/Post. Keep service categories themselves because discovery, runner capability and pricing depend on them. |
| Low | Full runner profile and trust sections in multiple places | Profile appears on dashboard, settings and profile editor. `OwnRunnerTrust` appears on dashboard and settings. | Keep a compact dashboard summary and one detailed profile/trust view. Preserve buyer-facing trust explanations and the server-side score. |

## 3. Simplification opportunities without removing features

1. **Shared image handling:** chat, handover proof and runner profile each repeat JPEG conversion, size handling, multipart construction and upload timeout code (`chat-composer.tsx:54`, `delivery-proof.tsx:32`, `runner-photo.tsx:37`). Extract common image preparation/transport helpers. Keep each endpoint's separate authorization, idempotency and storage lifecycle. The earlier upload errors make consistency valuable; this is not a reason to remove images or delivery proof.
2. **Static catalogue over a reactive backend query:** `convex/catalogue.ts:8` always returns the same six entries. Home, Services and Post subscribe via `useServices`; category names also exist in `runner-profile-options.ts`. A shared static catalogue could remove this unnecessary loading/network dependency while keeping server category validation. Avoid maintaining mismatched category lists.
3. **Simulation controls in ordinary errand details:** `errand-tracking.tsx:71` displays simulated progression when the backend flag permits it; demo map/message branches exist elsewhere. Keep as a clearly labelled fallback if useful, but hide it during the main multi-account demonstration. Do not count simulated completions in trust. If removed later, preserve compatibility with existing demo records rather than deleting schema fields indiscriminately.
4. **Outdated help text:** buyer account guidance still describes runner acceptance opening chat (`account.tsx:116`); runner guidance says one active job at a time (`runner/settings.tsx:45`). Update this to buyer quote approval and one ordinary errand or one paired route. These are documentation inconsistencies, not unnecessary workflow safeguards.

## 4. Keep in scope

- Buyer and runner accounts, role-specific navigation and authorization.
- Posting/editing/cancellation before assignment, discovery, runner service coverage and quotes.
- Individual buyer approval of runner fees; direct external payment arrangements.
- Text/image chat, foreground GPS, navigation assistance and accurate stale/ended tracking states.
- Handover photos, independent completion, reviews and job history.
- Trust calculation, evidence limits, neutral new-runner treatment and explanation of scores.
- Errand Share compatibility rules, two approvals, four-stop ordering, separate buyer privacy, timeout release and withdrawal recovery.
- Validation, atomic assignment, duplicate-request protection, location-session safety, tests and generated Convex bindings.
- Web support, which is useful for the second and third accounts during the defence.

These support a credible demonstration. They are not unnecessary merely because the app is a student project. No active mobile wallet, escrow, payment-provider integration, Telegram admin console, KYC or dispute-adjudication workflow was found; legacy web type labels and explanatory text are not implementations of those features.

## 5. Older workspace projects

The workspace still contains `expo-snack-user`, the previous `melange-main` web app, and `worktrees` folders. The inspected mobile imports do not depend on their runtime code; the old web implementation remains an important research/migration reference. Archive old prototypes outside the active deliverable if desired. Do not delete Git worktrees or the old web project without checking their Git state, uncommitted work and reference value first. Their presence does not itself mean they are bundled into the mobile app.

## Recommended cleanup order

1. Remove the starter reset workflow, unused starter component group and confirmed unused direct dependencies.
2. Consolidate repeated profile/trust sections and optionally merge earnings into job history.
3. Extract shared image handling and simplify the static service catalogue.
4. Decide whether one map engine, foreground-only GPS and deferred push rollout meet the defence requirements. These require coordinated changes, not individual file deletion.
5. Re-run TypeScript, the complete test suite, platform exports and the three-account Errand Share walkthrough after cleanup.

The core workflow should remain intact. The best reduction is unused scaffolding, duplicated presentation and optional native-platform work—not weakening trust, shared-route correctness or buyer privacy.
