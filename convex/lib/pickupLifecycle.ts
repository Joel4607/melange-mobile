import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export const PICKUP_APPROVAL_MS = 10 * 60_000;

export function matchesPickupAssignment(e: Doc<'errands'>, p: Doc<'pickupApprovals'> | null) {
  return !!p && p.runnerId === e.runnerId && p.obligationId === e.trackingObligationId;
}

export function pickupState(p: Doc<'pickupApprovals'> | null) {
  if (!p) return 'not_requested' as const;
  return p.state === 'approved' && (p.expiresAt ?? 0) <= Date.now() ? 'expired' as const : p.state;
}

export async function assertPickupApproved(ctx: QueryCtx, e: Doc<'errands'>) {
  if (!e.trackingObligationId) return null; // Legacy assignments are never backfilled.
  const p = await ctx.db.query('pickupApprovals').withIndex('by_errandId', q => q.eq('errandId', e._id)).unique();
  if (!matchesPickupAssignment(e, p)) throw new ConvexError('Request collection approval from this buyer before confirming pickup.');
  if (pickupState(p) === 'expired') throw new ConvexError('Collection approval expired. Request approval from the buyer again.');
  if (p!.state !== 'approved' || p!.approvedAt === undefined || p!.expiresAt === undefined || p!.consumedAt !== undefined) throw new ConvexError('Wait for this buyer’s collection approval before confirming pickup.');
  return p;
}
