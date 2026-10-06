import { Text } from 'react-native';
import type { GeoPoint } from '../../convex/lib/shareGeo';
import type { TrackingCondition } from '../../convex/lib/trackingPolicy';
import type { MapCoordinate } from '@/lib/runner-geojson';
import { runnersToGeoJSON } from '@/lib/runner-geojson';
import { destinationMarkers } from '@/lib/errand-destinations';
import RunnerMap from './runner-map';
import MapSurface from './maps/map-surface';
import { ui } from './customer-ui';

export function ErrandDestinationMap({ pickup, dropoff, runner, customer, customerLabel, stale = false, demo = false, condition }: {
  pickup?: GeoPoint | null; dropoff?: GeoPoint | null; runner?: MapCoordinate; customer?: MapCoordinate; customerLabel?: string; stale?: boolean; demo?: boolean; condition?: TrackingCondition;
}) {
  // Sample routes must not suggest a real journey between saved addresses.
  const destinations = demo ? [] : destinationMarkers(pickup, dropoff);
  const center = runner ?? customer ?? destinations[0];
  // A single returning fix can move the marker without clearing a recovery lock.
  const paused = stale || (condition !== undefined && condition !== 'current');
  return <>
    {center ? runner ? <RunnerMap point={runner} customer={customer} customerLabel={customerLabel} destinations={destinations} stale={paused} demo={demo} />
      : <MapSurface center={center} customer={customer} customerLabel={customerLabel} runners={runnersToGeoJSON([])} destinations={destinations} fitToMarkers />
      : <Text style={ui.small}>No saved map pins yet. Use the written pickup and delivery addresses for directions.</Text>}
    {!demo && <Text style={ui.small}>Green marker: runner · blue pin: buyer’s optional live location · orange pins: saved pickup and delivery destinations.</Text>}
    {!demo && runner && condition && condition !== 'current' && <Text style={ui.small}>Last reported position. The server is waiting for sustained fresh updates before confirming recovery.</Text>}
  </>;
}
