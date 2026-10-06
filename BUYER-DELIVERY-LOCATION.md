# Buyer delivery locations

Updated 2026-09-29: continuous buyer location sharing has been retired. Buyer and runner tracking maps now use saved pickup/delivery destinations. See [DESTINATION-MAPS.md](DESTINATION-MAPS.md) for privacy rules, verification and walkthrough.

A buyer may use current GPS once to place a destination pin or place it manually. Nearby-runner search remains available. No live buyer position is published to the runner.


## Integrated release — 2026-09-30

The development backend now denies retired buyer live-location endpoints for old clients too: reads return null, start rejects and publish returns false. Scheduled retirement cleanup removes old point rows without restoring access. Saved pins remain scoped to each buyer’s own errand; missing pins retain written-address directions. There is no continuous buyer GPS sharing.

Compatibility coverage includes old posted, accepted, picked-up, delivered and completed records without new optional fields. No retroactive obligations or fabricated destinations are added. The full 352-test suite, both type checks and Android/iOS/web exports pass. Three-account browser and physical-phone checks remain pending. Use LOCATION-ACCOUNTABILITY.md for deployment state, activation and rehearsal.
