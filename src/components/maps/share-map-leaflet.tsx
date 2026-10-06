import LeafletMap from './leaflet-map';
export type ShareMapPoint = { lat: number; lng: number; label: string };
export type ShareMapProps = { points: ShareMapPoint[]; onPick?: (point: { lat: number; lng: number }) => void };
export default function ShareMapLeaflet({ points, onPick }: ShareMapProps) {
  const coordinates = points.map(point => ({ latitude: point.lat, longitude: point.lng }));
  return <LeafletMap height={304} onPick={onPick} data={{
    center: coordinates[0] ?? { latitude: 5.56, longitude: -0.19 }, fit: true, pick: !!onPick,
    pins: points.map((point, index) => ({ ...coordinates[index], id: `stop-${index}`, kind: 'stop', label: `${index + 1}. ${point.label}` })),
    line: !onPick ? coordinates : undefined, button: points.length > 1 ? 'Show all stops' : 'Recenter map',
  }} />;
}
