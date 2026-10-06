# Completion and reviews

## Try it in Expo Go

Reload Expo with `r`. Open an errand and advance its demo tracking through acceptance, pickup and delivery. A confirmation card appears above tracking. Choose **Confirm delivery**, then **Yes, complete demo errand**. Pick 1–5 stars, optionally write feedback, and submit. **I'll review later** leaves the completed errand available for a later review. Reopening it shows the saved review.

A delivery question can still be sent in chat before customer confirmation. Confirmation closes chat for new messages while keeping history readable. Cancelled errands also retain read-only chat history.

## Data and access

- `status: delivered` means delivery was reported. `errands.completion` records the separate customer confirmation: server timestamp, assigned runner ID and demo flag.
- `errands.confirmCompletion` requires the owner, reported delivery and the expected errand revision. A real errand needs a different assigned runner; a demo requires the existing demo flag and no runner assignment. Retrying confirmation is safe and does not duplicate activity.
- The completion record snapshots the runner so a later assignment edit cannot redirect the review.
- `reviews.submit` requires the owner and confirmation, a whole-number rating from 1–5, and an optional comment up to 1,000 characters. One immutable review is allowed per errand. Retrying the same content returns the original review.
- Demo reviews have `isDemo: true` and no runner ID. They do not enter a real runner's review index. The demo environment flag gates new demo confirmations/reviews.
- Saved reviews and confirmation events appear in activity. `reviewRating` and `reviewedAt` on the errand provide the list summary and review action without a query per card.
- Existing delivered records are not automatically confirmed. No database migration is required; the added errand fields are optional.

## Runner phase contract

The future runner interface should report delivery by setting `status: delivered` and `deliveredAt`, never by setting `completion` or submitting a customer review. Customer confirmation and reviews remain customer-only. Treat any existing completion as terminal in future lifecycle mutations. Use the stored completion runner ID for review attribution. A runner review inbox/profile summary is not part of this customer-side change.

## Verification

82 backend tests and the app/Convex TypeScript checks pass. The new tests cover ownership, pre-delivery and cancelled rejection, stale revisions, idempotent confirmations/reviews, rating/comment validation, demo isolation, runner snapshots and the chat lifecycle. Test the confirmation and star controls on the phone before presenting the app; automated checks do not verify the physical-device layout.
