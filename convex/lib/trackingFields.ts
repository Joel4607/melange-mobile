import { v } from 'convex/values';

export const trackingCondition = v.union(v.literal('awaiting_location'), v.literal('current'),
  v.literal('delayed'), v.literal('pickup_locked'), v.literal('interrupted'),
  v.literal('needs_attention'), v.literal('ended'));

export const trackingFields = {
  runnerId: v.id('users'), memberIds: v.array(v.id('errands')),
  shareGroupId: v.optional(v.id('shareGroups')), policyVersion: v.literal(1),
  assignedAt: v.number(), firstPickedUpAt: v.optional(v.number()),
  transport: v.union(v.literal('walking'), v.literal('bicycle'), v.literal('motorbike'), v.literal('car')),
  budgetMs: v.number(), spentMs: v.number(), openInterruptionAt: v.optional(v.number()),
  lastFreshReceivedAt: v.optional(v.number()), lastCapturedAt: v.number(),
  recoveryStartedAt: v.optional(v.number()), recoveryFirstCapturedAt: v.optional(v.number()),
  recoveryLastReceivedAt: v.optional(v.number()), condition: trackingCondition,
  recoveredIncidentAt: v.optional(v.number()),
  generation: v.number(), scheduledFor: v.optional(v.number()), endedAt: v.optional(v.number()),
};
