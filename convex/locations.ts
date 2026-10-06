import { locationMembers } from './lib/shareLifecycle';
import { acceptTrackingFix, refreshTracking } from './lib/trackingLifecycle';
import { locationStillAuthorized } from './lib/locationCleanup';
import { runnerGroup } from './lib/shareLifecycle';
import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v, type Infer } from 'convex/values';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { locationPoint } from './lib/locationFields';

async function identity(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  if (!id || !(await ctx.db.get('users', id))) throw new ConvexError('Sign in to use location tracking.');
  return id;
}
function active(status: string) { return status === 'accepted' || status === 'picked_up'; }
async function assignedRunner(ctx: QueryCtx, id: Id<'errands'>) {
  const userId = await identity(ctx);
  const errand = await ctx.db.get('errands', id);
  if (!errand || errand.runnerId !== userId || errand.customerId === userId || errand.trackingMode === 'demo' || !(await locationMembers(ctx, id, userId)).length) throw new ConvexError('Only the assigned runner can share location for an active errand.');
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', userId)).unique();
  if (!access?.enabled) throw new ConvexError('Runner location access is unavailable.');
  return userId;
}
async function demoErrand(ctx: QueryCtx, id: Id<'errands'>) {
  const userId = await identity(ctx);
  if (process.env.ENABLE_DEMO_TRACKING !== 'true') throw new ConvexError('Demo tracking is disabled.');
  const errand = await ctx.db.get('errands', id);
  if (!errand || errand.customerId !== userId || errand.runnerId || errand.trackingMode !== 'demo' || !active(errand.status)) throw new ConvexError('Location demos require your own active demo errand.');
  return userId;
}
function validate(point: Infer<typeof locationPoint>) {
  if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) throw new ConvexError('Invalid map coordinates.');
  if (!Number.isFinite(point.capturedAt) || point.capturedAt < Date.now() - 60000 || point.capturedAt > Date.now() + 10000) throw new ConvexError('Location reading is too old or has an invalid timestamp.');
  if (point.accuracy !== undefined && (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 100000)) throw new ConvexError('Invalid location accuracy.');
}

export const current = query({
  args: { id: v.id('errands') }, returns: v.union(v.null(), schema.doc('runnerLocations')),
  handler: async (ctx, { id }) => {
    const userId = await identity(ctx);
    const errand = await ctx.db.get('errands', id);
    if (errand?.runnerId) {
      const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', errand.runnerId!)).unique();
      if (!access?.enabled) return null;
    }
    if (errand?.runnerId === userId && (!active(errand.status) || errand.completion)) {
      const member = (await locationMembers(ctx, id, userId))[0];
      const row = member ? await ctx.db.query('runnerLocations').withIndex('by_errandId', q => q.eq('errandId', member._id)).unique() : null;
      return row?.source === 'runner_gps' && row.publisherId === userId ? row : null;
    }
    if (!errand || errand.completion || (errand.customerId !== userId && errand.runnerId !== userId) || !active(errand.status)) return null;
    const location = await ctx.db.query('runnerLocations').withIndex('by_errandId', (q) => q.eq('errandId', id)).unique();
    if (!location) return null;
    if (location.source === 'runner_gps' ? location.publisherId !== errand.runnerId : !!errand.runnerId || location.publisherId !== errand.customerId || errand.trackingMode !== 'demo') return null;
    return location;
  },
});

export const startDemo = mutation({
  args: { id: v.id('errands'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const publisherId = await demoErrand(ctx, args.id);
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(args.sessionId)) throw new ConvexError('Invalid sharing session.');
    const old = await ctx.db.query('runnerLocations').withIndex('by_errandId', (q) => q.eq('errandId', args.id)).unique();
    const values = { errandId: args.id, publisherId, sessionId: args.sessionId, source: 'demo_route' as const, sharing: true, receivedAt: Date.now() };
    if (old) await ctx.db.replace('runnerLocations', old._id, values);
    else await ctx.db.insert('runnerLocations', values);
    return null;
  },
});
export const publishDemo = mutation({
  args: { id: v.id('errands'), sessionId: v.string(), point: locationPoint }, returns: v.boolean(),
  handler: async (ctx, args) => {
    await demoErrand(ctx, args.id); validate(args.point);
    const current = await ctx.db.query('runnerLocations').withIndex('by_errandId', (q) => q.eq('errandId', args.id)).unique();
    if (!current || current.source === 'runner_gps' || current.sessionId !== args.sessionId || !current.sharing) return false;
    if (current.point && (args.point.capturedAt <= current.point.capturedAt || Date.now() - current.receivedAt < 1500)) return false;
    await ctx.db.patch('runnerLocations', current._id, { point: args.point, receivedAt: Date.now() });
    return true;
  },
});
export const stopDemo = mutation({
  args: { id: v.id('errands'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await identity(ctx);
    const errand = await ctx.db.get('errands', args.id);
    if (!errand || errand.customerId !== userId) throw new ConvexError('Errand not found.');
    const current = await ctx.db.query('runnerLocations').withIndex('by_errandId', (q) => q.eq('errandId', args.id)).unique();
    if (current && current.source !== 'runner_gps' && current.sessionId === args.sessionId) await ctx.db.patch('runnerLocations', current._id, { sharing: false });
    return null;
  },
});

export const startRunner = mutation({
  args: { id: v.id('errands'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, { id, sessionId }) => {
    const publisherId = await assignedRunner(ctx, id);
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(sessionId)) throw new ConvexError('Invalid sharing session.');
    for (const member of await locationMembers(ctx, id, publisherId)) {
      const old = await ctx.db.query('runnerLocations').withIndex('by_errandId', q => q.eq('errandId', member._id)).unique();
      if (old?.source === 'runner_gps' && old.publisherId === publisherId && old.sessionId === sessionId) continue;
      const retained = member.trackingObligationId && old?.publisherId === publisherId && old.source === 'runner_gps' ? old : null;
      const values = { errandId: member._id, publisherId, source: 'runner_gps' as const, sessionId, sharing: false, receivedAt: retained?.receivedAt ?? Date.now(), point: retained?.point, expiryScheduled: false };
      if (old) await ctx.db.replace('runnerLocations', old._id, values);
      else await ctx.db.insert('runnerLocations', values);
      if (member.trackingObligationId) await refreshTracking(ctx, member.trackingObligationId);
    }
    return null;
  },
});

export const stopRunner = mutation({
  args: { id: v.id('errands'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, { id, sessionId }) => {
    const userId = await identity(ctx);
    const e = await ctx.db.get('errands', id);
    const g = e?.shareGroupId ? await ctx.db.get('shareGroups', e.shareGroupId) : null;
    for (const memberId of g?.runnerId === userId ? g.errandIds : [id]) {
      const current = await ctx.db.query('runnerLocations').withIndex('by_errandId', q => q.eq('errandId', memberId)).unique();
      if (current?.source === 'runner_gps' && current.publisherId === userId && current.sessionId === sessionId) {
        await ctx.db.patch('runnerLocations', current._id, { sharing: false, sessionId: undefined, expiryScheduled: false });
        const member = await ctx.db.get('errands', memberId);
        if (member?.trackingObligationId) await refreshTracking(ctx, member.trackingObligationId);
      }
    }
    return null;
  },
});

// Latest GPS only; session checks prevent queued updates from undoing a stop.
export const publishRunner = mutation({
  args: { id: v.id('errands'), sessionId: v.string(), point: locationPoint }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const publisherId = await assignedRunner(ctx, args.id);
    validate(args.point);
    let updated = false;
    const acceptedObligations = new Map<Id<'trackingObligations'>, boolean>();
    for (const member of await locationMembers(ctx, args.id, publisherId)) {
      const old = await ctx.db.query('runnerLocations').withIndex('by_errandId', (q) => q.eq('errandId', member._id)).unique();
      if (!old || old.source !== 'runner_gps' || old.publisherId !== publisherId || old.sessionId !== args.sessionId) continue;
      if (old.point && (args.point.capturedAt <= old.point.capturedAt || Date.now() - old.receivedAt < 1500)) continue;
      if (member.trackingObligationId) {
        const obligationId = member.trackingObligationId;
        if (!acceptedObligations.has(obligationId)) acceptedObligations.set(obligationId, await acceptTrackingFix(ctx, obligationId, args.point.capturedAt));
        if (!acceptedObligations.get(obligationId)) continue;
      }
      const nearby = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', publisherId)).unique();
      if (nearby && nearby.status === 'online') await ctx.db.patch('errandRunners', nearby._id, { status: 'busy' });
      await ctx.db.patch('runnerLocations', old._id, { point: args.point, receivedAt: Date.now(), sharing: true, expiryScheduled: true });
      if (!old.expiryScheduled) await ctx.scheduler.runAfter(Math.max(0, Math.min(Date.now(), args.point.capturedAt) + 30_000 - Date.now()), internal.locations.expireRunner, { id: old._id, sessionId: args.sessionId });
      updated = true;
    }
    return updated;
  },
});

// Materialize GPS expiry so buyer subscriptions change even if the phone closes.
export const expireRunner = internalMutation({
  args: { id: v.id('runnerLocations'), sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const location = await ctx.db.get('runnerLocations', args.id);
    if (!location || location.source !== 'runner_gps' || location.sessionId !== args.sessionId) return null;
    const errand = await ctx.db.get('errands', location.errandId);
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', location.publisherId)).unique();
    const remaining = Math.min(location.receivedAt, location.point?.capturedAt ?? location.receivedAt) + 30_000 - Date.now();
    if (location.sharing && remaining > 0 && access?.enabled && errand?.runnerId === location.publisherId && active(errand.status) && !errand.completion) {
      await ctx.scheduler.runAfter(remaining, internal.locations.expireRunner, args);
    } else await ctx.db.patch('runnerLocations', location._id, { sharing: false, expiryScheduled: false });
    return null;
  },
});

/** Terminal coordinates were already removed atomically; delete the empty row. */
export const cleanupTerminal = internalMutation({
  args: { id: v.id('runnerLocations') }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get('runnerLocations', id);
    if (row && !await locationStillAuthorized(ctx, row)) await ctx.db.delete('runnerLocations', id);
    return null;
  },
});

/** Bounded historical cleanup; a delayed job cannot remove a newly active session. */
export const cleanupRunner = internalMutation({
  args: { publisherId: v.id('users'), cursor: v.union(v.string(), v.null()) }, returns: v.null(),
  handler: async (ctx, { publisherId, cursor }) => {
    const page = await ctx.db.query('runnerLocations').withIndex('by_publisherId', q => q.eq('publisherId', publisherId)).paginate({ cursor, numItems: 50 });
    for (const row of page.page) if (row.source === 'runner_gps' && !await locationStillAuthorized(ctx, row)) await ctx.db.delete('runnerLocations', row._id);
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.locations.cleanupRunner, { publisherId, cursor: page.continueCursor });
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', publisherId)).unique();
    const nearby = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', publisherId)).unique();
    const assignments = await Promise.all(['accepted', 'picked_up'].map(status => ctx.db.query('errands').withIndex('by_runnerId_and_status', q => q.eq('runnerId', publisherId).eq('status', status as 'accepted' | 'picked_up')).first()));
    if (nearby && (!access?.enabled || (!access.locationSessionId && nearby.status === 'offline' && !assignments.some(Boolean) && !await runnerGroup(ctx, publisherId)))) await ctx.db.delete('errandRunners', nearby._id);
    return null;
  },
});
