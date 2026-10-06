export type GeoPoint = { lat: number; lng: number };
export function haversineKm(a: GeoPoint, b: GeoPoint) {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
