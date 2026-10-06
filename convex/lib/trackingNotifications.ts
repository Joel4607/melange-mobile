import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { queuePush } from './queuePush';
import { TRACKING_POLICY } from './trackingPolicy';
import { trackingState } from './trackingState';

export function isTrackingPush(kind: Doc<'pushJobs'>['kind']) {
  return kind === 'pickup_request' || kind === 'tracking_interrupted' || kind === 'tracking_attention' || kind === 'tracking_recovered';
}

/** Resolve current membership before dispatch/opening; only the runner may follow a remaining member. */
export async function trackingPushTarget(ctx: QueryCtx, job: Doc<'pushJobs'>) {
  let e = await ctx.db.get('errands', job.errandId);
  if (!isTrackingPush(job.kind)) return e;
  if (!e || e.trackingMode ||
    !job.trackingObligationId || e.trackingObligationId !== job.trackingObligationId ||
    (job.userId !== e.customerId && job.userId !== e.runnerId)) return null;
  const o = await ctx.db.get('trackingObligations', job.trackingObligationId);
  const runnerId = e.runnerId!;
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', runnerId)).unique();
  if (!access?.enabled || !o || o.endedAt !== undefined || o.runnerId !== e.runnerId || !o.memberIds.includes(e._id)) return null;
  if (e.completion || !['accepted', 'picked_up'].includes(e.status)) {
    if (job.userId !== o.runnerId || job.kind === 'pickup_request') return null;
    e = null;
    for (const id of o.memberIds) {
      const member = await ctx.db.get('errands', id);
      if (member && !member.completion && !member.trackingMode && member.runnerId === o.runnerId &&
        member.trackingObligationId === o._id && ['accepted', 'picked_up'].includes(member.status)) { e = member; break; }
    }
    if (!e) return null;
  }
  if (job.kind === 'pickup_request') {
    const p = await ctx.db.query('pickupApprovals').withIndex('by_errandId', q => q.eq('errandId', e._id)).unique();
    return job.userId === e.customerId && e.status === 'accepted' && !!p && p.state === 'requested' &&
      p.runnerId === o.runnerId && p.obligationId === o._id && p.requestVersion === job.pickupRequestVersion ? e : null;
  }
  if (job.trackingIncidentAt === undefined) return null;
  const condition = trackingState(o).condition;
  if (job.kind === 'tracking_recovered') return condition === 'current' && o.openInterruptionAt === undefined && o.recoveredIncidentAt === job.trackingIncidentAt ? e : null;
  if (o.openInterruptionAt !== job.trackingIncidentAt) return null;
  const relevant = job.kind === 'tracking_attention' ? condition === 'needs_attention' : ['delayed', 'pickup_locked', 'interrupted'].includes(condition);
  return relevant ? e : null;
}

export async function trackingPushIsRelevant(ctx: QueryCtx, job: Doc<'pushJobs'>) {
  return !isTrackingPush(job.kind) || !!await trackingPushTarget(ctx, job);
}

/** Once per run incident and kind, independently addressed to each active buyer. */
export async function queueTrackingTransition(ctx: MutationCtx, previous: Doc<'trackingObligations'>, next: Doc<'trackingObligations'>) {
  let kind: 'tracking_interrupted' | 'tracking_attention' | 'tracking_recovered';
  if (['delayed', 'pickup_locked', 'interrupted'].includes(next.condition)) kind = 'tracking_interrupted';
  else if (next.condition === 'needs_attention') kind = 'tracking_attention';
  else if (next.condition === 'current' && next.recoveredIncidentAt !== undefined && previous.recoveredIncidentAt !== next.recoveredIncidentAt) kind = 'tracking_recovered';
  else return;
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', next.runnerId)).unique();
  if (!access?.enabled) return;
  const incidentAt = kind === 'tracking_recovered' ? next.recoveredIncidentAt! : next.openInterruptionAt ?? (next.lastFreshReceivedAt ?? next.assignedAt) + TRACKING_POLICY.freshnessMs;
  const context = { trackingObligationId: next._id, trackingIncidentAt: incidentAt };
  const key = `tracking:${next._id}:${incidentAt}:${kind}`;
  let runnerTarget: Doc<'errands'> | null = null;
  for (const id of next.memberIds) {
    const e = await ctx.db.get('errands', id);
    if (!e || e.completion || e.runnerId !== next.runnerId || e.trackingObligationId !== next._id || !['accepted', 'picked_up'].includes(e.status)) continue;
    runnerTarget ??= e;
    await queuePush(ctx, e.customerId, id, kind, key, context);
  }
  if (runnerTarget) await queuePush(ctx, next.runnerId, runnerTarget._id, kind, key, context);
}
