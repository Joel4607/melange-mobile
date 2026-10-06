// Adapted from the web project's algorithm/trust.ts: Beta prior and 30-day
// exponential decay. Unsupported dispute/identity/fraud signals are omitted,
// not treated as evidence of a clean or verified record.
export type TrustEvidence = {
  buyerId: string; confirmedAt: number; rating?: number; ratedAt?: number;
  buyerMessageAt?: number; runnerReplyAt?: number;
};
export const TRUST_VERSION = 'mobile-v1';
export const TRUST_HISTORY_LIMIT = 100;
export const TRUST_QUOTE_LIMIT = 20;
const DAY = 86_400_000;
const decay = (at: number, now: number) => 2 ** (-Math.max(0, now - at) / (30 * DAY));
const percent = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 100);

export function computeMobileTrust(evidence: TrustEvidence[], now: number, limitedToRecent = false) {
  const buyers = new Map<string, number>();
  for (const e of evidence) buyers.set(e.buyerId, (buyers.get(e.buyerId) ?? 0) + 1);
  let completedWeight = 0, ratingWeight = 0, ratingSum = 0, responseWeight = 0, responseSum = 0;
  let ratingCount = 0, stars = 0, responseCount = 0, repliedCount = 0, replyMinutes = 0;
  for (const e of evidence) {
    // A repeated buyer contributes at most three full jobs in this window.
    const influence = Math.min(1, 3 / buyers.get(e.buyerId)!);
    completedWeight += influence * decay(e.confirmedAt, now);
    if (e.rating !== undefined && Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 5) {
      const weight = influence * decay(e.ratedAt ?? e.confirmedAt, now);
      ratingWeight += weight; ratingSum += weight * ((e.rating - 1) / 4);
      ratingCount++; stars += e.rating;
    }
    if (e.buyerMessageAt !== undefined && e.buyerMessageAt <= e.confirmedAt) {
      const weight = influence * decay(e.confirmedAt, now);
      const answered = e.runnerReplyAt !== undefined && e.runnerReplyAt >= e.buyerMessageAt && e.runnerReplyAt <= e.confirmedAt;
      const minutes = answered ? (e.runnerReplyAt! - e.buyerMessageAt) / 60_000 : null;
      // One first-reply observation per completed errand; extra messages never
      // earn points. An unanswered buyer message is zero once the job closes.
      const response = minutes === null ? 0 : Math.max(0, Math.min(1, (60 - minutes) / 55));
      responseWeight += weight; responseSum += weight * response; responseCount++;
      if (minutes !== null) { repliedCount++; replyMinutes += minutes; }
    }
  }
  const completion = (2 + completedWeight) / (4 + completedWeight);
  const rating = (1 + ratingSum) / (2 + ratingWeight);
  const response = (1 + responseSum) / (2 + responseWeight);
  return {
    version: TRUST_VERSION, score: percent((0.35 * completion + 0.25 * rating + 0.15 * response) / 0.75),
    history: evidence.length === 0 ? 'new' as const : evidence.length >= 5 && buyers.size >= 3 ? 'established' as const : 'limited' as const,
    completedJobs: evidence.length, distinctBuyers: buyers.size, ratingCount,
    averageRating: ratingCount ? Math.round(stars / ratingCount * 10) / 10 : null,
    responseCount, repliedCount, averageReplyMinutes: repliedCount ? Math.round(replyMinutes / repliedCount) : null,
    completionScore: percent(completion), ratingScore: percent(rating), responseScore: percent(response),
    asOf: now, limitedToRecent,
  };
}
export type RunnerTrust = ReturnType<typeof computeMobileTrust>;

// Ranking is a comparison aid only. Assignment must remain a buyer mutation.
export function compareRunnerTrust(a: RunnerTrust | null, b: RunnerTrust | null) {
  return (b?.score ?? -1) - (a?.score ?? -1)
    || (b?.distinctBuyers ?? 0) - (a?.distinctBuyers ?? 0);
}

export function rankBuyerQuotes<T extends { _id: string; canApprove: boolean; trust: RunnerTrust | null }>(quotes: T[]): T[] {
  // Reactive pagination may briefly overlap pages; one card per quote.
  return [...new Map(quotes.map(quote => [quote._id, quote])).values()].sort((a, b) =>
    Number(b.canApprove) - Number(a.canApprove)
    || compareRunnerTrust(a.trust, b.trust)
    || a._id.localeCompare(b._id));
}
