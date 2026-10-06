type Point = { latitude: number; longitude: number };
export function mapMarkerRegion(points: Point[], center: Point) {
  const all = points.length ? points : [center];
  const latitudes = all.map(p => p.latitude);
  const longitudes = all.map(p => (p.longitude + 360) % 360).sort((a, b) => a - b);
  let gap = -1, start = longitudes[0];
  for (let i = 0; i < longitudes.length; i++) {
    const next = longitudes[(i + 1) % longitudes.length] + (i === longitudes.length - 1 ? 360 : 0);
    if (next - longitudes[i] > gap) { gap = next - longitudes[i]; start = next % 360; }
  }
  const span = 360 - gap, low = Math.min(...latitudes), high = Math.max(...latitudes);
  return { latitude: (low + high) / 2, longitude: ((start + span / 2 + 540) % 360) - 180,
    latitudeDelta: Math.max(0.004, (high - low) * 1.6), longitudeDelta: Math.min(360, Math.max(0.004, span * 1.6)) };
}
export function deliveryMapRegion(runner: Point, buyer: Point) {
  // Use the short longitude span even when pins straddle the date line.
  const longitudeGap = ((buyer.longitude - runner.longitude + 540) % 360) - 180;
  return {
    latitude: (runner.latitude + buyer.latitude) / 2,
    longitude: ((runner.longitude + longitudeGap / 2 + 540) % 360) - 180,
    latitudeDelta: Math.max(0.004, Math.abs(runner.latitude - buyer.latitude) * 1.6),
    longitudeDelta: Math.max(0.004, Math.abs(longitudeGap) * 1.6),
  };
}
