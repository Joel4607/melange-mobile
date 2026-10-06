import { describe, expect, test } from 'vitest';
import { evaluateTracking, interruptionBudgetMs, type TrackingPolicyInput } from '../convex/lib/trackingPolicy';

const beforePickup = (overrides: Partial<TrackingPolicyInput> = {}): TrackingPolicyInput => ({
  now: 0, assignedAt: 0, ended: false, hasPickedUp: false,
  spentMs: 0, budgetMs: 1_800_000, ...overrides,
} as TrackingPolicyInput);
const afterPickup = (overrides: Partial<TrackingPolicyInput> = {}): TrackingPolicyInput => ({
  ...beforePickup(), hasPickedUp: true, firstPickedUpAt: 0, ...overrides,
} as TrackingPolicyInput);

describe('transport allowance', () => {
  test.each([['walking', 2_400_000], ['bicycle', 1_800_000], ['motorbike', 1_800_000], ['car', 1_800_000]] as const)(
    '%s receives %i milliseconds', (mode, expected) => expect(interruptionBudgetMs(mode)).toBe(expected),
  );
  test.each([undefined, null, '', 'vehicle', 'bus'])('rejects unsupported/missing mode %s', mode => {
    expect(() => interruptionBudgetMs(mode as 'walking')).toThrow();
  });
});

describe('pre-pickup freshness and grace boundaries', () => {
  test.each([
    [0, 'awaiting_location', false, 30_001],
    [30_000, 'awaiting_location', false, 30_001],
    [30_001, 'delayed', false, 90_000],
    [89_999, 'delayed', false, 90_000],
    [90_000, 'pickup_locked', true, null],
  ] as const)('no first fix at %i: %s', (now, condition, blockPickup, nextCheckAt) => {
    expect(evaluateTracking(beforePickup({ now }))).toEqual({
      condition, blockPickup, blockDelivery: false, remainingMs: 1_800_000, nextCheckAt,
    });
  });
  test('freshness is measured from the accepted server receipt, including timestamp zero', () => {
    expect(evaluateTracking(beforePickup({ now: 30_000, lastFreshReceivedAt: 0 })).condition).toBe('current');
    expect(evaluateTracking(beforePickup({ now: 30_001, lastFreshReceivedAt: 0 })).condition).toBe('delayed');
    expect(evaluateTracking(beforePickup({ now: 90_000, lastFreshReceivedAt: 20_000 }))).toMatchObject({
      condition: 'delayed', blockPickup: false, nextCheckAt: 110_000,
    });
  });
  test('an open recovery interval retains the lock despite an isolated fresh reading', () => {
    expect(evaluateTracking(beforePickup({ now: 100_000, lastFreshReceivedAt: 99_000, openInterruptionAt: 30_000 })))
      .toMatchObject({ condition: 'pickup_locked', blockPickup: true, remainingMs: 1_800_000 });
    expect(evaluateTracking(beforePickup({ now: 110_000, lastFreshReceivedAt: 110_000 })))
      .toMatchObject({ condition: 'current', blockPickup: false, nextCheckAt: 140_001 });
  });
});

describe('post-pickup cumulative accounting', () => {
  test('infers missed interruption from freshness deadline rather than scheduler execution time', () => {
    expect(evaluateTracking(afterPickup({ now: 630_000, spentMs: 1_200_000 }))).toEqual({
      condition: 'needs_attention', blockPickup: true, blockDelivery: true, remainingMs: 0, nextCheckAt: null,
    });
  });
  test.each([[629_999, 1, 'interrupted', 630_000], [630_000, 0, 'needs_attention', null], [700_000, 0, 'needs_attention', null]] as const)(
    'cumulative allowance at %i', (now, remainingMs, condition, nextCheckAt) => {
      expect(evaluateTracking(afterPickup({ now, spentMs: 1_200_000, openInterruptionAt: 30_000 })))
        .toMatchObject({ remainingMs, condition, nextCheckAt, blockDelivery: remainingMs === 0 });
    },
  );
  test('does not charge an interruption before actual pickup against the post-pickup budget', () => {
    expect(evaluateTracking(afterPickup({ now: 120_000, firstPickedUpAt: 60_000, openInterruptionAt: 30_000 })))
      .toMatchObject({ remainingMs: 1_740_000, nextCheckAt: 1_860_000 });
  });
  test('walking retains ten minutes after the vehicle allowance would expire', () => {
    expect(evaluateTracking(afterPickup({ now: 1_830_000, budgetMs: interruptionBudgetMs('walking') })))
      .toMatchObject({ condition: 'interrupted', remainingMs: 600_000, nextCheckAt: 2_430_000 });
  });
  test('shared later pickup locks at 90 seconds while existing delivery retains its allowance', () => {
    expect(evaluateTracking(afterPickup({ now: 89_999 })))
      .toMatchObject({ blockPickup: false, blockDelivery: false, nextCheckAt: 90_000 });
    expect(evaluateTracking(afterPickup({ now: 90_000 })))
      .toMatchObject({ condition: 'interrupted', blockPickup: true, blockDelivery: false, nextCheckAt: 1_830_000 });
  });
  test('recovery allows progress without resetting consumed allowance; the next gap has no new budget', () => {
    const recovered = afterPickup({ now: 2_000_000, lastFreshReceivedAt: 2_000_000, spentMs: 1_800_000 });
    expect(evaluateTracking(recovered)).toMatchObject({ condition: 'current', remainingMs: 0, blockPickup: false, blockDelivery: false });
    expect(evaluateTracking({ ...recovered, now: 2_030_000 }).condition).toBe('current');
    expect(evaluateTracking({ ...recovered, now: 2_030_001 })).toMatchObject({ condition: 'needs_attention', blockDelivery: true });
  });
  test('one recovery candidate cannot hide exhaustion while the interruption is still open', () => {
    expect(evaluateTracking(afterPickup({ now: 1_900_000, lastFreshReceivedAt: 1_899_999, openInterruptionAt: 30_000 })))
      .toMatchObject({ condition: 'needs_attention', remainingMs: 0 });
  });
  test('ended obligation (including final shared delivery) stops scheduling and elapsed accrual', () => {
    expect(evaluateTracking(afterPickup({ now: 9_000_000, ended: true, spentMs: 500_000, openInterruptionAt: 30_000 })))
      .toEqual({ condition: 'ended', remainingMs: 1_300_000, blockPickup: true, blockDelivery: true, nextCheckAt: null });
  });
  test('evaluation is pure and deterministic for a server-time snapshot', () => {
    const input = Object.freeze(afterPickup({ now: 120_000, openInterruptionAt: 30_000 }));
    expect(evaluateTracking(input)).toEqual(evaluateTracking({ ...input }));
    expect(input.spentMs).toBe(0);
  });
});

describe('invalid state cannot silently grant progression', () => {
  test.each([
    { now: NaN }, { now: Infinity }, { now: -1 }, { now: 0.5 },
    { assignedAt: 1 }, { lastFreshReceivedAt: 1 }, { openInterruptionAt: 1 },
    { spentMs: -1 }, { spentMs: Infinity }, { budgetMs: 0 }, { budgetMs: NaN },
    { now: Number.MAX_SAFE_INTEGER },
  ])('rejects invalid numeric state %j', invalid => expect(() => evaluateTracking(beforePickup(invalid))).toThrow());
  test('requires a valid first-pickup time rather than assuming assignment was pickup', () => {
    expect(() => evaluateTracking(afterPickup({ firstPickedUpAt: undefined }))).toThrow();
    expect(() => evaluateTracking(afterPickup({ firstPickedUpAt: 1 }))).toThrow();
  });
});
