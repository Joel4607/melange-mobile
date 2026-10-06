import { assertTrackingAllows, recordTrackingPickup, endTrackingMember } from './lib/trackingLifecycle';
import { assertPickupApproved } from './lib/pickupLifecycle';
import { runnerGroup, advanceSharedStop, locationMembers } from './lib/shareLifecycle';
import { queuePush } from './lib/queuePush';
import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { categoryValidator, errandFields } from './lib/errandFields';

export async function requireRunner(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  const user = id ? await ctx.db.get('users', id) : null;
  if (!user) throw new ConvexError('Sign in with your runner account.');
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
  const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
  if (user.role === 'buyer' || !access?.enabled || !profile) throw new ConvexError('Complete your runner profile to find errands.');
  return user;
}

export async function activeJob(ctx: QueryCtx, runnerId: Id<'users'>) {
  const group = await runnerGroup(ctx, runnerId);
  if (group) return await ctx.db.get('errands', group.errandIds[0]);
  const pickedUp = await ctx.db.query('errands').withIndex('by_runnerId_and_status', q => q.eq('runnerId', runnerId).eq('status', 'picked_up')).first();
  return pickedUp ?? await ctx.db.query('errands').withIndex('by_runnerId_and_status', q => q.eq('runnerId', runnerId).eq('status', 'accepted')).first();
}
export function available(errand: Doc<'errands'>, runnerId: Id<'users'>) {
  return errand.shareState !== 'waiting' && errand.shareState !== 'paired' && errand.status === 'posted' && !errand.runnerId && !errand.trackingMode && !errand.completion && errand.customerId !== runnerId;
}
const summaryValidator = v.object(errandFields).omit('description').extend({ id: v.id('errands'), createdAt: v.number(), revision: v.number(), shareGroupId: v.optional(v.id('shareGroups')) });
function summary(errand: Doc<'errands'>) {
  return { id: errand._id, shareGroupId: errand.shareGroupId, title: errand.title, category: errand.category, pickup: errand.pickup, dropoff: errand.dropoff, budgetPesewas: errand.budgetPesewas, ...(errand.budgetPurpose ? { budgetPurpose: errand.budgetPurpose } : {}), urgency: errand.urgency, createdAt: errand._creationTime, revision: errand.revision ?? 0 };
}
const activeValidator = v.object({ id: v.id('errands'), title: v.string(), status: v.string(),
  trackingRequired: v.boolean(), trackingMemberId: v.optional(v.id('errands')) });
const nullableTime = v.union(v.number(), v.null());
const recordValidator = v.object({
  acceptedAt: nullableTime, pickedUpAt: nullableTime, deliveredAt: nullableTime, confirmedAt: nullableTime,
  review: v.union(v.null(), v.object({ rating: v.number(), comment: v.string(), createdAt: v.number() })),
});

export const history = query({
  args: { filter: v.union(v.literal('all'), v.literal('active'), v.literal('awaiting'), v.literal('completed'), v.literal('cancelled')), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(summaryValidator.extend({ status: v.string(), completed: v.boolean(), updatedAt: v.number() })),
  handler: async (ctx, args) => {
    const user = await requireRunner(ctx);
    const status = args.filter === 'awaiting' || args.filter === 'completed' ? 'delivered' as const : args.filter === 'cancelled' ? 'cancelled' as const : null;
    const base = status
      ? ctx.db.query('errands').withIndex('by_runnerId_status_updatedAt', q => q.eq('runnerId', user._id).eq('status', status))
      : ctx.db.query('errands').withIndex('by_runnerId_updatedAt', q => q.eq('runnerId', user._id));
    let records = base.order('desc').filter(q => q.and(q.eq(q.field('trackingMode'), undefined), q.neq(q.field('customerId'), user._id), q.neq(q.field('completion.isDemo'), true)));
    if (args.filter === 'active') records = records.filter(q => q.or(q.eq(q.field('status'), 'accepted'), q.eq(q.field('status'), 'picked_up')));
    if (args.filter === 'awaiting') records = records.filter(q => q.eq(q.field('completion'), undefined));
    if (args.filter === 'completed') records = records.filter(q => q.neq(q.field('completion'), undefined));
    const page = await records.paginate(args.paginationOpts);
    return { ...page, page: page.page.map(errand => ({ ...summary(errand), status: errand.status, completed: !!errand.completion, updatedAt: errand.updatedAt ?? errand._creationTime })) };
  },
});

export const capacity = query({
  args: {}, returns: v.union(v.null(), activeValidator),
  handler: async ctx => {
    const user = await requireRunner(ctx);
    const active = await activeJob(ctx, user._id);
    if (!active) return null;
    // Keep the publisher's group anchor stable after its delivery. Read policy
    // through a still-active member, whose participant access has not ended.
    const member = (await locationMembers(ctx, active._id, user._id))[0];
    return { id: active._id, title: active.title, status: active.status,
      trackingRequired: !!member?.trackingObligationId,
      ...(member?.trackingObligationId ? { trackingMemberId: member._id } : {}) };
  },
});

export const availableErrands = query({
  args: {
    category: v.optional(categoryValidator), paginationOpts: paginationOptsValidator,
    urgency: v.optional(errandFields.urgency), search: v.optional(v.string()), area: v.optional(v.string()),
    minBudget: v.optional(v.number()), maxBudget: v.optional(v.number()), preferredServices: v.optional(v.boolean()),
    order: v.optional(v.union(v.literal('newest'), v.literal('oldest'))),
  },
  returns: paginationResultValidator(summaryValidator),
  handler: async (ctx, args) => {
    const user = await requireRunner(ctx);
    const search = args.search?.trim().toLowerCase() ?? '';
    const area = args.area?.trim().toLowerCase() ?? '';
    if (search.length > 100 || area.length > 100) throw new ConvexError('Keep search and area under 100 characters.');
    for (const amount of [args.minBudget, args.maxBudget]) if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000)) throw new ConvexError('Enter a valid budget range.');
    if (args.minBudget !== undefined && args.maxBudget !== undefined && args.minBudget > args.maxBudget) throw new ConvexError('Minimum budget cannot exceed maximum budget.');
    const profile = args.preferredServices ? await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', user._id)).unique() : null;
    const base = args.category
      ? ctx.db.query('errands').withIndex('by_status_and_category', q => q.eq('status', 'posted').eq('category', args.category!))
      : ctx.db.query('errands').withIndex('by_status', q => q.eq('status', 'posted'));
    const page = await base.order(args.order === 'oldest' ? 'asc' : 'desc').filter(q => q.and(
      q.neq(q.field('shareState'), 'waiting'), q.neq(q.field('shareState'), 'paired'),
      q.eq(q.field('runnerId'), undefined), q.eq(q.field('trackingMode'), undefined),
      q.eq(q.field('completion'), undefined), q.neq(q.field('customerId'), user._id),
      ...(args.urgency ? [q.eq(q.field('urgency'), args.urgency)] : []),
      ...(args.minBudget !== undefined ? [q.gte(q.field('budgetPesewas'), args.minBudget)] : []),
      ...(args.maxBudget !== undefined ? [q.lte(q.field('budgetPesewas'), args.maxBudget)] : []),
      ...(profile ? [q.or(...profile.services.map(category => q.eq(q.field('category'), category)))] : []),
    )).paginate(args.paginationOpts);
    // Preserve Convex cursors/split metadata. Text filtering can produce sparse
    // pages; clients must keep the continuation available until isDone.
    return { ...page, page: page.page.filter(e =>
      (!search || `${e.title} ${e.description} ${e.pickup} ${e.dropoff}`.toLowerCase().includes(search)) &&
      (!area || `${e.pickup} ${e.dropoff}`.toLowerCase().includes(area)),
    ).map(summary) };
  },
});

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), summaryValidator.extend({
    description: v.string(), status: v.string(), assignedToMe: v.boolean(),
    completed: v.boolean(), trackingRequired: v.boolean(), canAccept: v.boolean(), canProgress: v.boolean(), blockedReason: v.string(),
    activeErrandId: v.union(v.id('errands'), v.null()),
    record: v.union(v.null(), recordValidator),
  })),
  handler: async (ctx, { id }) => {
    const user = await requireRunner(ctx);
    const normalized = ctx.db.normalizeId('errands', id);
    const errand = normalized ? await ctx.db.get('errands', normalized) : null;
    if (!errand || (errand.runnerId !== user._id && !available(errand, user._id))) return null;
    const assignedToMe = errand.runnerId === user._id;
    const group = errand.shareGroupId ? await ctx.db.get('shareGroups', errand.shareGroupId) : null;
    const next = group?.route[group.nextStop];
    const canProgress = !group || (group.status === 'active' && next?.errandId === errand._id && next.kind === (errand.status === 'accepted' ? 'pickup' : 'dropoff'));
    const active = await activeJob(ctx, user._id);
    const review = assignedToMe ? await ctx.db.query('reviews').withIndex('by_errandId', q => q.eq('errandId', errand._id)).unique() : null;
    return { ...summary(errand), description: errand.description, status: errand.status, assignedToMe,
      completed: !!errand.completion, trackingRequired: !!errand.trackingObligationId, canAccept: !assignedToMe && !active, canProgress,
      blockedReason: !assignedToMe && active ? 'Finish your active errand before submitting another quote.' : '',
      activeErrandId: active?._id ?? null,
      record: assignedToMe ? {
        acceptedAt: errand.acceptedAt ?? null, pickedUpAt: errand.pickedUpAt ?? null,
        deliveredAt: errand.deliveredAt ?? null, confirmedAt: errand.completion?.confirmedAt ?? null,
        review: review && !review.isDemo && review.runnerId === user._id ? { rating: review.rating, comment: review.comment, createdAt: review._creationTime } : null,
      } : null,
    };
  },
});

// Older clients must not bypass the buyer's approval of a service fee.
export const accept = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number() }, returns: v.id('errands'),
  handler: async () => { throw new ConvexError('Submit a service fee and wait for buyer approval. Refresh the app to continue.'); },
});

export const advance = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number(), nextStatus: v.union(v.literal('picked_up'), v.literal('delivered')) },
  returns: v.null(),
  handler: async (ctx, { id, expectedRevision, nextStatus }) => {
    const user = await requireRunner(ctx);
    const errand = await ctx.db.get('errands', id);
    if (!errand || errand.runnerId !== user._id || errand.trackingMode === 'demo' || errand.customerId === user._id) throw new ConvexError('Only the assigned runner can update this errand.');
    // A retry of an already-reached stage cannot repeat its activity or rewind it.
    if ((nextStatus === 'picked_up' && (errand.status === 'picked_up' || errand.status === 'delivered')) || (nextStatus === 'delivered' && errand.status === 'delivered')) return null;
    if (errand.completion || errand.status !== (nextStatus === 'picked_up' ? 'accepted' : 'picked_up')) throw new ConvexError('Complete pickup before delivery. Ended errands cannot be changed.');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (errand.revision ?? 0)) throw new ConvexError('This errand changed. Review its latest status and try again.');
    if (nextStatus === 'delivered') {
      const proof = await ctx.db.query('deliveryProofs').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
      if (!proof || proof.runnerId !== user._id) throw new ConvexError('Upload a handover photo before marking this errand delivered.');
    }
    const approval = nextStatus === 'picked_up' ? await assertPickupApproved(ctx, errand) : null;
    await assertTrackingAllows(ctx, id, nextStatus === 'picked_up' ? 'pickup' : 'delivery');
    await advanceSharedStop(ctx, errand, nextStatus);
    const now = Date.now();
    if (approval) await ctx.db.patch('pickupApprovals', approval._id, { state: 'consumed', consumedAt: now });
    await ctx.db.patch('errands', id, { status: nextStatus, revision: (errand.revision ?? 0) + 1, updatedAt: now, ...(nextStatus === 'picked_up' ? { pickedUpAt: now } : { deliveredAt: now }) });
    if (nextStatus === 'picked_up') await recordTrackingPickup(ctx, id);
    else await endTrackingMember(ctx, id);
    await ctx.db.insert('errandActivity', { errandId: id, kind: nextStatus, isDemo: false, summary: nextStatus === 'picked_up' ? 'Runner confirmed pickup and is on the way to delivery.' : 'Runner reported delivery. Awaiting the buyer’s confirmation.' });
    await queuePush(ctx, errand.customerId, id, nextStatus, `${nextStatus}:${id}`);
    if (nextStatus === 'delivered') {
      const location = await ctx.db.query('runnerLocations').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
      if (location) await ctx.db.patch('runnerLocations', location._id, { sharing: false, sessionId: undefined, expiryScheduled: false });
      const nearby = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', user._id)).unique();
      if (nearby && !await activeJob(ctx, user._id)) await ctx.db.patch('errandRunners', nearby._id, { status: 'offline' });
    }
    return null;
  },
});
