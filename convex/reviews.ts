import { queuePush } from './lib/queuePush';
import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import schema from './schema';

async function ownErrand(ctx: QueryCtx, id: Id<'errands'>) {
  const userId = await getAuthUserId(ctx);
  if (!userId || !(await ctx.db.get('users', userId))) throw new ConvexError('Sign in to review your errand.');
  const errand = await ctx.db.get('errands', id);
  if (!errand || errand.customerId !== userId) throw new ConvexError('Errand not found.');
  return errand;
}

export const forErrand = query({
  args: { id: v.id('errands') },
  returns: v.object({ review: v.union(schema.doc('reviews'), v.null()), runnerName: v.string(), canWrite: v.boolean() }),
  handler: async (ctx, { id }) => {
    const errand = await ownErrand(ctx, id);
    const review = await ctx.db.query('reviews').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    const runnerId = errand.completion?.runnerId ?? errand.runnerId;
    const runner = runnerId ? await ctx.db.get('users', runnerId) : null;
    const isDemo = errand.completion?.isDemo ?? errand.trackingMode === 'demo';
    return {
      review, runnerName: isDemo ? 'Demo runner' : runner?.name || 'Your runner',
      canWrite: !!errand.completion && errand.status === 'delivered' && !review && (!isDemo || process.env.ENABLE_DEMO_TRACKING === 'true'),
    };
  },
});

export const submit = mutation({
  args: { id: v.id('errands'), rating: v.number(), comment: v.string() }, returns: v.id('reviews'),
  handler: async (ctx, { id, rating, comment }) => {
    const errand = await ownErrand(ctx, id);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ConvexError('Choose a rating from 1 to 5 stars.');
    if (comment.length > 1000) throw new ConvexError('Keep your review under 1,000 characters.');
    const text = comment.trim();
    const existing = await ctx.db.query('reviews').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    if (existing) {
      if (existing.rating !== rating || existing.comment !== text) throw new ConvexError('You have already reviewed this errand.');
      return existing._id;
    }
    if (!errand.completion || errand.status !== 'delivered') throw new ConvexError('Confirm receipt of your delivery before leaving a review.');
    const { isDemo, runnerId } = errand.completion;
    if (isDemo && (runnerId || process.env.ENABLE_DEMO_TRACKING !== 'true')) throw new ConvexError('Demo reviews are disabled.');
    if (!isDemo && (!runnerId || runnerId === errand.customerId)) throw new ConvexError('This errand does not have a runner to review.');
    const reviewId = await ctx.db.insert('reviews', { errandId: id, customerId: errand.customerId, runnerId, isDemo, rating, comment: text });
    await ctx.db.patch('errands', id, { reviewedAt: Date.now(), reviewRating: rating });
    await ctx.db.insert('errandActivity', { errandId: id, kind: 'reviewed', isDemo, summary: `${isDemo ? 'Demo: ' : ''}Customer left a ${rating}-star review.` });
    if (!isDemo) await queuePush(ctx, runnerId, id, 'review', `review:${reviewId}`);
    return reviewId;
  },
});
