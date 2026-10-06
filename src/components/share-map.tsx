import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import ShareMapLeaflet from './maps/share-map-leaflet';
import { mapMarkerRegion } from '@/lib/delivery-map-region';
import { ui } from './customer-ui';
export type ShareMapPoint = { lat: number; lng: number; label: string };
export type ShareMapProps = { points: ShareMapPoint[]; onPick?: (point: { lat: number; lng: number }) => void };
export default function ShareMap(props: ShareMapProps) {
  return Platform.OS === 'android' ? <ShareMapLeaflet {...props} /> : <NativeShareMap {...props} />;
}
function NativeShareMap({ points, onPick }: ShareMapProps) {
  const ref = useRef<MapView>(null);
  const [alternative, setAlternative] = useState(false);
  const coords = points.map(p => ({ latitude: p.lat, longitude: p.lng }));
  const key = JSON.stringify(coords);
  function fit() {
    if (coords.length > 1) ref.current?.fitToCoordinates(coords, { edgePadding: { top: 45, bottom: 45, left: 45, right: 45 }, animated: true });
    else if (coords[0]) ref.current?.animateToRegion({ ...coords[0], latitudeDelta: 0.012, longitudeDelta: 0.012 });
  }
  useEffect(() => { if (!alternative) fit(); }, [key, alternative]); // eslint-disable-line react-hooks/exhaustive-deps
  if (alternative) return <View style={{ gap: 8 }}><ShareMapLeaflet points={points} onPick={onPick} /><Pressable accessibilityRole="button" onPress={() => setAlternative(false)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.small}>Use Apple Maps</Text></Pressable></View>;
  return <View style={{ gap: 8 }}><MapView ref={ref} style={{ height: 250, borderRadius: 15 }} initialRegion={mapMarkerRegion(coords, { latitude: 5.56, longitude: -0.19 })} onMapReady={fit} onPress={onPick ? e => onPick({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude }) : undefined}>
    {points.map((p, i) => <Marker key={i} coordinate={coords[i]} title={p.label} />)}
    {!onPick && coords.length > 1 && <Polyline coordinates={coords} strokeColor="#234E40" strokeWidth={4} />}
  </MapView><Pressable accessibilityRole="button" onPress={() => setAlternative(true)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.small}>Map blank? Use OpenStreetMap instead →</Text></Pressable></View>;
}
