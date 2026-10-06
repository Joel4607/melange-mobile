import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { demoPoint, demoSteps } from '@/lib/map-demo';
import { CustomerButton, FormError, palette, ui } from './customer-ui';
import { ErrandDestinationMap } from './errand-destination-map';
import { TrackingStatus } from './tracking-condition';
import { BuyerLocationSharing } from './buyer-location-sharing';

export function LocationTracking({ errand }: { errand: Doc<'errands'> }) {
  const location = useQuery(api.locations.current, { id: errand._id });
  const canShare = !!errand.runnerId && !errand.completion && ['accepted', 'picked_up'].includes(errand.status) && errand.trackingMode !== 'demo';
  const buyerLocation = useQuery(api.buyerLocationShares.current, canShare ? { id: errand._id } : 'skip');
  const trackingEnabled = !!errand.trackingObligationId && ['accepted', 'picked_up'].includes(errand.status) && !errand.completion;
  const tracking = useQuery(api.tracking.current, trackingEnabled ? { id: errand._id } : 'skip');
  const options = useQuery(api.errands.trackingOptions);
  const startDemo = useMutation(api.locations.startDemo);
  const publish = useMutation(api.locations.publishDemo);
  const stopDemo = useMutation(api.locations.stopDemo);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const session = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pending = useRef(false);
  const eligible = (errand.status === 'accepted' || errand.status === 'picked_up') && errand.trackingMode === 'demo' && !errand.runnerId && options?.demoEnabled;

  const stop = useCallback(() => {
    const previous = session.current;
    session.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setRunning(false);
    if (previous) void stopDemo({ id: errand._id, sessionId: previous }).catch(() => undefined);
  }, [errand._id, stopDemo]);
  useFocusEffect(useCallback(() => () => stop(), [stop]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => { if (state !== 'active') stop(); });
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => { listener.remove(); clearInterval(clock); };
  }, [stop]);
  useEffect(() => { if (!eligible) stop(); }, [eligible, stop]);

  async function play() {
    if (session.current) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    session.current = id; setRunning(true); setError('');
    let step = 0;
    async function tick() {
      if (session.current !== id || pending.current) return;
      pending.current = true;
      try {
        const accepted = await publish({ id: errand._id, sessionId: id, point: { ...demoPoint(step), capturedAt: Date.now() } });
        if (session.current !== id) return;
        if (!accepted) { stop(); setError('This demo session was replaced or its update was rejected. Press Play to start again.'); return; }
        if (step >= demoSteps) stop(); else step++;
      } catch (err) {
        if (session.current === id) { stop(); setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Location update failed. Check your connection and play again.'); }
      } finally { pending.current = false; }
    }
    try {
      await startDemo({ id: errand._id, sessionId: id });
      if (session.current !== id) { await stopDemo({ id: errand._id, sessionId: id }); return; }
      await tick();
      if (session.current === id) timer.current = setInterval(() => void tick(), 3000);
    } catch (err) {
      if (session.current === id) { stop(); setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not start the map demo. Please try again.'); }
    }
  }
  const age = location?.point ? Math.max(0, Math.floor((now - location.point.capturedAt) / 1000)) : null;
  const stale = (trackingEnabled && tracking?.condition !== 'current') || !isWebSocketConnected || !location?.sharing || age === null || age > 30 || !!location?.point && Math.min(location.receivedAt, location.point.capturedAt) + 30000 < now;
  const ended = errand.status === 'delivered' || errand.status === 'cancelled';
  return <View style={ui.card}>
    <View style={ui.between}><Text style={ui.h2}>Runner location</Text><View style={ui.badge}><Text style={ui.badgeText}>{location?.source === 'demo_route' ? 'SIMULATED ROUTE' : location?.point && !stale ? 'LIVE GPS' : 'LOCATION'}</Text></View></View>
    {location?.point ? <>
      <ErrandDestinationMap key={location.sessionId ?? location.publisherId} runner={location.point} customer={buyerLocation?.point} customerLabel="You · shared live GPS" pickup={errand.sharePickup} dropoff={errand.shareDropoff} demo={location.source === 'demo_route'} stale={stale} condition={trackingEnabled ? tracking?.condition ?? 'awaiting_location' : undefined} />
      <Text accessibilityLiveRegion="polite" style={[ui.small, { color: stale ? palette.orange : palette.green }]}>{!isWebSocketConnected ? 'Offline · last known position' : !location.sharing ? 'Sharing paused · last position' : stale ? 'Update delayed · last known position' : location.source === 'demo_route' ? 'Receiving simulated positions' : 'Receiving runner GPS updates'}{age !== null ? ` · ${age}s since last update` : ''}</Text>
      {location.point.accuracy !== undefined && <Text style={ui.small}>Reported accuracy: approximately {Math.round(location.point.accuracy)} metres.</Text>}
      {(location.point.accuracy ?? 0) > 100 && <Text style={ui.small}>This GPS position is approximate. Confirm the meeting point in chat.</Text>}
    </> : <View style={{ backgroundColor: palette.pale, borderRadius: 16, padding: 24, gap: 10 }}><Text style={ui.h3}>{ended ? 'Location sharing has ended' : location === undefined ? 'Loading location…' : 'Waiting for a location'}</Text><Text style={ui.body}>{ended ? 'Runner coordinates are no longer shown after delivery or cancellation.' : eligible ? 'Play the sample route below to see a moving marker on the map.' : errand.status === 'posted' ? 'Location tracking becomes available after acceptance.' : 'Waiting for the runner’s first position. Saved destinations are shown below when available.'}</Text></View>}
    {!location?.point && !ended && <ErrandDestinationMap customer={buyerLocation?.point} customerLabel="You · shared live GPS" pickup={errand.sharePickup} dropoff={errand.shareDropoff} />}
    {canShare && <BuyerLocationSharing key={errand._id} id={errand._id} />}
    {trackingEnabled && <TrackingStatus snapshot={tracking} connected={isWebSocketConnected} />}
    {eligible && <View style={{ gap: 12 }}>
      <Text style={ui.eyebrow}>MAP DEMONSTRATION</Text><Text style={ui.small}>A simulated runner follows an illustrative route over about two minutes. Positions sync through your account. This does not use GPS, change delivery status, or match your actual errand addresses. Movement stops when you leave this screen or put the app in the background.</Text>
      <FormError message={error} />
      <CustomerButton disabled={!running && !isWebSocketConnected} onPress={() => { if (running) stop(); else void play(); }}>{running ? 'Stop map demo' : 'Play sample route'}</CustomerButton>
    </View>}
  </View>;
}
