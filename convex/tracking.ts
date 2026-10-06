import { getAuthUserId } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { trackingCondition } from './lib/trackingFields';
import { refreshTracking, trackingState } from './lib/trackingLifecycle';

export const current = query({
  args: { id: v.id('errands') },
  returns: v.union(v.null(), v.object({
    condition: trackingCondition, policyVersion: v.number(), remainingMs: v.number(), budgetMs: v.number(),
    assignedAt: v.number(), serverNow: v.number(), lastUpdateAt: v.union(v.number(), v.null()),
    nextCheckAt: v.union(v.number(), v.null()), blockPickup: v.boolean(), blockDelivery: v.boolean(),
  })),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const e = await ctx.db.get('errands', id);
    if (!userId || !e?.trackingObligationId || e.completion || !['accepted', 'picked_up'].includes(e.status) ||
      (e.customerId !== userId && e.runnerId !== userId)) return null;
    const o = await ctx.db.get('trackingObligations', e.trackingObligationId);
    if (!o || o.endedAt !== undefined || o.runnerId !== e.runnerId || !o.memberIds.includes(id)) return null;
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', o.runnerId)).unique();
    if (!access?.enabled) return null;
    const state = trackingState(o);
    return { ...state, policyVersion: o.policyVersion, budgetMs: o.budgetMs, assignedAt: o.assignedAt,
      serverNow: Date.now(), lastUpdateAt: o.lastFreshReceivedAt ?? null };
  },
});

export const checkDeadline = internalMutation({
  args: { obligationId: v.id('trackingObligations'), generation: v.number() }, returns: v.null(),
  handler: async (ctx, { obligationId, generation }) => {
    await refreshTracking(ctx, obligationId, generation);
    return null;
  },
});
