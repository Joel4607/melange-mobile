# Runner prices, buyer approval and direct payment records

## App flow

1. Runner dashboard or Settings → **My pricing & quotes**. Set a starting fee for each offered service; blank means not offered. Prices use Ghana cedis with two decimal places, stored as integer pesewas.
2. Buyer posts an errand with an **item budget**, excluding the service fee. Zero is allowed when no purchase is needed. Earlier requests retain the label “original proposed budget”; existing amounts are not reinterpreted or migrated.
3. Runner opens Find errands → request → enters a final service fee and optional explanation → reviews and submits the quote. A starting price for that category is required. Sending a quote does not assign the job or open chat.
4. Buyer opens their errand → **Runner quotes** → reviews the fee and starting-price snapshot → confirms the fee and runner. They can decline a quote; runners can withdraw or revise their own pending quotes.
5. Buyer approval atomically assigns the runner, freezes the agreed fee, ends public availability and opens the existing private chat. Only one active job is allowed per runner. Old direct-accept clients receive an instruction to refresh and use quotes.
6. Participants agree on MoMo or another method in chat and pay outside Melange. The buyer can report the **full service fee** sent, with the method name. The assigned runner separately confirms receipt after checking their account. Item reimbursements are not included in this record. Job completion and payment confirmation are separate.
7. **Job earnings history** shows agreed fees and each payment's participant-reported state. It is not a wallet, withdrawable balance, payment processor or verified bank/MoMo statement. No real transfers are initiated.

## Data and compatibility

`runnerPricing` stores up to six category prices per runner. `runnerQuotes` stores one current quote per runner/errand with a revision and version. Published-price updates do not change submitted quotes. Buyer edits invalidate earlier quotes until runners resubmit. Stale approvals, unavailable runners and concurrent assignments are checked in the backend transaction. Other outstanding quotes become unavailable when a job is assigned or cancelled.

Agreed pricing and manual payment timestamps are stored on the errand and only available to its participants. Payment account numbers are not published with prices; share them in the assigned private chat. Repeated approvals and payment confirmations are idempotent. Payment updates do not alter the errand's operational revision or fabricate a completion event.

Existing assigned errands continue through pickup, delivery and review. They have no fabricated fee agreement and are excluded from fee history; their payment terms remain in chat. Demo errands cannot receive real quotes or payment records.

## Device walkthrough still to run

- With separate buyer and runner accounts, set prices, post an errand, quote, then approve as the buyer. Check both dashboards and chat.
- Change a quote or edit the errand before approval; verify the buyer must review current terms. Try withdrawing/declining a quote.
- Check the agreed fee is separate from the item budget, including a zero-item-budget delivery.
- Record a payment as the buyer and confirm receipt as the runner. Check the fee history and verify repeated taps do not duplicate records.
- Check old assignments remain usable. Verify camera proof, tracking and completion still work on the phone.

No payment provider credentials or native dependencies are needed for this feature. Refresh the app after the Convex development backend has synced.
