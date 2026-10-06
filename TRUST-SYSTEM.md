# Mobile trust system

Implemented for the final-year demonstration, 2026-09-22. Model version: `mobile-v1`.

Ranking updated 2026-09-27: score weights are unchanged. Targeted trust, pricing, nearby-runner and shared-route tests passed (53 tests), frontend/backend TypeScript passed, and the web export passed (`dist/trust-ranking-check`). The browser/phone walkthrough is still pending. Full solo quote ranking fetches every page in bounded requests; for production-scale candidate volumes this would need indexed/materialized ranking rather than loading all quote cards. Nearby discovery computes aggregate trust for the existing H3 neighborhood.

## User experience

- The runner dashboard and Settings show a score out of 100, history label and an expandable explanation.
- Buyer quote cards show each eligible runner's trust record alongside their price, profile photo and introduction.
- The buyer's selectable quote list loads every page (20 quotes per request), then ranks all eligible quotes by trust descending. It replaces the separate top-three suggestions panel. Previous/unavailable quotes appear separately without rank labels. Reactive overlapping pages are deduplicated by quote ID.
- Ranking uses score descending, then distinct buyers descending, then ID for stable ties. Price does not change the trust ranking. Busy, disabled, stale, withdrawn and otherwise unavailable quotes are excluded from the selectable ranking. There is no minimum trust score for selection.
- Nearby online runners show aggregate trust summaries and are ranked using the same comparison. Private job records, buyer identities, messages and review text are not exposed by discovery.
- Shared-run offers use the same ordering among the existing 20 latest offers; that comparison limit remains visible. Both buyers must still approve independently. The older `trust.recommendations` endpoint remains compatible for older clients (three suggestions from 20 recent quotes) but is no longer used by the current buyer quote list.
- Buyer approval remains mandatory. A trust suggestion never assigns a runner or changes the agreed price. New runners remain eligible with a neutral score of 50.
- The buyer can see the assigned runner's current trust record on the errand details page. This is a live current record, not a historical snapshot of the assignment decision.

## Adaptation from the web model

The original `../../melange-main/src/lib/algorithm/trust.ts` supplies the Bayesian completion prior, weighted evidence approach and 30-day exponential half-life. This mobile adaptation uses only observable mobile evidence.

The web weights are completion 0.35, disputes 0.25, rating 0.25, responsiveness 0.15. Mobile does not yet have adjudicated disputes, verified identity or recorded fraud assessments. It omits those inputs and renormalizes the supported weights: completion evidence 46.67%, buyer feedback 33.33%, first reply 20%. It does not award a clean-dispute bonus, verification bonus or infer fraud from missing records.

### Eligible evidence

- Up to 100 latest buyer-confirmed delivered errands, indexed by assigned runner and confirmation time.
- Assignment must match the runner recorded in completion. Demo mode, demo completion, self-owned jobs, active jobs and delivery awaiting confirmation are excluded.
- A review must match that errand's buyer and runner and must not be a demo review.
- Existing confirmed errands and reviews contribute automatically; no copy/backfill creates duplicate scoring records.
- First-reply tracking starts with new quote approvals. Each assignment stores the first buyer-message time and the runner's first subsequent reply time, set by server mutations for both text and image messages. Retries and extra messages cannot add observations. The timestamps contribute only once the buyer confirms completion.
- An unanswered tracked buyer message contributes zero response performance at completion. No buyer message, or missing legacy tracking, creates no response observation and no assumed failure.
- First-reply speed measures message delivery timing, not whether the runner read a message or was continuously online. It has a limited 20% weight for that reason.

### Formula

For each job, `influence = min(1, 3 / numberOfJobsFromThatBuyerInTheWindow)`. Its time weight is `2 ** (-ageDays / 30)`. This caps each buyer's aggregate influence at three full jobs; it is a simple concentration limit, not identity verification or fraud detection.

- Completion evidence: `(2 + weightedConfirmedJobs) / (4 + weightedConfirmedJobs)`. This is evidence of confirmed work, not a success-rate claim. Mobile currently lacks attributable failed-job outcomes; cancellations without recorded fault are not scored.
- Rating: normalize 1–5 stars to 0–1; `(1 + weightedRatingSum) / (2 + ratingWeight)`. The two neutral prior observations prevent one review from establishing an extreme rating component.
- Response: first reply within five minutes scores 1; linearly declines to 0 at 60 minutes; unanswered at completion scores 0. Smooth using `(1 + weightedResponseSum) / (2 + responseWeight)`.
- Overall: `round(100 * (0.35 * completion + 0.25 * rating + 0.15 * response) / 0.75)`.

The display includes raw average stars and reply minutes separately from the smoothed component scores. Displayed sample counts are counts within the history window, not weighted counts or lifetime totals. The UI explicitly labels the recent window when truncated.

History labels indicate evidence quantity, not quality or verification: new (zero confirmed jobs), limited (some jobs), established (at least five confirmed jobs from at least three buyers). Old positive or negative evidence gradually returns toward the neutral baseline as its weight declines.

## Backend consistency and access

- Scores are derived server-side from authoritative documents. There is no public score-setting mutation or caller-supplied scoring timestamp.
- Mutations initialize response tracking at assignment and update the first message/reply in the same transaction as committing the chat message.
- Completion/review queries update reactively when their source documents change, so retries cannot double-count a separate scoring ledger.
- A single `trustClock` row supplies the decay date. `trust:refreshClock` is an internal mutation; a daily Convex cron at 00:05 UTC updates it. Query code does not read the wall clock. Fresh evidence newer than that tick advances its evaluation time.
- After first deployment, initialize the date with `npx convex run trust:refreshClock`. The daily cron maintains it thereafter. Repeating initialization is safe.
- Runner self-inspection requires enrolled runner access. Buyer quote and suggestion queries require ownership of the errand. Assigned-runner records are limited to that errand's participants. Buyer identities and message contents are not exposed by trust summaries.

## Validation and demonstration

Automated verification on 2026-09-22: all 178 tests passed across 21 files; `npm run typecheck` passed; Android, iOS and web exports passed via `npx expo export --platform all --output-dir dist/trust-check`. Phone walkthrough remains pending.

Convex development sync succeeded at 09:46 UTC, including the confirmed-job index and daily cron. `trust:refreshClock` initialization then completed successfully.

Automated tests cover cold start, smoothing, decay, differing feedback/replies, repeated-buyer influence, exclusion of demo/self/unconfirmed/mismatched records, old history, text/image reply idempotency, buyer confirmation/review updates, private access, recommendations versus fee, stale/busy/disabled/withdrawn exclusion, neutral-runner approval, comparison limits and the recent-history window.

For a phone demonstration:
1. Open a new runner's dashboard: 50/100 and New runner.
2. Have two runner accounts submit quotes on a buyer errand; compare their numbered trust ranks, prices and explanations. The buyer can choose either eligible runner, including the lower-ranked one.
3. After assignment, send a buyer message and reply from the runner. Finish delivery with the handover photo, confirm completion as the buyer, then review.
4. Reopen the runner record and compare the changed evidence, review and reply components. Repeat across buyer accounts for different history labels.
5. Demonstrate a second set of quotes to show trust changes the order while selection and fee approval stay under buyer control.

Do not present test fixtures or scripted demo-tracking activity as actual runner history. The score is an explainable prototype decision aid, not a guarantee of safety or a verified identity badge. Disputes, attributable failures and verification remain future extensions if the project scope later requires them.

Errand Share was implemented subsequently; see `ERRAND-SHARE.md`. Each shared delivery contributes independent buyer-confirmed completion and review evidence to this trust system.
