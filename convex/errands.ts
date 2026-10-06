import { endTrackingMember } from './lib/trackingLifecycle';
import { clearMemberLocation } from './lib/locationCleanup';
import { dissolveShare } from './lib/shareLifecycle';
import { queuePush } from './lib/queuePush';
import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import { errandFields } from './lib/errandFields';
import schema from './schema';
import { sharePoint } from './lib/shareFields';
import type { Doc, Id } from './_generated/dataModel';

type Fields = Pick<Doc<'errands'>, keyof typeof errandFields>;
function validateFields(args: Fields): Fields {
  const title = args.title.trim();
  const description = args.description.trim();
  const pickup = args.pickup.trim();
  const dropoff = args.dropoff.trim();
  if (title.length < 3 || title.length > 100) throw new ConvexError('Title must be 3–100 characters.');
  if (description.length > 2000) throw new ConvexError('Keep details under 2,000 characters.');
  if ([pickup, dropoff].some((text) => text.length < 3 || text.length > 300)) throw new ConvexError('Enter pickup and delivery addresses of 3–300 characters.');
  if (!Number.isSafeInteger(args.budgetPesewas) || args.budgetPesewas < (args.budgetPurpose === 'items' ? 0 : 100) || args.budgetPesewas > 1000000) throw new ConvexError('Enter a valid budget up to GH₵10,000.');
  return { title, description, pickup, dropoff, category: args.category, urgency: args.urgency, budgetPesewas: args.budgetPesewas, ...(args.budgetPurpose ? { budgetPurpose: args.budgetPurpose } : {}) };
}

async function owned(ctx: QueryCtx, id: Id<'errands'>) {
  const customerId = await customer(ctx);
  const errand = await ctx.db.get('errands', id);
  if (!errand || errand.customerId !== customerId) throw new ConvexError('Errand not found.');
  return errand;
}
function editable(errand: Doc<'errands'>, expectedRevision: number) {
  if (errand.status !== 'posted' || errand.runnerId) throw new ConvexError('Only posted, unassigned errands can be changed.');
  if (!Number.isSafeInteger(expectedRevision) || (errand.revision ?? 0) !== expectedRevision) throw new ConvexError('This errand changed since you opened it. Close this form and reopen it to use the latest details.');
}

async function customer(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  if (!id || !(await ctx.db.get('users', id))) throw new ConvexError('Sign in to manage your errands.');
  return id;
}

export const create = mutation({
  args: { ...errandFields, requestId: v.string() },
  returns: v.id('errands'),
  handler: async (ctx, args) => {
    const customerId = await customer(ctx);
    const fields = validateFields(args);
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(args.requestId)) throw new ConvexError('Invalid submission reference.');
    // Retrying the same submission cannot create a second errand.
    const existing = await ctx.db.query('errands').withIndex('by_customerId_and_requestId', (q) => q.eq('customerId', customerId).eq('requestId', args.requestId)).unique();
    if (existing) return existing._id;
    return await ctx.db.insert('errands', { ...fields, requestId: args.requestId, customerId, status: 'posted', revision: 0 });
  },
});

export const mine = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc('errands')),
  handler: async (ctx, args) => {
    const customerId = await customer(ctx);
    return await ctx.db.query('errands').withIndex('by_customerId', (q) => q.eq('customerId', customerId)).order('desc').paginate(args.paginationOpts);
  },
});

export const get = query({
  args: { id: v.string() },
  returns: v.union(v.null(), schema.doc('errands')),
  handler: async (ctx, { id }) => {
    const customerId = await customer(ctx);
    const normalizedId = ctx.db.normalizeId('errands', id);
    if (!normalizedId) return null;
    const errand = await ctx.db.get('errands', normalizedId);
    return errand?.customerId === customerId ? errand : null;
  },
});

export const update = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number(), ...errandFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    const errand = await owned(ctx, args.id);
    editable(errand, args.expectedRevision);
    const fields = validateFields(args);
    const labels: Record<keyof Fields, string> = { title: 'Title', description: 'Instructions', category: 'Service', pickup: 'Pickup address', dropoff: 'Delivery address', budgetPesewas: 'Budget', budgetPurpose: 'Budget purpose', urgency: 'Timing' };
    const changed = (Object.keys(labels) as (keyof Fields)[]).filter((key) => fields[key] !== errand[key]);
    if (!changed.length) return null;
    await dissolveShare(ctx, errand, 'An errand was edited.');
    await ctx.db.patch('errands', args.id, { sharePickup: undefined, shareDropoff: undefined, ...fields, revision: (errand.revision ?? 0) + 1, updatedAt: Date.now() });
    await ctx.db.insert('errandActivity', { errandId: args.id, kind: 'edited', summary: `Updated: ${changed.map((key) => labels[key]).join(', ')}.` });
    return null;
  },
});

export const saveDestinations = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number(), pickup: sharePoint, dropoff: sharePoint }, returns: v.null(),
  handler: async (ctx, args) => {
    const e = await owned(ctx, args.id);
    editable(e, args.expectedRevision);
    if (e.trackingMode || e.completion || e.shareState === 'waiting' || e.shareState === 'paired') throw new ConvexError('Leave shared matching before changing map pins.');
    for (const p of [args.pickup, args.dropoff]) if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) throw new ConvexError('Choose valid map pins.');
    await ctx.db.patch('errands', e._id, { sharePickup: args.pickup, shareDropoff: args.dropoff, revision: (e.revision ?? 0) + 1, updatedAt: Date.now() });
    await ctx.db.insert('errandActivity', { errandId: e._id, kind: 'edited', summary: 'Confirmed pickup and delivery map pins. Review updated quotes before approval.' });
    return null;
  },
});

// Project only this errand's saved destinations, never other members of its shared run.
export const destinations = query({
  args: { id: v.id('errands') },
  returns: v.union(v.null(), v.object({ pickup: v.string(), dropoff: v.string(), status: v.string(), pickupPoint: v.union(v.null(), sharePoint), dropoffPoint: v.union(v.null(), sharePoint) })),
  handler: async (ctx, { id }) => {
    const userId = await customer(ctx), e = await ctx.db.get('errands', id);
    if (!e || (e.customerId !== userId && e.runnerId !== userId)) return null;
    if (e.runnerId === userId) {
      const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', userId)).unique();
      if (!access?.enabled) return null;
    }
    return { pickup: e.pickup, dropoff: e.dropoff, status: e.status, pickupPoint: e.sharePickup ?? null, dropoffPoint: e.shareDropoff ?? null };
  },
});

export const cancel = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const errand = await owned(ctx, args.id);
    if (errand.status === 'cancelled') return null;
    editable(errand, args.expectedRevision);
    const reason = args.reason.trim();
    if (reason.length > 500) throw new ConvexError('Keep the cancellation reason under 500 characters.');
    await dissolveShare(ctx, errand, 'An errand was cancelled.');
    await ctx.db.patch('errands', args.id, { status: 'cancelled', cancellationReason: reason, revision: (errand.revision ?? 0) + 1, updatedAt: Date.now() });
    await endTrackingMember(ctx, args.id);
    await ctx.db.insert('errandActivity', { errandId: args.id, kind: 'cancelled', summary: reason || 'Cancelled by you.' });
    return null;
  },
});

export const history = query({
  args: { id: v.id('errands'), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc('errandActivity')),
  handler: async (ctx, args) => {
    await owned(ctx, args.id);
    return await ctx.db.query('errandActivity').withIndex('by_errandId', (q) => q.eq('errandId', args.id)).order('desc').paginate(args.paginationOpts);
  },
});

export const confirmCompletion = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const errand = await owned(ctx, args.id);
    if (errand.completion) return null;
    if (errand.status !== 'delivered') throw new ConvexError('Delivery must be reported before you can confirm completion.');
    if (!Number.isSafeInteger(args.expectedRevision) || (errand.revision ?? 0) !== args.expectedRevision) throw new ConvexError('This errand changed. Check the latest details and confirm again.');
    const isDemo = errand.trackingMode === 'demo';
    if (isDemo && (process.env.ENABLE_DEMO_TRACKING !== 'true' || errand.runnerId)) throw new ConvexError('Demo completion is unavailable for this errand.');
    if (!isDemo && (!errand.runnerId || errand.runnerId === errand.customerId)) throw new ConvexError('A real delivery must have an assigned runner.');
    const now = Date.now();
    await ctx.db.patch('errands', args.id, {
      completion: { confirmedAt: now, runnerId: isDemo ? undefined : errand.runnerId, isDemo },
      updatedAt: now, revision: (errand.revision ?? 0) + 1,
    });
    if (!isDemo) await queuePush(ctx, errand.runnerId, args.id, 'completed', `completed:${args.id}`);
    await clearMemberLocation(ctx, args.id);
    await ctx.db.insert('errandActivity', {
      errandId: args.id, kind: 'completed', isDemo,
      summary: isDemo ? 'Demo: customer confirmed the simulated delivery.' : 'Customer confirmed receipt and completed the errand.',
    });
    return null;
  },
});

// Off unless explicitly enabled for a prototype deployment. Customer controls
// never progress a request linked to a runner.
export const trackingOptions = query({
  args: {},
  returns: v.object({ demoEnabled: v.boolean() }),
  handler: async () => ({ demoEnabled: process.env.ENABLE_DEMO_TRACKING === 'true' }),
});

export const advanceDemoTracking = mutation({
  args: {
    id: v.id('errands'), expectedRevision: v.number(),
    nextStatus: v.union(v.literal('accepted'), v.literal('picked_up'), v.literal('delivered')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (process.env.ENABLE_DEMO_TRACKING !== 'true') throw new ConvexError('Demo tracking is not enabled on this deployment.');
    const errand = await owned(ctx, args.id);
    if (errand.shareState === 'waiting' || errand.shareState === 'paired') throw new ConvexError('Leave Errand Share before starting a demo.');
    if (errand.runnerId) throw new ConvexError('Demo controls cannot change an errand assigned to a runner.');
    if (errand.trackingMode === 'demo' && errand.status === args.nextStatus) return null;
    if (!Number.isSafeInteger(args.expectedRevision) || (errand.revision ?? 0) !== args.expectedRevision) throw new ConvexError('This errand has changed. Check the latest status and try again.');
    const previous = { accepted: 'posted', picked_up: 'accepted', delivered: 'picked_up' } as const;
    if (errand.status !== previous[args.nextStatus]) throw new ConvexError('Tracking must move forward one step at a time.');
    if (errand.status !== 'posted' && errand.trackingMode !== 'demo') throw new ConvexError('Demo controls cannot change a live errand.');
    const now = Date.now();
    const timestamp = args.nextStatus === 'accepted' ? { acceptedAt: now } : args.nextStatus === 'picked_up' ? { pickedUpAt: now } : { deliveredAt: now };
    await ctx.db.patch('errands', args.id, { status: args.nextStatus, trackingMode: 'demo', ...timestamp, updatedAt: now, revision: (errand.revision ?? 0) + 1 });
    const summaries = { accepted: 'Demo: request accepted. No real runner has been assigned.', picked_up: 'Demo: items picked up. No real pickup has taken place.', delivered: 'Demo: items delivered. No real delivery has taken place.' };
    await ctx.db.insert('errandActivity', { errandId: args.id, kind: args.nextStatus, isDemo: true, summary: summaries[args.nextStatus] });
    return null;
  },
});
