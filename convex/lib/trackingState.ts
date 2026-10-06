import type { Doc } from '../_generated/dataModel';
import { evaluateTracking } from './trackingPolicy';

/** Shared projection for queries, progression and notification dispatch checks. */
export function trackingState(o: Doc<'trackingObligations'>, now = Date.now()) {
  return evaluateTracking({ now, assignedAt: o.assignedAt, lastFreshReceivedAt: o.lastFreshReceivedAt,
    ended: o.endedAt !== undefined, spentMs: o.spentMs, openInterruptionAt: o.openInterruptionAt,
    budgetMs: o.budgetMs, ...(o.firstPickedUpAt === undefined ? { hasPickedUp: false as const } :
      { hasPickedUp: true as const, firstPickedUpAt: o.firstPickedUpAt }) });
}
