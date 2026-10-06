import { expect, test } from 'vitest';
import { trackingPresentation, type TrackingView } from '../src/lib/tracking-presentation';

const snapshot: TrackingView = { condition: 'awaiting_location', remainingMs: 1_800_000, budgetMs: 1_800_000,
  assignedAt: 1000, serverNow: 1000, lastUpdateAt: null, nextCheckAt: 31_001, blockPickup: false, blockDelivery: false };

test('initial waiting explains automatic private tracking without requiring another start', () => {
  const view = trackingPresentation(snapshot, 0, true);
  expect(view.title).toBe('Waiting for location');
  expect(view.description).toContain('automatically');
  expect(view.countdownMs).toBe(30_001);
});
test('delay shows the server pickup deadline without spending the delivery allowance', () => {
  const view = trackingPresentation({ ...snapshot, condition: 'delayed', serverNow: 31_001, nextCheckAt: 91_000 }, 1000, true);
  expect(view.title).toBe('Location delayed');
  expect(view.countdownMs).toBe(58_999);
  expect(view.remainingMs).toBe(snapshot.budgetMs);
});
test('pickup lock preserves navigation, chat and the buyer approval request', () => {
  const view = trackingPresentation({ ...snapshot, condition: 'pickup_locked', blockPickup: true, nextCheckAt: null }, 1000, true);
  expect(view.title).toBe('Restore location before pickup');
  expect(view.description).toMatch(/chat.*directions.*approval/i);
  expect(view.blockPickup).toBe(true); expect(view.blockDelivery).toBe(false);
});
test('post-pickup interruption counts down cumulatively while delivery is still permitted', () => {
  const view = trackingPresentation({ ...snapshot, condition: 'interrupted', remainingMs: 600_000 }, 15_000, true);
  expect(view.remainingMs).toBe(585_000);
  expect(view.blockDelivery).toBe(false);
  expect(view.description).toContain('fresh');
});
test('exhaustion uses neutral needs-attention copy and blocks progression', () => {
  const view = trackingPresentation({ ...snapshot, condition: 'needs_attention', remainingMs: 0, blockPickup: true, blockDelivery: true }, 0, true);
  expect(view.title).toBe('Needs attention');
  expect(view.description).not.toMatch(/suspicious|fraud|penalty/i);
  expect(view.blockDelivery).toBe(true);
});
test('sustained recovery keeps previously consumed allowance', () => {
  const view = trackingPresentation({ ...snapshot, condition: 'current', remainingMs: 450_000, lastUpdateAt: 1000 }, 20_000, true);
  expect(view.title).toBe('Location current'); expect(view.remainingMs).toBe(450_000);
  expect(view.blockPickup).toBe(false);
});
test('a displayed countdown cannot grant or revoke server action permissions', () => {
  const view = trackingPresentation({ ...snapshot, condition: 'interrupted', remainingMs: 1000, blockPickup: true }, 5000, true);
  expect(view.remainingMs).toBe(0); expect(view.blockDelivery).toBe(false); expect(view.blockPickup).toBe(true);
  expect(view.title).toBe('Location interrupted');
});
test('offline does not label a cached current snapshot as live', () => {
  const view = trackingPresentation({ ...snapshot, condition: 'current' }, 0, false);
  expect(view.title).toBe('Connection lost'); expect(view.description).toContain('last');
});
test('countdown uses elapsed time anchored to serverNow rather than device wall clock', () => {
  expect(trackingPresentation(snapshot, 2000, true).countdownMs).toBe(28_001);
  expect(trackingPresentation(snapshot, -2000, true).countdownMs).toBe(30_001);
});
test('ended tracking has no active countdown', () => {
  const view = trackingPresentation({ ...snapshot, condition: 'ended', nextCheckAt: null }, 0, true);
  expect(view.title).toBe('Location sharing ended'); expect(view.countdownMs).toBeNull();
});
