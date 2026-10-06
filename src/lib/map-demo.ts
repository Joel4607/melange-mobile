// Illustrative points around Accra, not a calculated driving route or the
// customer's pickup/delivery coordinates.
export const demoRoute = [
  { latitude: 5.556, longitude: -0.196 },
  { latitude: 5.558, longitude: -0.196 },
  { latitude: 5.558, longitude: -0.192 },
  { latitude: 5.560, longitude: -0.190 },
  { latitude: 5.563, longitude: -0.190 },
  { latitude: 5.564, longitude: -0.186 },
];
export const demoSteps = 40;
export function demoPoint(step: number) {
  const progress = Math.min(demoSteps, Math.max(0, step)) / demoSteps * (demoRoute.length - 1);
  const segment = Math.min(Math.floor(progress), demoRoute.length - 2);
  const part = progress - segment;
  const start = demoRoute[segment];
  const end = demoRoute[segment + 1];
  return { latitude: start.latitude + (end.latitude - start.latitude) * part, longitude: start.longitude + (end.longitude - start.longitude) * part };
}
export type RunnerMapProps = { point: { latitude: number; longitude: number }; customer?: import('./runner-geojson').MapCoordinate; customerLabel?: string; destinations?: import('./runner-geojson').DestinationMarker[]; demo: boolean; stale: boolean };
