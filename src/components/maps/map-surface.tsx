import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { ComponentType } from 'react';
import type { MapSurfaceProps } from '@/lib/runner-geojson';

// Expo Go and token-free APK previews use the existing Apple/Leaflet renderer.
export default function MapSurface(props: MapSurfaceProps) {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
      process.env.EXPO_PUBLIC_MAP_RENDERER === 'leaflet' ||
      !process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN?.startsWith('pk.')) {
    const ExpoMap = require('./map-surface-expo').default as ComponentType<MapSurfaceProps>;
    return <ExpoMap {...props} />;
  }
  const MapboxMap = require('./map-surface-mapbox').default as ComponentType<MapSurfaceProps>;
  return <MapboxMap {...props} />;
}
