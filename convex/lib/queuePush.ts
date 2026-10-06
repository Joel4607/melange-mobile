import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import type { pushCopy } from './pushFields';
export type TrackingPushContext = { trackingObligationId: Id<'trackingObligations'>; trackingIncidentAt?: number; pickupRequestVersion?: number };

// Called only from authorised business mutations, inside their transaction.
export async function queuePush(ctx: MutationCtx, userId: Id<'users'> | undefined, errandId: Id<'errands'>, kind: keyof typeof pushCopy, eventKey: string, tracking?: TrackingPushContext) {
  if (!userId) return;
  const errand = await ctx.db.get('errands', errandId);
  if (!errand || errand.trackingMode || errand.completion?.isDemo) return;
  const devices = await ctx.db.query('pushDevices').withIndex('by_userId', q => q.eq('userId', userId)).take(5);
  for (const device of devices) {
    if (!(kind === 'message' ? device.messages : device.updates)) continue;
    const old = await ctx.db.query('pushJobs').withIndex('by_deviceId_and_eventKey', q => q.eq('deviceId', device._id).eq('eventKey', eventKey)).unique();
    if (old) continue;
    const id = await ctx.db.insert('pushJobs', { userId, deviceId: device._id, errandId, kind, eventKey, ...tracking, state: 'pending', attempts: 0 });
    await ctx.scheduler.runAfter(0, internal.pushDelivery.send, { id });
  }
}
