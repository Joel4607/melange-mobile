import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { interruptionBudgetMs, TRACKING_POLICY } from './trackingPolicy';
import { trackingState } from './trackingState';
export { trackingState } from './trackingState';
import { queueTrackingTransition } from './trackingNotifications';
import { clearMemberLocation } from './locationCleanup';

type Obligation = Doc<'trackingObligations'>;
const active = (e: Doc<'errands'> | null) => !!e && !e.completion && ['accepted', 'picked_up'].includes(e.status);
// Enable only with tasks 4–6 UI/integration, so intermediate deploys remain usable.
const rolloutEnabled = () => process.env.ENABLE_LOCATION_ACCOUNTABILITY === 'true';

export async function assignmentLocationIsFresh(ctx: QueryCtx, runnerId: Id<'users'>, reservedGroupId?: Id<'shareGroups'>) {
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', runnerId)).unique();
  const point = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', runnerId)).unique();
  const group = reservedGroupId ? await ctx.db.get('shareGroups', reservedGroupId) : null;
  const reserved = group?.status === 'reserved' && group.runnerId === runnerId && group.expiresAt > Date.now();
  return !!(access?.enabled && access.locationSessionId && point && point.locationSessionId === access.locationSessionId &&
    (reserved ? point.status === 'busy' : point.status === 'online') &&
    Number.isFinite(point.capturedAt) && point.capturedAt >= Date.now() - TRACKING_POLICY.freshnessMs &&
    point.capturedAt <= Date.now() + 10_000 && point.updatedAt >= Date.now() - TRACKING_POLICY.freshnessMs);
}

export async function requireFreshAssignment(ctx: QueryCtx, runnerId: Id<'users'>, groupId?: Id<'shareGroups'>) {
  if (!await assignmentTrackingReady(ctx, runnerId, groupId)) throw new ConvexError('The runner needs a fresh location update before you can approve. Ask them to go online and try again.');
}

export async function assignmentTrackingReady(ctx: QueryCtx, runnerId: Id<'users'>, groupId?: Id<'shareGroups'>) {
  return !rolloutEnabled() || await assignmentLocationIsFresh(ctx, runnerId, groupId);
}

/** Called within assignment's transaction, before availability sessions are fenced. */
export async function createTrackingObligation(ctx: MutationCtx, memberIds: Id<'errands'>[], runnerId: Id<'users'>, shareGroupId?: Id<'shareGroups'>) {
  if (!rolloutEnabled()) return;
  if (memberIds.length < 1 || memberIds.length > 2 || new Set(memberIds).size !== memberIds.length) throw new ConvexError('Invalid tracking membership.');
  if (await ctx.db.query('trackingObligations').withIndex('by_runnerId_and_endedAt', q => q.eq('runnerId', runnerId).eq('endedAt', undefined)).first()) throw new ConvexError('This runner already has active tracking.');
  const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', runnerId)).unique();
  const point = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', runnerId)).unique();
  if (!profile || !point) throw new ConvexError('Runner profile and fresh location are required.');
  const id = await ctx.db.insert('trackingObligations', { runnerId, memberIds, shareGroupId,
    policyVersion: 1, assignedAt: Date.now(), transport: profile.transport,
    budgetMs: interruptionBudgetMs(profile.transport), spentMs: 0, lastCapturedAt: point.capturedAt,
    condition: 'awaiting_location', generation: 0 });
  for (const memberId of memberIds) await ctx.db.patch('errands', memberId, { trackingObligationId: id });
  await refreshTracking(ctx, id);
  return id;
}

function openIfOverdue(o: Obligation, now: number): Obligation {
  const deadline = (o.lastFreshReceivedAt ?? o.assignedAt) + TRACKING_POLICY.freshnessMs;
  return o.endedAt === undefined && o.openInterruptionAt === undefined && now > deadline ? { ...o, openInterruptionAt: deadline } : o;
}

const transitionText = {
  awaiting_location: 'Waiting for the runner’s first location update.', current: 'Runner location updates are current.',
  delayed: 'Runner location updates are delayed.', pickup_locked: 'Pickup is paused until location updates recover.',
  interrupted: 'Runner location updates are interrupted. The run’s remaining allowance applies.',
  needs_attention: 'Location tracking needs attention. Progress is paused until updates recover.', ended: 'Location tracking has ended.',
};

/** Timing-only events. Never copy coordinates or another buyer's details. */
async function saveState(ctx: MutationCtx, previous: Obligation, next: Obligation) {
  const state = trackingState(next);
  next.condition = state.condition;
  if (state.condition !== previous.condition) {
    for (const id of next.memberIds) {
      const e = await ctx.db.get('errands', id);
      if (active(e) && e?.runnerId === next.runnerId && e.trackingObligationId === next._id) await ctx.db.insert('errandActivity', {
        errandId: id, kind: 'edited', isDemo: false, summary: transitionText[state.condition],
      });
    }
    await queueTrackingTransition(ctx, previous, next);
  }
  // Keep an earlier outstanding wakeup; do not enqueue a job for every GPS fix.
  if (state.nextCheckAt === null) {
    if (next.scheduledFor !== undefined) { next.generation++; next.scheduledFor = undefined; }
  } else if (next.scheduledFor === undefined || next.scheduledFor > state.nextCheckAt) {
    next.generation++; next.scheduledFor = state.nextCheckAt;
    await ctx.scheduler.runAt(state.nextCheckAt, internal.tracking.checkDeadline, { obligationId: next._id, generation: next.generation });
  }
  // Explicit optional fields ensure clearing recovery/incident state removes them.
  const { _id, _creationTime, ...fields } = next;
  await ctx.db.replace('trackingObligations', _id, fields);
}

export async function refreshTracking(ctx: MutationCtx, id: Id<'trackingObligations'>, generation?: number) {
  const old = await ctx.db.get('trackingObligations', id);
  if (!old || old.endedAt !== undefined || (generation !== undefined && generation !== old.generation)) return;
  const next = openIfOverdue({ ...old }, Date.now());
  if (generation !== undefined) next.scheduledFor = undefined;
  await saveState(ctx, old, next);
}

function intervalSpent(o: Obligation, now: number) {
  return o.openInterruptionAt !== undefined && o.firstPickedUpAt !== undefined ?
    Math.max(0, now - Math.max(o.openInterruptionAt, o.firstPickedUpAt)) : 0;
}

/** Authorized session checked by caller. Server receipt drives countdowns, never device time. */
export async function acceptTrackingFix(ctx: MutationCtx, id: Id<'trackingObligations'>, capturedAt: number) {
  const old = await ctx.db.get('trackingObligations', id);
  const now = Date.now();
  if (!old || old.endedAt !== undefined || !Number.isFinite(capturedAt) || capturedAt <= old.lastCapturedAt ||
    capturedAt < now - TRACKING_POLICY.freshnessMs || capturedAt > now + 10_000) return false;
  const next = openIfOverdue({ ...old }, now);
  next.lastCapturedAt = capturedAt;
  next.lastFreshReceivedAt = now;
  if (next.openInterruptionAt !== undefined) {
    if (next.recoveryStartedAt === undefined || now - (next.recoveryLastReceivedAt ?? 0) > TRACKING_POLICY.freshnessMs) {
      next.recoveryStartedAt = now; next.recoveryFirstCapturedAt = capturedAt;
    } else if (now - next.recoveryStartedAt >= TRACKING_POLICY.recoverySpanMs && capturedAt - next.recoveryFirstCapturedAt! >= TRACKING_POLICY.recoverySpanMs) {
      next.spentMs += intervalSpent(next, now);
      next.recoveredIncidentAt = next.openInterruptionAt;
      next.openInterruptionAt = undefined;
      next.recoveryStartedAt = undefined; next.recoveryFirstCapturedAt = undefined;
    }
    next.recoveryLastReceivedAt = next.openInterruptionAt === undefined ? undefined : now;
  }
  await saveState(ctx, old, next);
  return true;
}

export async function assertTrackingAllows(ctx: QueryCtx, id: Id<'errands'>, action: 'pickup' | 'delivery') {
  const e = await ctx.db.get('errands', id);
  if (!e?.trackingObligationId) return; // Explicitly legacy assignment; no retroactive policy.
  const o = await ctx.db.get('trackingObligations', e.trackingObligationId);
  if (!o || o.runnerId !== e.runnerId || !o.memberIds.includes(id)) throw new ConvexError('Tracking assignment is unavailable.');
  const state = trackingState(o);
  if (action === 'pickup' ? state.blockPickup : state.blockDelivery) throw new ConvexError('Restore fresh location updates for at least 10 seconds before continuing.');
}

export async function recordTrackingPickup(ctx: MutationCtx, id: Id<'errands'>) {
  const e = await ctx.db.get('errands', id);
  if (!e?.trackingObligationId) return;
  const old = await ctx.db.get('trackingObligations', e.trackingObligationId);
  if (!old || old.endedAt !== undefined) return;
  const next = openIfOverdue({ ...old }, Date.now());
  next.firstPickedUpAt ??= Date.now();
  await saveState(ctx, old, next);
}

export async function endTrackingMember(ctx: MutationCtx, id: Id<'errands'>) {
  await clearMemberLocation(ctx, id);
  const e = await ctx.db.get('errands', id);
  if (!e?.trackingObligationId) return;
  const old = await ctx.db.get('trackingObligations', e.trackingObligationId);
  if (!old || old.endedAt !== undefined) return;
  for (const memberId of old.memberIds) {
    const member = await ctx.db.get('errands', memberId);
    if (active(member) && member?.runnerId === old.runnerId && member.trackingObligationId === old._id) return;
  }
  const next = openIfOverdue({ ...old }, Date.now());
  next.spentMs += intervalSpent(next, Date.now());
  next.endedAt = Date.now(); next.openInterruptionAt = undefined;
  next.recoveryStartedAt = undefined; next.recoveryFirstCapturedAt = undefined; next.recoveryLastReceivedAt = undefined;
  await saveState(ctx, old, next);
}
