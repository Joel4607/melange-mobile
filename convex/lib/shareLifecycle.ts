import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { queuePush } from './queuePush';

export async function runnerGroup(ctx: QueryCtx, runnerId: Id<'users'>) {
  return await ctx.db.query('shareGroups').withIndex('by_runnerId_and_status', q => q.eq('runnerId', runnerId).eq('status', 'active')).first()
    ?? await ctx.db.query('shareGroups').withIndex('by_runnerId_and_status', q => q.eq('runnerId', runnerId).eq('status', 'reserved')).first();
}
export async function dissolveShare(ctx: MutationCtx, errand: Doc<'errands'>, reason: string) {
  const group = errand.shareGroupId ? await ctx.db.get('shareGroups', errand.shareGroupId) : null;
  if (group && (group.status === 'active' || group.status === 'delivered')) throw new ConvexError('An assigned shared run cannot be changed.');
  const ids = group && group.status !== 'dissolved' ? group.errandIds : [errand._id];
  if (group && group.status !== 'dissolved') await ctx.db.patch('shareGroups', group._id, { status: 'dissolved', reason });
  for (const id of ids) {
    const e = await ctx.db.get('errands', id);
    if (e && e.status === 'posted' && (e.shareState === 'paired' || e.shareState === 'waiting')) {
      await ctx.db.patch('errands', id, { shareState: 'released', shareGroupId: undefined, shareWindowEndsAt: undefined, revision: (e.revision ?? 0) + 1 });
      await ctx.db.insert('errandActivity', { errandId: id, kind: 'edited', summary: `Errand Share: ${reason} Ordinary matching is available.` });
      await queuePush(ctx, e.customerId, id, 'share', `share-release:${group?._id ?? id}:${e.revision ?? 0}`);
    }
  }
  if (group?.runnerId) await queuePush(ctx, group.runnerId, group.errandIds[0], 'share', `share-release:${group._id}`);
}
export async function advanceSharedStop(ctx: MutationCtx, e: Doc<'errands'>, nextStatus: 'picked_up' | 'delivered') {
  if (!e.shareGroupId) return;
  const group = await ctx.db.get('shareGroups', e.shareGroupId);
  if (!group || group.status !== 'active' || group.runnerId !== e.runnerId) throw new ConvexError('Shared run unavailable.');
  const next = group.route[group.nextStop];
  if (next?.errandId !== e._id || next.kind !== (nextStatus === 'picked_up' ? 'pickup' : 'dropoff')) throw new ConvexError('Follow the next stop shown in your shared route.');
  await ctx.db.patch('shareGroups', group._id, { nextStop: group.nextStop + 1, ...(group.nextStop === 3 ? { status: 'delivered' as const } : {}) });
}
// One GPS session broadcasts only to the still-active members of this run.
export async function locationMembers(ctx: QueryCtx, id: Id<'errands'>, runnerId: Id<'users'>) {
  const e = await ctx.db.get('errands', id);
  if (!e || e.runnerId !== runnerId) return [];
  const group = e.shareGroupId ? await ctx.db.get('shareGroups', e.shareGroupId) : null;
  const ids = group?.status === 'active' && group.runnerId === runnerId ? group.errandIds : [id];
  const docs = await Promise.all(ids.map(member => ctx.db.get('errands', member)));
  return docs.filter((doc): doc is Doc<'errands'> => !!doc && doc.runnerId === runnerId && !doc.completion && !doc.trackingMode && (doc.status === 'accepted' || doc.status === 'picked_up'));
}
