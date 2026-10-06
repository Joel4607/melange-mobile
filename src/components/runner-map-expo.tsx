import type { RunnerMapProps } from '@/lib/map-demo';
import { runnersToGeoJSON } from '@/lib/runner-geojson';
import ExpoMap from './maps/map-surface-expo';

export default function RunnerMap({ point, customer, customerLabel, destinations, demo, stale }: RunnerMapProps) {
  return <ExpoMap center={point} customer={customer} customerLabel={customerLabel} destinations={destinations} fitToMarkers demo={demo} stale={stale}
    runners={runnersToGeoJSON([{ runnerId: 'assigned-runner', name: demo ? 'Simulated runner' : 'Your runner', lat: point.latitude, lng: point.longitude }])} />;
}
