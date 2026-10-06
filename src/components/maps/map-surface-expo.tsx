import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import type { MapSurfaceProps } from '@/lib/runner-geojson';
import { CustomerButton, palette, ui } from '../customer-ui';
import { mapMarkerRegion } from '@/lib/delivery-map-region';
import { trackingMapData } from '@/lib/leaflet-document';
import { demoRoute } from '@/lib/map-demo';
import LeafletMap from './leaflet-map';

// Apple/Leaflet renderer for Expo Go and token-free standalone builds.
export default function ExpoMap(props: MapSurfaceProps) {
  if (Platform.OS === 'android') return <View style={{ gap: 8 }}><LeafletMap data={trackingMapData(props)} />{props.demo && <Text style={ui.small}>Dashed line: illustrative sample route, not road directions.</Text>}</View>;
  return <AppleMap {...props} />;
}
function AppleMap({ center, customer, customerLabel = 'You are here', fitToMarkers = false, runners, stale = false, demo = false, destinations = [] }: MapSurfaceProps) {
  const data = trackingMapData({ center, runners, customer, destinations, fitToMarkers });
  const region = mapMarkerRegion(data.pins, center);
  const ref = useRef<MapView>(null);
  const [follow, setFollow] = useState(true);
  const [ready, setReady] = useState(false);
  const [alternative, setAlternative] = useState(false);
  useEffect(() => {
    if (follow && ready && !alternative) {
      if (fitToMarkers) ref.current?.animateToRegion(region, 700);
      else ref.current?.animateCamera({ center });
    }
  }, [center.latitude, center.longitude, region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta, fitToMarkers, follow, ready, alternative]);
  if (alternative) return <View style={{ gap: 8 }}><LeafletMap data={trackingMapData({ center, runners, customer, customerLabel, destinations, fitToMarkers, demo, stale })} /><CustomerButton onPress={() => { setReady(false); setFollow(true); setAlternative(false); }}>Use Apple Maps</CustomerButton>{demo && <Text style={ui.small}>Dashed line: illustrative sample route, not road directions.</Text>}</View>;
  return <View style={{ gap: 10 }}>
    <View style={{ height: 310, borderRadius: 18, overflow: 'hidden' }}>
      <MapView ref={ref} style={StyleSheet.absoluteFill} userInterfaceStyle="light" initialRegion={fitToMarkers ? region : { ...center, latitudeDelta: 0.015, longitudeDelta: 0.015 }} onMapReady={() => setReady(true)} onPanDrag={() => setFollow(false)} toolbarEnabled={false}>
        {demo && <Polyline coordinates={demoRoute} strokeColor="#234E40" strokeWidth={4} lineDashPattern={[7, 5]} />}
        {customer && <Marker identifier="buyer" coordinate={customer} title={customerLabel} pinColor="#208AEF" />}
        {destinations.map(p => <Marker key={p.id} coordinate={p} title={p.label} pinColor="#B95629" />)}
        {runners.features.map(feature => <Marker key={feature.id} identifier={String(feature.id)}
          coordinate={{ latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0] }}
          title={feature.properties.name} description={stale ? 'Last known position · waiting for GPS' : feature.properties.locationLabel} pinColor={palette.green} opacity={stale ? 0.6 : 1} />)}
      </MapView>
    </View>
    <CustomerButton disabled={!ready} onPress={() => { setFollow(true); if (fitToMarkers && data.pins.length > 1) ref.current?.animateToRegion(region, 700); else ref.current?.animateCamera({ center, zoom: 15 }); }}>{!ready ? 'Loading map…' : fitToMarkers && data.pins.length > 1 ? 'Show route' : 'Recenter map'}</CustomerButton>
    <Pressable accessibilityRole="button" accessibilityLabel="Switch to OpenStreetMap" onPress={() => setAlternative(true)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.small}>Map blank? Use OpenStreetMap instead →</Text></Pressable>
    {demo && <Text style={ui.small}>Dashed line: illustrative sample route, not road directions.</Text>}
  </View>;
}
