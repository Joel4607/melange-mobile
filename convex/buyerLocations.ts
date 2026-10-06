import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { locationPoint } from './lib/locationFields';
async function identity(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  if (!id || !(await ctx.db.get('users', id))) throw new ConvexError('Sign in to manage location.');
  return id;
}
// Compatibility endpoints deliberately deny retired live buyer sharing, including old clients.
export const current = query({
  args: { id: v.id('errands') }, returns: v.union(v.null(), v.object({ point: locationPoint, receivedAt: v.number() })),
  handler: async ctx => { await identity(ctx); return null; },
});
export const start = mutation({
  args: { id: v.id('errands'), sessionId: v.string() }, returns: v.null(),
  handler: async ctx => { await identity(ctx); throw new ConvexError('Live buyer location sharing is retired. Save a destination pin instead.'); },
});
export const publish = mutation({
  args: { id: v.id('errands'), sessionId: v.string(), point: locationPoint }, returns: v.boolean(),
  handler: async ctx => { await identity(ctx); return false; },
});
export const stop = mutation({
  args: { id: v.id('errands'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, { id, sessionId }) => {
    const buyerId = await identity(ctx);
    const old = await ctx.db.query('buyerLocations').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    if (old && old.buyerId === buyerId && old.sessionId === sessionId) await ctx.db.patch('buyerLocations', old._id, { sharing: false, point: undefined, sessionId: undefined, expiryScheduled: false });
    return null;
  },
});

export const expire = internalMutation({
  args: { id: v.id('buyerLocations'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get('buyerLocations', args.id);
    if (row?.sessionId === args.sessionId) await ctx.db.patch('buyerLocations', row._id, { point: undefined, sessionId: undefined, sharing: false, expiryScheduled: false });
    return null;
  },
});
// Bounded retirement migration. Read denial is immediate, independently of cleanup timing.
export const purgeRetired = internalMutation({
  args: {}, returns: v.null(), handler: async ctx => {
    const rows = await ctx.db.query('buyerLocations').take(100);
    for (const row of rows) await ctx.db.delete('buyerLocations', row._id);
    if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.buyerLocations.purgeRetired, {});
    return null;
  },
});
