import { Component, type PropsWithChildren, useCallback, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useConvexAuth } from 'convex/react';
import type { MapCoordinate } from '@/lib/runner-geojson';
import RunnerMap from './RunnerMap';
import { CustomerButton, FormError, ui } from './customer-ui';

class MapBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <View style={{ gap: 10 }}><FormError message="Nearby runners could not be loaded. Check your connection and try again." /><CustomerButton onPress={() => this.setState({ failed: false })}>Retry nearby runners</CustomerButton></View>;
    return this.props.children;
  }
}

export default function NearbyRunners({ compact = false }: { compact?: boolean }) {
  const { isAuthenticated } = useConvexAuth();
  const [enabled, setEnabled] = useState(false);
  const [coordinate, setCoordinate] = useState<MapCoordinate>();
  const [message, setMessage] = useState('');
  useFocusEffect(useCallback(() => {
    if (!enabled || !isAuthenticated) return;
    let subscription: Location.LocationSubscription | undefined;
    let generation = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    function stop() {
      generation++;
      subscription?.remove();
      subscription = undefined;
      clearTimeout(timeout);
      setCoordinate(undefined);
    }
    async function start() {
      stop();
      const request = generation;
      setMessage('');
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (request !== generation) return;
        if (permission.status !== 'granted') {
          setMessage('Allow location access in your phone settings to see nearby runners.');
          setEnabled(false);
          return;
        }
        if (!(await Location.hasServicesEnabledAsync())) throw new Error('location-disabled');
        if (request !== generation) return;
        timeout = setTimeout(() => { if (request === generation) setMessage('Still waiting for your location. Check that location services are enabled.'); }, 15_000);
        const watcher = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 5000 }, location => {
          if (request !== generation || AppState.currentState !== 'active') return;
          if (!Number.isFinite(location.coords.latitude) || !Number.isFinite(location.coords.longitude)) return;
          clearTimeout(timeout);
          setMessage('');
          setCoordinate({ latitude: location.coords.latitude, longitude: location.coords.longitude });
        });
        if (request !== generation) watcher.remove();
        else subscription = watcher;
      } catch {
        if (request === generation) {
          clearTimeout(timeout);
          setMessage('Could not get your location. Enable location services and try again.');
          setEnabled(false);
        }
      }
    }
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void start(); else stop(); });
    if (AppState.currentState === 'active') void start();
    return () => { listener.remove(); stop(); };
  }, [enabled, isAuthenticated]));

  return <View style={compact ? { gap: 12 } : ui.card}>
    <Text style={ui.h2}>Runners near you</Text>
    <Text style={ui.small}>See available runners around your current location. Location access stops when you leave this screen.</Text>
    {!isAuthenticated ? <Text style={ui.body}>Sign in to see nearby runners.</Text> : <>
      <FormError message={message} />
      {enabled && coordinate && <MapBoundary><RunnerMap coordinate={coordinate} /></MapBoundary>}
      {enabled && !coordinate && !message && <Text style={ui.small}>Finding your location…</Text>}
      <CustomerButton onPress={() => { setMessage(''); setEnabled(value => !value); }}>{enabled ? 'Stop using my location' : 'Use my location'}</CustomerButton>
    </>}
  </View>;
}
