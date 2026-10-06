import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { clearBuyerLocationShare } from './buyerLocationShare';

export async function locationStillAuthorized(ctx: QueryCtx, row: Doc<'runnerLocations'>) {
  const e = await ctx.db.get('errands', row.errandId);
  if (!e || e.completion || !['accepted', 'picked_up'].includes(e.status)) return false;
  if (row.source === 'demo_route') return !e.runnerId && e.trackingMode === 'demo' && e.customerId === row.publisherId;
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', row.publisherId)).unique();
  return !!access?.enabled && e.runnerId === row.publisherId && !e.trackingMode;
}

async function fenceLocation(ctx: MutationCtx, row: Doc<'runnerLocations'>) {
  await ctx.db.patch('runnerLocations', row._id, { point: undefined, sharing: false, sessionId: undefined, expiryScheduled: false });
  await ctx.scheduler.runAfter(0, internal.locations.cleanupTerminal, { id: row._id });
}

export async function clearMemberLocation(ctx: MutationCtx, id: Id<'errands'>) {
  const e = await ctx.db.get('errands', id);
  if (e && !e.completion && ['accepted', 'picked_up'].includes(e.status)) return;
  await clearBuyerLocationShare(ctx, id);
  const row = await ctx.db.query('runnerLocations').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
  if (row) await fenceLocation(ctx, row);
  if (e?.runnerId) await ctx.scheduler.runAfter(0, internal.locations.cleanupRunner, { publisherId: e.runnerId, cursor: null });
}

export async function fenceRunnerLocations(ctx: MutationCtx, publisherId: Id<'users'>) {
  // Find active members by assignment, independently of historical row ordering.
  // A runner can have one solo assignment or two members of one shared run.
  const assignments = await Promise.all(['accepted', 'picked_up'].map(status =>
    ctx.db.query('errands').withIndex('by_runnerId_and_status', q => q.eq('runnerId', publisherId).eq('status', status as 'accepted' | 'picked_up')).take(3)));
  const fenced = new Set<Id<'runnerLocations'>>();
  for (const e of assignments.flat()) {
    await clearBuyerLocationShare(ctx, e._id);
    const row = await ctx.db.query('runnerLocations').withIndex('by_errandId', q => q.eq('errandId', e._id)).unique();
    if (row?.source === 'runner_gps' && row.publisherId === publisherId) { await fenceLocation(ctx, row); fenced.add(row._id); }
  }
  const rows = await ctx.db.query('runnerLocations').withIndex('by_publisherId', q => q.eq('publisherId', publisherId)).order('desc').take(50);
  for (const row of rows) if (row.source === 'runner_gps' && !fenced.has(row._id)) await fenceLocation(ctx, row);
  await ctx.scheduler.runAfter(0, internal.locations.cleanupRunner, { publisherId, cursor: null });
}
