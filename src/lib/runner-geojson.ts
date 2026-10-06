import type { FeatureCollection, Point } from 'geojson';

export type RunnerFeatures = FeatureCollection<Point, { runnerId: string; name: string; locationLabel?: string }>;
export type MapCoordinate = { latitude: number; longitude: number };
export type DestinationMarker = MapCoordinate & { id: string; label: string };
export type NearbyRunner = { runnerId: string; name: string; lat: number; lng: number; locationLabel?: string | null };

export function runnersToGeoJSON(runners: readonly NearbyRunner[]): RunnerFeatures {
  return {
    type: 'FeatureCollection',
    features: runners.map(runner => ({
      type: 'Feature', id: runner.runnerId,
      geometry: { type: 'Point', coordinates: [runner.lng, runner.lat] },
      properties: { runnerId: runner.runnerId, name: runner.name, ...(runner.locationLabel ? { locationLabel: runner.locationLabel } : {}) },
    })),
  };
}
export type MapSurfaceProps = {
  center: MapCoordinate;
  runners: RunnerFeatures;
  customer?: MapCoordinate;
  customerLabel?: string;
  fitToMarkers?: boolean;
  destinations?: DestinationMarker[];
  demo?: boolean;
  stale?: boolean;
};
