import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { computeMobileTrust, TRUST_HISTORY_LIMIT, type TrustEvidence } from './trustScore';

export async function runnerTrust(ctx: QueryCtx, runnerId: Id<'users'>) {
  const clock = await ctx.db.query('trustClock').withIndex('by_key', q => q.eq('key', 'daily')).unique();
  const rows = await ctx.db.query('errands').withIndex('by_runnerId_and_completion_confirmedAt', q => q.eq('runnerId', runnerId).gte('completion.confirmedAt', 0))
    .order('desc').filter(q => q.and(q.eq(q.field('status'), 'delivered'), q.eq(q.field('trackingMode'), undefined), q.eq(q.field('completion.isDemo'), false), q.eq(q.field('completion.runnerId'), runnerId), q.neq(q.field('customerId'), runnerId)))
    .take(TRUST_HISTORY_LIMIT + 1);
  const evidence: TrustEvidence[] = await Promise.all(rows.slice(0, TRUST_HISTORY_LIMIT).map(async errand => {
    const review = await ctx.db.query('reviews').withIndex('by_errandId', q => q.eq('errandId', errand._id)).unique();
    const validReview = review && !review.isDemo && review.runnerId === runnerId && review.customerId === errand.customerId;
    const response = errand.trustResponse?.runnerId === runnerId ? errand.trustResponse : null;
    return { buyerId: errand.customerId, confirmedAt: errand.completion!.confirmedAt,
      ...(validReview ? { rating: review.rating, ratedAt: review._creationTime } : {}),
      ...(response ? { buyerMessageAt: response.buyerMessageAt, runnerReplyAt: response.runnerReplyAt } : {}),
    };
  }));
  // Daily materialized clock keeps time decay reactive without a wall-clock
  // read in a query. New evidence can be newer than today's clock tick.
  const asOf = Math.max(clock?.at ?? 0, ...evidence.flatMap(e => [e.confirmedAt, e.ratedAt ?? 0]));
  return computeMobileTrust(evidence, asOf, rows.length > TRUST_HISTORY_LIMIT);
}

export async function recordTrustReply(ctx: MutationCtx, errand: Doc<'errands'>, senderId: Id<'users'>) {
  const response = errand.trustResponse;
  if (!response || errand.trackingMode || errand.completion || !errand.runnerId || errand.runnerId === errand.customerId || response.runnerId !== errand.runnerId) return;
  if (senderId === errand.customerId && response.buyerMessageAt === undefined) {
    await ctx.db.patch('errands', errand._id, { trustResponse: { ...response, buyerMessageAt: Date.now() } });
  } else if (senderId === errand.runnerId && response.buyerMessageAt !== undefined && response.runnerReplyAt === undefined) {
    await ctx.db.patch('errands', errand._id, { trustResponse: { ...response, runnerReplyAt: Date.now() } });
  }
}
