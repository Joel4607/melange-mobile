import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, query } from './_generated/server';
import { activeJob, available, requireRunner } from './runnerJobs';
import { runnerTrust } from './lib/runnerTrust';
import { trustSummary } from './lib/trustFields';
import { compareRunnerTrust, TRUST_QUOTE_LIMIT } from './lib/trustScore';

export const refreshClock = internalMutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const at = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const clock = await ctx.db.query('trustClock').withIndex('by_key', q => q.eq('key', 'daily')).unique();
    if (!clock) await ctx.db.insert('trustClock', { key: 'daily', at });
    else if (clock.at < at) await ctx.db.patch('trustClock', clock._id, { at });
    return null;
  },
});
export const mine = query({
  args: {}, returns: trustSummary,
  handler: async ctx => runnerTrust(ctx, (await requireRunner(ctx))._id),
});
export const forErrand = query({
  args: { id: v.id('errands') }, returns: v.union(trustSummary, v.null()),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx); const errand = await ctx.db.get('errands', id);
    if (!userId || !errand || (errand.customerId !== userId && errand.runnerId !== userId)) throw new ConvexError('Errand not found.');
    if (!errand.runnerId || errand.trackingMode || errand.runnerId === errand.customerId) return null;
    return runnerTrust(ctx, errand.runnerId);
  },
});
export const recommendations = query({
  args: { id: v.id('errands') },
  returns: v.object({ candidates: v.array(v.object({ quoteId: v.id('runnerQuotes'), name: v.string(), fee: v.number(), trust: trustSummary })), assessed: v.number(), capped: v.boolean() }),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx); const errand = await ctx.db.get('errands', id);
    if (!userId || !errand || errand.customerId !== userId) throw new ConvexError('Errand not found.');
    if (errand.status !== 'posted' || errand.runnerId || errand.trackingMode || errand.completion) return { candidates: [], assessed: 0, capped: false };
    const quotes = await ctx.db.query('runnerQuotes').withIndex('by_errandId', q => q.eq('errandId', id))
      .order('desc').filter(q => q.and(q.eq(q.field('status'), 'pending'), q.eq(q.field('errandRevision'), errand.revision ?? 0))).take(TRUST_QUOTE_LIMIT + 1);
    const assessed = await Promise.all(quotes.slice(0, TRUST_QUOTE_LIMIT).map(async quote => {
      const runner = await ctx.db.get('users', quote.runnerId);
      const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', quote.runnerId)).unique();
      const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', quote.runnerId)).unique();
      if (!runner || runner.role === 'buyer' || !access?.enabled || !profile || !available(errand, runner._id) || await activeJob(ctx, runner._id)) return null;
      return { quoteId: quote._id, name: runner.name || 'Runner', fee: quote.serviceFeePesewas, trust: await runnerTrust(ctx, runner._id) };
    }));
    const eligible = assessed.filter((item): item is NonNullable<typeof item> => item !== null);
    eligible.sort((a, b) => compareRunnerTrust(a.trust, b.trust) || a.quoteId.localeCompare(b.quoteId));
    return { candidates: eligible.slice(0, 3), assessed: eligible.length, capped: quotes.length > TRUST_QUOTE_LIMIT };
  },
});
