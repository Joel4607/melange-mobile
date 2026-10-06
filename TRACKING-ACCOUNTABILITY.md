# Location accountability — backend, pickup, publishing and shared isolation

Tasks 3–6 implemented on 2026-09-29/30. See the parent `docs/superpowers/plans/2026-09-29-location-accountability-plan.md` for the complete seven-task rollout.

## Rollout

New enforcement is **off by default**. `ENABLE_LOCATION_ACCOUNTABILITY=true` is a Convex deployment environment setting, not an Expo public setting. Enable it only with the integrated pickup authorization, automatic publishing and recovery UI (tasks 4–6), after task 7 verification. Tasks 3–6 did not deploy or activate the feature. Task 7 deployed the tested development backend; activation is left until updated clients are ready for the user-led rehearsal. See LOCATION-ACCOUNTABILITY.md.

The switch controls freshness at assignment and creation of new tracking obligations. Once created, an obligation remains enforced even if the switch is subsequently disabled. Existing assignments without `trackingObligationId` remain legacy and keep their progression behaviour. Nothing backfills obligations onto active or completed errands.

## Implemented

- Solo quote approval and both shared fee approvals require an authenticated, current availability session with a position captured and received within 30 seconds. First shared approval reserves the runner; final approval assigns both errands atomically. Buyer choice and independent fees remain unchanged.
- Reserved runners can refresh location privately for eligibility. Their availability updates stay `busy`, exclude them from nearby search and cannot authorize another job. The existing foreground provider continues its availability watch during reservation. Final assignment fences that session; private updates require the assigned runner's errand session.
- One obligation per solo errand or shared run stores the policy version, transport snapshot, initial assignment time, first pickup time, latest accepted capture/receipt, recovery candidate, cumulative interruption time and scheduler generation. No GPS trail is added.
- No initial private fix: assignment starts the 30-second freshness window and 90-second pickup deadline. Restarting, stopping, reconnecting, changing transport or receiving a repeated capture cannot reset them.
- Recovery requires increasing fresh captures and at least 10 seconds between accepted readings, measured by both server receipts and capture timestamps. A gap over 30 seconds restarts the recovery candidate. Stationary coordinates are valid; old, invalid and replayed readings are not. Fractional device timestamps are accepted; countdowns use integer server time.
- After first pickup, interruptions consume the same cumulative 30-minute vehicle / 40-minute walking allowance across the whole run. Pre-pickup time is not charged. Exhaustion pauses progression until recovery; recovery does not restore spent allowance.
- Scheduled internal mutations materialize delay, pickup lock and exhaustion. Every progress mutation independently evaluates server time, so a late scheduler cannot permit a bypass. Earlier pending checks are reused instead of enqueueing one callback per GPS fix. Obsolete generations cannot change current state.
- Each buyer's tracking query exposes only their status, remaining budget, update time and tracking gates. Delivery/cancellation revokes that buyer's reads immediately; the remaining shared member keeps the original obligation. The final terminal transition settles open downtime once. Runner access revocation hides live location immediately, including legacy sessions.
- Status transitions create neutral activity entries without coordinates or another buyer's details. GPS loss never changes trust scores, charges money, cancels an errand or makes an accusation.

`tracking.current` returns tracking gates, not complete lifecycle permissions: ownership, shared stop order, photo proof and completion checks still apply. Buyer-authorized pickup is implemented in task 4. The public cancellation API still permits only unassigned errands; its terminal hook is ready without introducing active-job cancellation.

## Buyer-authorized pickup (task 4)

For new enforced assignments, the runner requests collection approval in errand details or at the next shared pickup. The buyer sees a named-runner approval card and explicitly confirms permission to collect. Approval lasts ten minutes from the buyer’s approval, expires reactively through a scheduled mutation, and is consumed once when the runner confirms **Items received**. Expiry is also checked in the progression transaction, even if the scheduled callback is late.

Each shared buyer approves only their own errand. Location locks and shared stop order still apply; a failed progression leaves approval unused. The runner can request approval and both roles can use existing chat/calling while location is locked. Screenshots, checkbox state and chat text cannot authorize pickup. The flow establishes buyer authorization; it does not verify the vendor or physical handover independently.

Approval is tied to the runner and obligation. The approve endpoint also requires expectedRequestVersion so a delayed confirmation of an expired request cannot approve its replacement. Repeated requests/approvals do not extend expiry or duplicate activity. New requests clear old approval fields and fence obsolete expiry jobs. Terminal/revoked access denies reads and mutations.

Legacy errands retain their earlier pickup flow. The buyer checks the optional obligation reference; the runner receives trackingRequired from existing errand details. Legacy screens skip pickup queries, avoiding calls to the new endpoint before the integrated deployment. Reactive in-app requests work without push tokens. Task 6 adds a generic pickup-request alert for opted-in native devices, once per request version.

## Automatic publishing and recovery (task 5)

For an assignment with a tracking obligation, the app-wide runner provider starts private GPS after checking permission. No second start button is required. Existing legacy assignments retain their manual start/stop flow; availability still has Go online/Go offline. Returning to idle after the final delivery does not make the runner publicly online again.

The publisher serializes GPS/background resources, cancels superseded work and removes watches that finish starting after cancellation. A stable shared-run anchor keeps the same session after the first delivery; the status query switches to a still-active member because the delivered buyer's tracking access has ended. Sign-out/revocation unmounts the existing account-scoped provider. Session cleanup remains fenced; network loss is covered by the server deadlines.

Foreground startup/GPS failures retry after 1, 2, 4, 8 and 16 seconds, then require Restore location. Accepted new readings renew the retry allowance. Permission refusal and replaced sessions require explicit recovery without automatic repeated prompts. Reconnect checks permission instead of reopening the permission dialog. Restore explicitly permits another request; location denied permanently must be enabled in device/browser settings. Only fresh readings are published, with their original capture timestamps. Background sharing keeps the existing native task and credential safeguards; its status depends on server-received GPS rather than merely a registered task.

Enforced errands show Restore location instead of a stop-sharing control. Device location controls, permission refusal and sign-out remain possible; they interrupt tracking and cannot reset the obligation. Native development builds can switch between foreground/background sharing during the active errand, including returning to foreground after background permission refusal. Expo Go and web remain foreground-only. Browser tab changes do not intentionally stop the publisher, but browser/OS suspension may still cause interruption.

Both roles see waiting, current, delayed, pickup lock, interruption and neutral Needs attention states. Countdowns are anchored to the server snapshot using monotonic elapsed time and are estimates only. Only server-returned tracking gates disable pickup/delivery; loading/unavailable enforced status fails closed. Chat, directions, addresses, handover photos and collection approval stay accessible. A single returning fix can move the map marker, but its paused appearance remains until sustained recovery is confirmed by the server.

## Shared isolation, notifications and cleanup (task 6)

Mixed-stage shared runs retain one cumulative interruption allowance and the original first-pickup timestamp. Buyer B must obtain B’s own collection approval and satisfy the pre-pickup location lock even after A has collected. Neither buyer can read the other’s approval or destination pins.

Delivery immediately denies that buyer’s tracking reads, clears their private latest point and session, and schedules deletion of the empty location row. The remaining buyer retains the same publisher session and run clock even when the publisher’s original anchor was A. Final delivery ends the obligation; completion and cancellation hooks also clear terminal coordinates. Revocation removes public discovery coordinates and fences active private sessions immediately. Historical private GPS rows are removed in bounded batches; delayed cleanup preserves a newly authorized session or new public availability. Old fixes, expiry jobs and deadlines cannot restore terminal access. Timing-only obligations and neutral activity remain; no GPS trail is created. This adds cleanup to existing cancellation hooks, without introducing active-job cancellation UI.

Pickup requests deduplicate by request version. Interruption, attention and recovery alerts deduplicate by obligation, incident and event kind: each active buyer gets an alert for their own errand, and the runner gets one per run rather than one per buyer. Repeated GPS fixes do not enqueue repeated alerts. Pending sends, retries and authenticated notification taps re-check access, current server-time policy and incident identity. Obsolete recovery/interruption alerts and delivered/revoked buyer targets are rejected. A runner alert queued against A resolves to remaining active B after A’s delivery, without issuing another alert or redirecting A’s buyer.

Existing reactive tracking cards, collection approvals and neutral activity work without push tokens. Native delivery uses the existing preference-aware Expo queue, with generic text and opaque notification routing: no GPS, addresses, titles or another buyer’s details in the payload. A notification already handed to an external provider cannot be recalled; native delivery is not device-verified. See PUSH-NOTIFICATIONS.md.

## Remaining

Task 7 automated compatibility, exports and development deployment have passed. User-led browser/phone demonstrations and development flag activation remain pending. See LOCATION-ACCOUNTABILITY.md for exact checks and activation commands.

## Verification

`tests/tracking-lifecycle.test.ts` enables the rollout switch only in isolated tests with a controlled clock. It covers assignment freshness, shared reservations, session fencing, restarts, delayed/stale scheduler calls, sustained recovery, cumulative exhaustion, walking budgets, shared-member privacy, revocation and legacy compatibility. Run `npx vitest run` and `npm run typecheck` from this app directory.

Final automated result: **297 tests passed across 30 files**, including 18 new tracking lifecycle tests; frontend and backend TypeScript checks passed.

No real account, browser location or physical phone flow was exercised in task 3. Simulated time verifies the long interruption thresholds without shortening the deployment policy.

Task 4 verification (2026-09-30): all **308 tests pass across 31 files**, including 11 new pickup approval tests. Frontend/backend TypeScript and Android/iOS/web exports pass (30 static routes). Live walkthrough and integrated activation remain pending.

Task 5 verification (2026-09-30): all **326 tests pass across 33 files**, including 10 presentation and 8 publisher tests. The 82 focused checks include existing fresh-feed/background/pickup/progress/shared-flow coverage and the capacity handoff contract. Frontend/backend TypeScript and Android/iOS/web exports pass (30 static routes, dist/automatic-tracking-check). No backend deployment, rollout activation or live GPS/device walkthrough was performed. This records task 5 verification; task 6 is recorded below and task 7 live verification remains pending.


Task 6 verification (2026-09-30): all **339 tests pass across 34 files**. The planned shared-policy/share/location/push subset passes **43 tests across four files**, including 10 shared-policy and three additional push-dispatch regressions. Frontend and Convex TypeScript checks pass. No new platform export, codegen, backend deployment, rollout activation or live browser/phone/push walkthrough was performed in task 6. Task 7 is next.


Task 7 automated verification (2026-09-30): **352 tests pass across 35 files**, including seven compatibility and six new boundary/concurrency cases. Both type checks and Android/iOS/web export pass; 30 static web routes. Fresh-context final review found no actionable issues. Convex development deployment to agile-capybara-94 succeeded at 10:42:46 and added runnerLocations.by_publisherId. Generated bindings were updated and post-deployment type checks pass. No production deployment or flag activation. Joel explicitly chose to perform all live rehearsals himself; browser/phone/push results remain pending.
