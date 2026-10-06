import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { matchesPickupAssignment, pickupState, PICKUP_APPROVAL_MS } from './lib/pickupLifecycle';
import { trackingState } from './lib/trackingLifecycle';
import { queuePush } from './lib/queuePush';

async function participant(ctx: QueryCtx, id: Id<'errands'>) {
  const userId = await getAuthUserId(ctx);
  const e = await ctx.db.get('errands', id);
  if (!userId || !e?.runnerId || !e.trackingObligationId || e.trackingMode || e.completion ||
    e.customerId === e.runnerId || !['accepted', 'picked_up'].includes(e.status) ||
    (e.customerId !== userId && e.runnerId !== userId)) return null;
  const o = await ctx.db.get('trackingObligations', e.trackingObligationId);
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', e.runnerId!)).unique();
  if (!access?.enabled || !o || o.endedAt !== undefined || o.runnerId !== e.runnerId || !o.memberIds.includes(id)) return null;
  const row = await ctx.db.query('pickupApprovals').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
  return { userId, e, o, row: matchesPickupAssignment(e, row) ? row : null };
}

export const request = mutation({
  args: { id: v.id('errands') }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const data = await participant(ctx, id);
    if (!data || data.userId !== data.e.runnerId || data.e.status !== 'accepted') throw new ConvexError('Only the assigned runner can request collection approval for an active pickup.');
    if (data.row && ['requested', 'approved'].includes(pickupState(data.row))) return null;
    const existing = await ctx.db.query('pickupApprovals').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    const requestVersion = (existing?.requestVersion ?? 0) + 1;
    const fields = { errandId: id, runnerId: data.e.runnerId!, obligationId: data.e.trackingObligationId!,
      requestVersion, requestedAt: Date.now(), state: 'requested' as const };
    if (existing) await ctx.db.replace('pickupApprovals', existing._id, fields);
    else await ctx.db.insert('pickupApprovals', fields);
    await ctx.db.insert('errandActivity', { errandId: id, kind: 'edited', isDemo: false,
      summary: 'Your runner requested collection approval. Confirm the collection arrangement before approving.' });
    await queuePush(ctx, data.e.customerId, id, 'pickup_request', `pickup-request:${data.o._id}:${id}:${requestVersion}`,
      { trackingObligationId: data.o._id, pickupRequestVersion: requestVersion });
    return null;
  },
});

export const approve = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number(), expectedRequestVersion: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const data = await participant(ctx, args.id);
    if (!data || data.userId !== data.e.customerId || data.e.status !== 'accepted') throw new ConvexError('Only this errand’s buyer can approve collection.');
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision !== (data.e.revision ?? 0)) throw new ConvexError('This errand changed. Review its latest details.');
    const p = data.row;
    if (!p || !Number.isSafeInteger(args.expectedRequestVersion) || p.requestVersion !== args.expectedRequestVersion) throw new ConvexError('The collection request changed. Review the latest request before approving.');
    if (pickupState(p) === 'approved') return null;
    if (p.state !== 'requested') throw new ConvexError('Ask the runner to send a new collection request.');
    const approvedAt = Date.now(), expiresAt = approvedAt + PICKUP_APPROVAL_MS;
    await ctx.db.patch('pickupApprovals', p._id, { state: 'approved', approvedAt, expiresAt });
    await ctx.scheduler.runAt(expiresAt, internal.pickup.expire, { approvalId: p._id, requestVersion: p.requestVersion });
    await ctx.db.insert('errandActivity', { errandId: args.id, kind: 'edited', isDemo: false,
      summary: 'You approved collection by your assigned runner. The runner still needs to confirm receiving the items.' });
    return null;
  },
});

export const current = query({
  args: { id: v.id('errands') }, returns: v.union(v.null(), v.object({
    status: v.union(v.literal('not_requested'), v.literal('requested'), v.literal('approved'), v.literal('expired'), v.literal('consumed')),
    runnerName: v.string(), requestVersion: v.number(), requestedAt: v.union(v.number(), v.null()),
    approvedAt: v.union(v.number(), v.null()), expiresAt: v.union(v.number(), v.null()), serverNow: v.number(),
    canRequest: v.boolean(), canApprove: v.boolean(), canConfirm: v.boolean(), blockedReason: v.string(),
  })),
  handler: async (ctx, { id }) => {
    const data = await participant(ctx, id);
    if (!data) return null;
    const { e, row: p, o, userId } = data;
    const status = pickupState(p);
    const g = e.shareGroupId ? await ctx.db.get('shareGroups', e.shareGroupId) : null;
    const next = g?.route[g.nextStop];
    const nextPickup = !g || (g.status === 'active' && g.runnerId === e.runnerId && next?.errandId === id && next.kind === 'pickup');
    const tracking = trackingState(o);
    const blockedReason = !nextPickup ? 'Follow the next stop in your shared route.' : tracking.blockPickup ? 'Restore location updates for at least ten seconds before confirming pickup.' : '';
    const runner = await ctx.db.get('users', e.runnerId!);
    return { status, runnerName: runner?.name?.trim() || 'Your runner', requestVersion: p?.requestVersion ?? 0,
      requestedAt: p?.requestedAt ?? null, approvedAt: p?.approvedAt ?? null, expiresAt: p?.expiresAt ?? null,
      serverNow: Date.now(), canRequest: userId === e.runnerId && e.status === 'accepted' && ['not_requested', 'expired'].includes(status),
      canApprove: userId === e.customerId && e.status === 'accepted' && status === 'requested',
      canConfirm: userId === e.runnerId && e.status === 'accepted' && status === 'approved' && !blockedReason,
      blockedReason,
    };
  },
});

export const expire = internalMutation({
  args: { approvalId: v.id('pickupApprovals'), requestVersion: v.number() }, returns: v.null(),
  handler: async (ctx, { approvalId, requestVersion }) => {
    const p = await ctx.db.get('pickupApprovals', approvalId);
    if (!p || p.requestVersion !== requestVersion || p.state !== 'approved' || p.expiresAt === undefined) return null;
    if (p.expiresAt > Date.now()) {
      await ctx.scheduler.runAt(p.expiresAt, internal.pickup.expire, { approvalId, requestVersion });
    } else await ctx.db.patch('pickupApprovals', p._id, { state: 'expired' });
    return null;
  },
});
