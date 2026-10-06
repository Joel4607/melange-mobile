import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { freshPoint } from '../lib/runner-location-data';
import { watchFreshPosition } from '../lib/watch-fresh-position';
import { CustomerButton, FormError, ui } from './customer-ui';

export function BuyerLocationSharing({ id }: { id: Id<'errands'> }) {
  const begin = useMutation(api.buyerLocationShares.start);
  const publish = useMutation(api.buyerLocationShares.publish);
  const end = useMutation(api.buyerLocationShares.stop);
  const current = useQuery(api.buyerLocationShares.current, { id });
  const { isWebSocketConnected: connected } = useConvexConnectionState();
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    if (!enabled || !connected) return;
    let live = true, pending = false, lastAttempt = 0;
    let watcher: Location.LocationSubscription | undefined;
    const sessionId = 'buyer-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const stopServer = () => end({ id, sessionId }).catch(() => undefined);
    function fail(message: string) { if (live) { setError(message); setEnabled(false); } }
    async function send(reading: Location.LocationObject) {
      if (!live || pending || (Platform.OS !== 'web' && AppState.currentState !== 'active')) return;
      const point = freshPoint(reading);
      if (!point || Date.now() - lastAttempt < 5000) return;
      pending = true; lastAttempt = Date.now();
      try {
        if (!(await publish({ id, sessionId, point }))) fail('Location sharing ended. Tap Share my live location to start again.');
      } catch { fail('Couldn’t share your location. Check your connection and try again.'); }
      finally { pending = false; }
    }
    async function start() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!live) return;
        if (!permission.granted) { fail('Allow location access in your device or browser settings, then try again.'); return; }
        if (!(await Location.hasServicesEnabledAsync())) { fail('Turn on location services, then try again.'); return; }
        if (!live) return;
        await begin({ id, sessionId, consent: true });
        if (!live) { await stopServer(); return; }
        const next = await watchFreshPosition(reading => { void send(reading); }, () => fail('GPS is unavailable. Check location access and try again.'));
        if (!live) next.remove(); else watcher = next;
      } catch { fail('Couldn’t start location sharing. Check your connection and location access, then try again.'); }
    }
    const appState = AppState.addEventListener('change', state => {
      // iOS permission dialogs temporarily mark the app inactive. Only an
      // actual background transition ends the user's foreground session.
      if (Platform.OS !== 'web' && state === 'background') setEnabled(false);
    });
    void start();
    return () => { live = false; watcher?.remove(); appState.remove(); setEnabled(false); void stopServer(); };
  }, [enabled, connected, id, begin, publish, end]));

  return <View style={{ gap: 10 }}>
    <Text style={ui.h3}>Help your runner find you</Text>
    <Text style={ui.small}>Share your live GPS position only with this errand’s assigned runner. Each buyer on a shared run chooses separately. Keep this page open; sharing stops when you leave it or put the mobile app in the background.</Text>
    {enabled && <Text accessibilityLiveRegion="polite" style={ui.small}>{current ? 'Your current location is shared with your runner.' : 'Waiting for a fresh GPS position…'}</Text>}
    {enabled && current?.point.accuracy !== undefined && <Text style={ui.small}>Your GPS accuracy: approximately {Math.round(current.point.accuracy)} metres.</Text>}
    <FormError message={error} />
    <CustomerButton disabled={!enabled && !connected} onPress={() => { setError(''); setEnabled(value => !value); }}>{enabled ? 'Stop sharing my location' : 'Share my live location'}</CustomerButton>
    <Text style={ui.small}>The blue marker is your shared GPS position. Orange pins remain the saved pickup and delivery destinations.</Text>
  </View>;
}
