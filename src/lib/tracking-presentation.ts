import type { TrackingCondition } from '../../convex/lib/trackingPolicy';

export type TrackingView = {
  condition: TrackingCondition; remainingMs: number; budgetMs: number; assignedAt: number;
  serverNow: number; lastUpdateAt: number | null; nextCheckAt: number | null;
  blockPickup: boolean; blockDelivery: boolean;
};
const copy: Record<TrackingCondition, [string, string]> = {
  awaiting_location: ['Waiting for location', 'Private location sharing starts automatically after assignment. Waiting for the first fresh GPS reading.'],
  current: ['Location current', 'Fresh runner positions are reaching the server. Previously used interruption allowance stays used.'],
  delayed: ['Location delayed', 'A fresh position is overdue. Restore location before the pickup deadline.'],
  pickup_locked: ['Restore location before pickup', 'Pickup confirmation is paused. Keep using chat, directions and the collection approval request. Recovery needs fresh readings over at least 10 seconds.'],
  interrupted: ['Location interrupted', 'The remaining interruption allowance is counting down. Restore fresh GPS readings over at least 10 seconds; restarting does not reset the allowance.'],
  needs_attention: ['Needs attention', 'The interruption allowance is used up. Pickup and delivery confirmation are paused until sustained fresh location returns. Chat, directions and collection approval remain available.'],
  ended: ['Location sharing ended', 'Private location access ends at delivery or cancellation.'],
};

/** Display only. Never infer action permissions from the countdown or device clock. */
export function trackingPresentation(snapshot: TrackingView, elapsedMs: number, connected: boolean) {
  const elapsed = Math.max(0, elapsedMs);
  const [title, description] = copy[snapshot.condition];
  return {
    title: connected || snapshot.condition === 'ended' ? title : 'Connection lost',
    description: connected ? description : 'Showing the last server status. Reconnect to receive current tracking status and confirm progress.',
    remainingMs: Math.max(0, snapshot.remainingMs - (snapshot.condition === 'interrupted' ? elapsed : 0)),
    countdownMs: snapshot.nextCheckAt === null ? null : Math.max(0, snapshot.nextCheckAt - snapshot.serverNow - elapsed),
    countdownLabel: snapshot.condition === 'delayed' ? 'Pickup pause in' : 'Next tracking check in',
    blockPickup: snapshot.blockPickup, blockDelivery: snapshot.blockDelivery,
  };
}

export function trackingTime(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
