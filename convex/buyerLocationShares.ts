import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { locationPoint } from './lib/locationFields';
import { buyerShareAuthorized, clearBuyerLocationShare } from './lib/buyerLocationShare';

async function identity(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  if (!id || !(await ctx.db.get('users', id))) throw new ConvexError('Sign in to share location.');
  return id;
}

// New explicit-consent API. Retired buyerLocations endpoints stay denied, so
// old clients and stored historical coordinates cannot become visible again.
export const current = query({
  args: { id: v.id('errands') },
  returns: v.union(v.null(), v.object({ point: locationPoint, receivedAt: v.number() })),
  handler: async (ctx, { id }) => {
    const userId = await identity(ctx);
    const row = await ctx.db.query('buyerLocationShares').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    if (!row || (userId !== row.buyerId && userId !== row.runnerId) || !row.sharing || !row.point ||
      Math.min(row.receivedAt, row.point.capturedAt) + 30000 <= Date.now() || !(await buyerShareAuthorized(ctx, row))) return null;
    return { point: row.point, receivedAt: row.receivedAt };
  },
});
export const start = mutation({
  args: { id: v.id('errands'), sessionId: v.string(), consent: v.literal(true) }, returns: v.null(),
  handler: async (ctx, { id, sessionId }) => {
    const buyerId = await identity(ctx);
    const errand = await ctx.db.get('errands', id);
    if (!errand || errand.customerId !== buyerId || !errand.runnerId || errand.runnerId === buyerId) throw new ConvexError('Only this buyer can share their location with their assigned runner.');
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(sessionId)) throw new ConvexError('Invalid location session.');
    const row = { errandId: id, buyerId, runnerId: errand.runnerId, sessionId, sharing: true, startedAt: Date.now(), receivedAt: Date.now() };
    if (!(await buyerShareAuthorized(ctx, row))) throw new ConvexError('Location sharing is available only during an active errand.');
    const old = await ctx.db.query('buyerLocationShares').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    if (old?.buyerId === buyerId && old.sessionId === sessionId && old.sharing) return null;
    const rowId = old ? old._id : await ctx.db.insert('buyerLocationShares', row);
    if (old) await ctx.db.patch('buyerLocationShares', rowId, { ...row, point: undefined });
    await ctx.scheduler.runAfter(30000, internal.buyerLocationShares.expire, { id: rowId, sessionId });
    return null;
  },
});
export const publish = mutation({
  args: { id: v.id('errands'), sessionId: v.string(), point: locationPoint }, returns: v.boolean(),
  handler: async (ctx, { id, sessionId, point }) => {
    const buyerId = await identity(ctx);
    const row = await ctx.db.query('buyerLocationShares').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    if (!row || row.buyerId !== buyerId || !row.sharing || row.sessionId !== sessionId || row.receivedAt + 30000 <= Date.now() || !(await buyerShareAuthorized(ctx, row))) return false;
    if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180 ||
      !Number.isFinite(point.capturedAt) || point.capturedAt < Date.now() - 30000 || point.capturedAt > Date.now() + 10000 || point.capturedAt < row.startedAt - 10000 ||
      (point.accuracy !== undefined && (!Number.isFinite(point.accuracy) || point.accuracy < 0))) throw new ConvexError('A fresh, valid GPS reading is required.');
    if (row.point && (point.capturedAt <= row.point.capturedAt || Date.now() - row.receivedAt < 1500)) return false;
    await ctx.db.patch('buyerLocationShares', row._id, { point, receivedAt: Date.now() });
    return true;
  },
});
export const stop = mutation({
  args: { id: v.id('errands'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, { id, sessionId }) => {
    const buyerId = await identity(ctx);
    const row = await ctx.db.query('buyerLocationShares').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    if (row?.buyerId === buyerId && row.sessionId === sessionId) await clearBuyerLocationShare(ctx, id);
    return null;
  },
});
export const expire = internalMutation({
  args: { id: v.id('buyerLocationShares'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, { id, sessionId }) => {
    const row = await ctx.db.get('buyerLocationShares', id);
    if (!row?.sharing || row.sessionId !== sessionId) return null;
    const remaining = Math.min(row.receivedAt, row.point?.capturedAt ?? row.receivedAt) + 30000 - Date.now();
    if (remaining <= 0 || !(await buyerShareAuthorized(ctx, row))) await clearBuyerLocationShare(ctx, row.errandId);
    else await ctx.scheduler.runAfter(remaining, internal.buyerLocationShares.expire, { id, sessionId });
    return null;
  },
});
