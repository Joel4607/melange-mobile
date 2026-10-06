import Constants, { ExecutionEnvironment } from 'expo-constants';
import { type ComponentType, useEffect, useRef, useState } from 'react';
import type { RunnerMapProps } from '@/lib/map-demo';
import { runnersToGeoJSON } from '@/lib/runner-geojson';
import MapSurface from './maps/map-surface';

function TrackedMap({ point, customer, customerLabel, destinations, demo, stale }: RunnerMapProps) {
  const [displayPoint, setDisplayPoint] = useState(point);
  const current = useRef(point);
  useEffect(() => {
    const from = current.current;
    const start = Date.now();
    const timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - start) / (stale ? 1 : 2400));
      current.current = {
        latitude: from.latitude + (point.latitude - from.latitude) * progress,
        longitude: from.longitude + (point.longitude - from.longitude) * progress,
      };
      setDisplayPoint(current.current);
      if (progress === 1) clearInterval(timer);
    }, 80);
    return () => clearInterval(timer);
  }, [point.latitude, point.longitude, stale]);
  const runners = runnersToGeoJSON([{ runnerId: 'assigned-runner', name: demo ? 'Simulated runner' : 'Your runner', lat: displayPoint.latitude, lng: displayPoint.longitude }]);
  return <MapSurface center={point} customer={customer} customerLabel={customerLabel} destinations={destinations} fitToMarkers runners={runners} demo={demo} stale={stale} />;
}

export default function RunnerMap(props: RunnerMapProps) {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    const ExpoMap = require('./runner-map-expo').default as ComponentType<RunnerMapProps>;
    return <ExpoMap {...props} />;
  }
  return <TrackedMap {...props} />;
}
