import { useConvexConnectionState, useQuery } from 'convex/react';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { trackingPresentation, trackingTime, type TrackingView } from '@/lib/tracking-presentation';
import { palette, ui } from './customer-ui';

function monotonicNow() { return performance.now(); }

export function TrackingCondition({ id, enabled = true }: { id: Id<'errands'>; enabled?: boolean }) {
  const snapshot = useQuery(api.tracking.current, enabled ? { id } : 'skip');
  const { isWebSocketConnected } = useConvexConnectionState();
  return enabled ? <TrackingStatus snapshot={snapshot} connected={isWebSocketConnected} /> : null;
}

export function TrackingStatus({ snapshot, connected }: { snapshot: TrackingView | null | undefined; connected: boolean }) {
  const anchor = useRef({ snapshot, at: monotonicNow() });
  if (anchor.current.snapshot !== snapshot) anchor.current = { snapshot, at: monotonicNow() };
  const [, tick] = useState(0);
  useEffect(() => {
    if (!snapshot) return;
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [snapshot]);
  if (snapshot === null) return null;
  if (!snapshot) return <Text style={ui.small}>{connected ? 'Loading tracking status…' : 'Reconnect to receive tracking status.'}</Text>;
  const view = trackingPresentation(snapshot, monotonicNow() - anchor.current.at, connected);
  const interrupted = snapshot.condition === 'interrupted' || snapshot.condition === 'needs_attention';
  return <View style={{ gap: 8, padding: 14, borderRadius: 14, backgroundColor: palette.pale }}>
    <Text accessibilityLiveRegion="polite" style={ui.h3}>{view.title}</Text>
    <Text style={ui.small}>{view.description}</Text>
    {interrupted ? <Text style={ui.h3}>Interruption allowance left: {trackingTime(view.remainingMs)}</Text> : view.countdownMs !== null && <Text style={ui.small}>{view.countdownMs > 0 ? `${view.countdownLabel}: ${trackingTime(view.countdownMs)}` : 'Waiting for the next server status…'}</Text>}
    {snapshot.lastUpdateAt !== null && <Text style={ui.small}>Last fresh update received: {new Date(snapshot.lastUpdateAt).toLocaleTimeString()}</Text>}
    {(interrupted || !connected) && <Text style={ui.small}>Countdown is an estimate. The server checks location and confirms when recovery is complete.</Text>}
  </View>;
}
