# Current runner features

Runner-set service prices and buyer-approved quotes now replace direct acceptance. See [pricing and direct payment records](PRICING-DIRECT-PAYMENTS.md) for the current assignment and payment flow.

Availability, handover photos and optional background tracking are implemented. See [setup and device checks](RUNNER-DELIVERY-BACKGROUND.md). The earlier foreground-only notes below describe the original stage.

# Buyer and runner accounts

Choose **Buyer** or **Runner** on the account creation form. The choice is saved on the user record. Signing in from either entry point opens the dashboard belonging to that account; the sign-in form cannot change its role.

## Runner flow

1. Create an account with **Runner** selected, or sign in with a runner email.
2. Complete the runner profile: phone, working area, transport and services.
3. Open the runner dashboard immediately. There is no manual approval step.
4. Use runner **Settings** for personal details, runner profile editing, guidance and sign-out.

The runner workspace has its own Dashboard/Settings navigation. There is no customer-mode switch or buyer delivery-address settings. New buyer accounts stay in the buyer workspace and cannot turn into runner accounts through the profile endpoint. Use separate emails to test both roles.

## Existing accounts

- Existing runner profiles or enabled runner memberships are recognized as Runner without a migration command.
- Accounts without a saved role or runner membership see a one-time Buyer/Runner choice after sign-in. This supports the accounts created before role selection existed.
- Choosing a role preserves existing records. A saved role cannot be changed through the one-time chooser.

`accounts:me` supplies the effective account role. `accounts:chooseRole` fills the missing role for older accounts. `runners:register` saves the authenticated runner's own profile and membership together. Formal verification/approval remains deferred for this prototype.

## Dashboard scope

Active assignments, five latest deliveries, three recent reviews, private assigned-errand chats, stored location availability and editable runner profile. No invented earnings, jobs or ratings. Opening the dashboard does not start GPS. The Find errands tab supports service filters, pagination, request details and confirmed acceptance. Runner pickup/delivery controls and private foreground GPS sharing are implemented. Full job history is available under My jobs. General online availability and payouts remain later runner phases.

Customer and runner layouts redirect signed-in users to their account's workspace, including after session restoration and when opening a route belonging to the other role. Existing per-record backend ownership checks remain in place.

## Verification

Run `npm test` and `npm run typecheck`. On a device, check Buyer/Runner signup selection, runner profile setup, sign-out and sign-in with each email, role restoration after restarting the app, runner Settings/profile editing, and the one-time choice for an older test account. Refresh Expo after updating; if route changes remain cached, restart Metro with `npx expo start --go`.

## Finding and accepting errands

Post a new request from the buyer account and leave it at Posted (do not start demo tracking). Sign in with the runner account, open **Find errands**, choose the request, review its details and tap **Accept errand → Confirm & accept**. It becomes an active assignment on the dashboard. **Message buyer** opens the existing text/image conversation. Signing back into the buyer account shows Accepted and the same conversation.

The feed shows all areas, newest first, with a service filter. Addresses are the buyer's existing free-text pickup/delivery fields; this phase does not calculate nearby distance or infer neighbourhoods. Only posted, unassigned, non-demo requests are eligible. Runners cannot claim their own requests or view another runner's assigned job through runner details.

`runnerJobs:accept` atomically checks availability, the detail revision and the runner's active assignments, then writes assignment, acceptance time, revision and one activity event. Existing online map entries become busy without creating a GPS location. Convex transaction conflict retries protect simultaneous claims for one job and simultaneous claims for different jobs by the same runner. Retrying a successful acceptance is idempotent.

Accepted and picked-up errands occupy the one-active-job slot. Delivered errands free the slot while the buyer confirms completion. A changed budget/address/instruction invalidates an open acceptance confirmation. A cancelled or claimed request disappears from the feed and becomes unavailable to other runners. No real buyer or runner records are seeded by tests.

The assigned runner marks pickup and delivery in errand details. Do not use buyer demo controls for a real assigned request.

## Pickup, delivery and live GPS

Open an active errand. **Mark picked up → Yes, confirm pickup** updates both accounts. After handover, **Mark delivered → Yes, confirm delivery** reports delivery, ends location sharing and releases the active-job slot. The buyer then confirms receipt and can leave a review. Runner actions never confirm completion or create reviews on the buyer's behalf. Transitions check assignment, role, stage and revision; repeat requests are idempotent.

**Share my live location** asks for foreground location permission and sends actual GPS to the existing buyer tracking map. The workspace-level watcher continues through runner tabs and chat. It pauses in the background, on screen lock, or while disconnected, and restarts when the app is foregrounded and connected. Stop sharing, sign-out, role loss and delivery remove the watcher. Starting a different job never automatically opts that job into sharing.

This is foreground tracking for Expo Go; no background task/service is configured. Keep the runner app open to demonstrate continuous movement and view the buyer map on another device/browser. Phone permissions and actual GPS movement still need device testing.

Each GPS session is authenticated and tied to the assigned active errand. Stop clears that session ID so queued readings cannot restart it. One in-flight client publish and a five-second minimum interval limit writes. Only the latest coordinate is stored. Scheduled expiry marks GPS sharing paused after 30 seconds without a fresh capture (subject to scheduler latency), covering crashes/disconnects when the stop request cannot arrive. The buyer shows stale/paused positions honestly and no longer sees coordinates after delivery. GPS sharing is private to the assigned buyer; it does not advertise the runner as available to nearby customers.

## Job history

Open **My jobs** in runner navigation or **View all jobs** below Recent deliveries. All, Active, Awaiting confirmation, Completed and Cancelled filters load ten jobs at a time, ordered by their last status update. Older records without an update timestamp sort behind dated records. This view includes only the signed-in runner's assignments, excluding demo and self-owned errands.

Job details show recorded acceptance, pickup, delivery and buyer-confirmation times. Completed jobs show the buyer review when available, and their existing conversation stays read-only. Returning with **My jobs** preserves the history filter and loaded page while that screen remains mounted. General online availability and payouts remain later phases.

Phone checks still pending: camera/gallery uploads and delivery confirmation after the September 17 fixes; history navigation, filters and layout after this update.
