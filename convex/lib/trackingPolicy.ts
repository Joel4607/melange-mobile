/** Pure policy only: no database, device APIs, timers or implicit clock reads. */
export const TRACKING_POLICY = Object.freeze({
  version: 1,
  freshnessMs: 30_000,
  pickupLockMs: 90_000,
  recoverySpanMs: 10_000,
  recoveryReadings: 2,
});

export type TrackingTransport = 'walking' | 'bicycle' | 'motorbike' | 'car';
export type TrackingCondition = 'awaiting_location' | 'current' | 'delayed' |
  'pickup_locked' | 'interrupted' | 'needs_attention' | 'ended';

type TrackingSnapshot = {
  /** All times are integer server milliseconds, supplied by the caller. */
  now: number;
  assignedAt: number;
  lastFreshReceivedAt?: number;
  ended: boolean;
  /** Sum of closed POST-pickup interruption intervals. Never reset on restart. */
  spentMs: number;
  /** Persisted freshness deadline; keep open until sustained recovery is accepted. */
  openInterruptionAt?: number;
  budgetMs: number;
};

export type TrackingPolicyInput = TrackingSnapshot & (
  { hasPickedUp: false; firstPickedUpAt?: never } |
  /** For shared work this is the FIRST pickup of the run, never the next stop. */
  { hasPickedUp: true; firstPickedUpAt: number }
);

export type TrackingPolicyResult = {
  condition: TrackingCondition;
  remainingMs: number;
  /** Tracking gates only; not substitutes for ownership, approval or stop order. */
  blockPickup: boolean;
  blockDelivery: boolean;
  /** Next policy boundary, strictly after now; null means await another event. */
  nextCheckAt: number | null;
};

export function interruptionBudgetMs(transport: TrackingTransport): number {
  switch (transport) {
    case 'walking': return 40 * 60_000;
    case 'bicycle':
    case 'motorbike':
    case 'car': return 30 * 60_000;
    default: throw new RangeError('Select a supported transport mode.');
  }
}

function milliseconds(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be non-negative integer milliseconds.`);
}

function validate(input: TrackingPolicyInput) {
  for (const name of ['now', 'assignedAt', 'spentMs', 'budgetMs'] as const) milliseconds(name, input[name]);
  if (input.budgetMs === 0 || input.now > Number.MAX_SAFE_INTEGER - TRACKING_POLICY.pickupLockMs - 1) {
    throw new RangeError('Invalid tracking budget or clock range.');
  }
  if (input.assignedAt > input.now) throw new RangeError('Assignment cannot be in the future.');
  for (const name of ['lastFreshReceivedAt', 'openInterruptionAt', 'firstPickedUpAt'] as const) {
    const time = input[name];
    if (time === undefined) continue;
    milliseconds(name, time);
    if (time < input.assignedAt || time > input.now) throw new RangeError(`${name} must fall within this assignment.`);
  }
  if (input.hasPickedUp && input.firstPickedUpAt === undefined) throw new RangeError('First pickup time is required.');
  if (!input.hasPickedUp && input.firstPickedUpAt !== undefined) throw new RangeError('Pickup time requires a picked-up run.');
}

/**
 * Task 3 must persist incident opening, cumulative spending and sustained recovery.
 * Keeping openInterruptionAt set latches an incident even if one new fix arrives.
 * If a scheduler has not opened it yet, infer expiry from the last server receipt.
 * On ending, the caller must settle the final interval into spentMs and set ended;
 * this evaluator never charges more time to a terminal obligation.
 */
export function evaluateTracking(input: TrackingPolicyInput): TrackingPolicyResult {
  validate(input);
  const closedRemaining = Math.max(0, input.budgetMs - input.spentMs);
  if (input.ended) return {
    condition: 'ended', remainingMs: closedRemaining,
    blockPickup: true, blockDelivery: true, nextCheckAt: null,
  };

  const lastReceipt = input.lastFreshReceivedAt ?? input.assignedAt;
  const staleAt = Math.min(lastReceipt + TRACKING_POLICY.freshnessMs, input.openInterruptionAt ?? Infinity);
  // Exactly 30 seconds is still fresh. Millisecond +1 avoids same-time rescheduling.
  const interrupted = input.openInterruptionAt !== undefined || input.now > staleAt;
  const pickupLockAt = staleAt + TRACKING_POLICY.pickupLockMs - TRACKING_POLICY.freshnessMs;
  const blockPickup = interrupted && input.now >= pickupLockAt;

  if (!interrupted) return {
    condition: input.lastFreshReceivedAt === undefined ? 'awaiting_location' : 'current',
    remainingMs: closedRemaining, blockPickup: false, blockDelivery: false,
    nextCheckAt: staleAt + 1,
  };

  if (!input.hasPickedUp) return {
    condition: blockPickup ? 'pickup_locked' : 'delayed', remainingMs: closedRemaining,
    blockPickup, blockDelivery: false, nextCheckAt: blockPickup ? null : pickupLockAt,
  };

  // A pickup during the grace period must not inherit time from before handover.
  const chargeFrom = Math.max(staleAt, input.firstPickedUpAt);
  const remainingMs = Math.max(0, closedRemaining - Math.max(0, input.now - chargeFrom));
  if (remainingMs === 0) return {
    condition: 'needs_attention', remainingMs: 0,
    blockPickup: true, blockDelivery: true, nextCheckAt: null,
  };
  const exhaustionAt = chargeFrom + closedRemaining;
  milliseconds('exhaustionAt', exhaustionAt);
  return {
    condition: 'interrupted', remainingMs, blockPickup, blockDelivery: false,
    nextCheckAt: blockPickup ? exhaustionAt : Math.min(pickupLockAt, exhaustionAt),
  };
}
