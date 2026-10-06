import type { GeoPoint } from '../../convex/lib/shareGeo';
import type { DestinationMarker } from './runner-geojson';

export function destinationMarkers(pickup?: GeoPoint | null, dropoff?: GeoPoint | null): DestinationMarker[] {
  return [pickup && { id: 'pickup', label: 'Saved pickup', latitude: pickup.lat, longitude: pickup.lng },
    dropoff && { id: 'delivery', label: 'Saved delivery', latitude: dropoff.lat, longitude: dropoff.lng }]
    .filter((p): p is DestinationMarker => !!p && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180);
}
export function navigationDestination(address: string, pin?: GeoPoint | null): string {
  return pin ? `${pin.lat},${pin.lng}` : address;
}
