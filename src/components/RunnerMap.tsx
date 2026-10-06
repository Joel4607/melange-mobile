import { useMemo } from 'react';
import { useConvexAuth, useQuery, useConvexConnectionState } from 'convex/react';
import { Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import { runnersToGeoJSON, type MapCoordinate } from '@/lib/runner-geojson';
import MapSurface from './maps/map-surface';
import { ui } from './customer-ui';
import { LocationLabel } from './runner-location-label';

// Receives foreground device coordinates, not the tracked runner's position.
export default function RunnerMap({ coordinate }: { coordinate: MapCoordinate }) {
  const { isAuthenticated } = useConvexAuth();
  const connection = useConvexConnectionState();
  const runners = useQuery(api.runners.getNearbyRunners, isAuthenticated ? {
    riderLat: coordinate.latitude, riderLng: coordinate.longitude,
  } : 'skip');
  const features = useMemo(() => runnersToGeoJSON(runners ?? []), [runners]);
  if (!isAuthenticated) return <Text style={ui.body}>Sign in to see nearby runners.</Text>;
  return <View style={{ gap: 10 }}>
    <MapSurface center={coordinate} customer={coordinate} runners={features} stale={!connection.isWebSocketConnected} />
    <Text style={ui.small} accessibilityLiveRegion="polite">{!connection.isWebSocketConnected ? 'Reconnecting · locations may be outdated' : runners === undefined ? 'Finding nearby runners…' : runners.length === 0 ? 'No available runners nearby right now.' : `${runners.length} available runner${runners.length === 1 ? '' : 's'} nearby`}</Text>
    <Text style={ui.small}>Nearby runners are ranked by trust, highest first. Only available runners sharing a recent location appear. Blue dot: your location.</Text>
    <Text style={ui.small}>Post an errand to compare quotes and choose your runner. Ranking does not assign anyone.</Text>
    {runners?.map((runner, index) => <View key={runner.runnerId} style={{ borderBottomWidth: 1, borderBottomColor: '#E4E7DE', paddingVertical: 12, gap: 8 }}><Text style={ui.h3}>{index + 1}. {runner.name}</Text><Text style={ui.small}>Trust · {runner.trust.score}/100 · {runner.trust.history === 'new' ? 'New runner' : runner.trust.history === 'limited' ? 'Limited history' : 'Established history'}</Text><LocationLabel label={runner.locationLabel} /></View>)}
  </View>;
}
