import type { Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export async function buyerShareAuthorized(ctx: QueryCtx, row: { errandId: Id<'errands'>; buyerId: Id<'users'>; runnerId: Id<'users'> }) {
  const errand = await ctx.db.get('errands', row.errandId);
  if (!errand || errand.completion || !['accepted', 'picked_up'].includes(errand.status) ||
    errand.trackingMode === 'demo' || errand.customerId !== row.buyerId || errand.runnerId !== row.runnerId) return false;
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', row.runnerId)).unique();
  return !!access?.enabled;
}
export async function clearBuyerLocationShare(ctx: MutationCtx, id: Id<'errands'>) {
  const row = await ctx.db.query('buyerLocationShares').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
  if (row) await ctx.db.patch('buyerLocationShares', row._id, { point: undefined, sessionId: undefined, sharing: false });
}
