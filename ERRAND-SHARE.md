> Integrated release 2026-09-30: development backend deployed. After updated-client reload and flag activation, new shared assignments require fresh eligibility, independent pickup approvals and one cumulative tracking allowance. Existing active shared jobs remain legacy. See [LOCATION-ACCOUNTABILITY.md](LOCATION-ACCOUNTABILITY.md) for the current three-account rehearsal.

# Mobile Errand Share

Implemented for the final-year project demonstration, 2026-09-22.

## Buyer flow

Open a posted normal or flexible errand. In **Errand Share**, select **Set pins for a shared route**, place the pickup and delivery pins, then confirm them. Web and native maps support manual pin selection; GPS can be used once to place a pin. No continuous buyer position is published. No coordinates are guessed from written addresses. Existing requests remain ordinary errands until the buyer confirms pins; this is the mobile adaptation of the web automatic-pairing design. Pair selection is automatic after confirmation.

Normal requests wait up to 10 minutes and flexible requests up to 30 minutes. Ordinary quotes pause during this search. The buyer can return to ordinary matching at any point before assignment. A timeout also releases an unmatched request automatically. Express requests and demo errands are excluded.

A compatible pair is one opportunity for a runner, but still two private buyer records. Each buyer sees only their own service fee, the runner's trust record, approval count and shared stop progress. The other buyer's identity, addresses, chat, proof and payment record are not exposed.

The first fee approval reserves that runner and offer for at most 10 minutes (and never beyond the original 30-minute offer window). Fees cannot change during reservation. Assignment and private chats open atomically only after the second buyer approves that same offer. Both fees are saved separately. No wallet, escrow, payment collection or guaranteed monetary saving is introduced.

## Pairing and route selection

The mobile pure algorithm is ported from the web Errand Share implementation. It evaluates the six pickup-before-delivery orders for two errands and chooses the shortest valid route. Among up to 50 waiting candidates, it prefers the greatest distance saving, then the oldest candidate and stable ID.

- Exactly two errands from different buyers, both unassigned.
- Pickups within 1 km and deliveries within 2 km.
- Combined route shorter than the sum of the direct trips.
- Each buyer's detour at most 20% and at most 2 km. The ratio check is skipped for direct trips shorter than 100 m.
- Normal errands retain their original Today deadline at midnight in Accra. Flexible errands have no fixed deadline; a mixed pair uses the earlier deadline.
- Planning estimates use straight-line distances, 20 km/h, 5 minutes per stop and an initial 30-minute matching buffer. Final approval rechecks the remaining route time against the deadline.

These are prototype planning estimates, not road distances, traffic predictions, live ETAs or a fee discount. The map draws straight connecting lines. External Maps provides real navigation to each confirmed pin using the runner's transport preference.

## Runner flow

Find errands → **Shared opportunities** shows compatible pairs for the runner's service categories. It shows up to 30 latest open groups; ordinary discovery filters apply to the separate ordinary list. The runner needs starting rates for both service categories and no active run or reservation.

Open a shared route, review both jobs, and submit a separate fee for each. The shared explanation is visible to both buyers, so it should contain no private payment details. A runner can withdraw an unassigned offer; withdrawing a reserved offer releases both errands.

The dashboard shows the reservation or active shared route. Follow the four stops in order. Each next stop links to the existing individual errand page for chat, pickup, handover photo and delivery. The backend enforces stop order and a separate handover photo for each delivery. Each buyer then confirms completion and reviews independently; both confirmed jobs contribute to the existing trust system.

One GPS session broadcasts to both active errands. Each buyer's location access ends at their own delivery. Sharing continues for the remaining buyer even when the first member of the group is already delivered or confirmed. Finishing both deliveries releases the runner's capacity. Existing foreground/background build restrictions still apply.

## Recovery and safeguards

- Editing or cancelling either unassigned errand dissolves the pair. Editing clears the old pins and requires new confirmation.
- Leaving a pair, runner withdrawal, and expiry release reservations and invalidate old offers.
- Revision/version checks and transactional writes protect against stale prices, double pairing, competing runners and duplicate approvals.
- A disabled runner cannot receive a new shared assignment.
- Normal solo quote approval cannot split a waiting or paired errand.
- Push events use generic shared-route copy; notification taps route assigned/reserved runners to the shared route. Actual native push delivery remains unverified pending credentials/build/device testing.

## Demonstration walkthrough

Use **two separate buyer accounts and one runner account**, on separate devices or isolated browser sessions.

1. Both buyers post a normal pickup/delivery request. For a controlled demo, use clearly labelled test errands and these nearby example points:

   | Buyer | Pickup latitude, longitude | Delivery latitude, longitude |
   | --- | --- | --- |
   | A | 5.56000, -0.20000 | 5.56000, -0.18000 |
   | B | 5.56050, -0.20000 | 5.56050, -0.18000 |

   Use these only for demonstration; real errands need pins matching their written addresses.

2. Open each errand's details and confirm the pins for sharing. Both should show **Compatible errand found**.
3. The runner opens Find errands → Shared opportunities, opens the route and sends both fees.
4. Buyer A approves their own fee. Show that the runner is reserved but neither job has started. Buyer B approves their own fee. Both jobs become assigned together.
5. The runner enables GPS from the shared route and follows the next stop. Use each errand's private chat and a separate handover photo at delivery.
6. After the first delivery, show that buyer's location access has ended while the other buyer still receives updates. Each buyer confirms receipt and leaves a separate review.
7. Show the two completed jobs, separate payment reports and updated runner trust record. Payments remain externally arranged.
8. Optionally demonstrate leaving an unassigned pair and returning to ordinary matching without waiting for a timeout.

Automated validation covers pairing rules, concurrency, stale fees, privacy, reservation/timeout recovery, stop order, separate proof, GPS lifecycle, completion, reviews and trust. Phone/map/permission walkthrough remains pending; export checks do not replace it.

Verified 2026-09-22: **209 tests passed across 23 files**; frontend and Convex TypeScript checks passed; Android, iOS and web exports passed. Convex development sync completed at **17:20:58 UTC**. No payment integration or native push credentials were added.


## Accountability integration verification — 2026-09-30

One shared obligation and first-pickup timestamp cover both errands; later pickups do not replenish allowance. Mixed-stage tests enforce the next buyer’s own approval and pre-pickup lock. First delivery clears only that member’s GPS/access; the original publisher continues to the remaining buyer. Notifications are generic and deduplicated per incident/kind; the runner receives one per run. Final delivery ends collection and schedules GPS cleanup.

The full suite passes 352 tests across 35 files, both type checks and all-platform exports pass. Competing second approvals reject stale eligibility and create only one obligation on refreshed retry. Recovery/expiry and delivery/deadline orderings are covered against isolated Convex handlers. Actual three-account browser/phone continuity and push delivery remain pending. Do not treat this as a completed live rehearsal.
