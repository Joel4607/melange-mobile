import Mapbox from '@rnmapbox/maps';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Feature, LineString, Point } from 'geojson';
import { demoRoute } from '@/lib/map-demo';
import type { MapSurfaceProps } from '@/lib/runner-geojson';
import { trackingMapData } from '@/lib/leaflet-document';
import { CustomerButton, palette, ui } from '../customer-ui';
import { mapMarkerRegion } from '@/lib/delivery-map-region';

void Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN!);
const images = { 'runner-icon': require('../../../assets/images/runner-walk-figure.png') };
const route: Feature<LineString> = {
  type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: demoRoute.map(p => [p.longitude, p.latitude]) },
};
const destination: Feature<Point> = {
  type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: route.geometry.coordinates.at(-1)! },
};

export default function MapboxSurface({ center, runners, customer, fitToMarkers = false, demo = false, stale = false, destinations = [] }: MapSurfaceProps) {
  const data = trackingMapData({ center, runners, customer, destinations, fitToMarkers });
  const region = mapMarkerRegion(data.pins, center);
  const camera = useRef<ComponentRef<typeof Mapbox.Camera>>(null);
  const initialCamera = useRef({ centerCoordinate: [center.longitude, center.latitude], zoomLevel: 15 }).current;
  const [follow, setFollow] = useState(true);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const userPoint = useMemo<Feature<Point> | undefined>(() => customer ? ({
    type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [customer.longitude, customer.latitude] },
  }) : undefined, [customer?.latitude, customer?.longitude]);
  useEffect(() => {
    if (follow && ready) {
      if (fitToMarkers) {

        camera.current?.fitBounds([region.longitude + region.longitudeDelta / 2, region.latitude + region.latitudeDelta / 2], [region.longitude - region.longitudeDelta / 2, region.latitude - region.latitudeDelta / 2], 25, 700);
      } else camera.current?.setCamera({ centerCoordinate: [center.longitude, center.latitude], animationDuration: 700, animationMode: 'easeTo' });
    }
  }, [center.latitude, center.longitude, region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta, fitToMarkers, follow, ready]);
  return <View style={{ gap: 10 }}>
    <View style={styles.frame}>
      <Mapbox.MapView key={retry} style={StyleSheet.absoluteFill} styleURL={Mapbox.StyleURL.Street}
        scaleBarEnabled={false} logoEnabled attributionEnabled
        onCameraChanged={state => { if (state.gestures.isGestureActive) setFollow(false); }}
        onDidFinishLoadingMap={() => { setReady(true); setFailed(false); }}
        onMapLoadingError={() => setFailed(true)}>
        <Mapbox.Camera ref={camera} defaultSettings={initialCamera} />
        <Mapbox.Images images={images} />
        {demo && <Mapbox.ShapeSource id="sampleRoute" shape={route}><Mapbox.LineLayer id="sampleRouteLine" style={{ lineColor: palette.green, lineWidth: 3, lineDasharray: [2, 2] }} /></Mapbox.ShapeSource>}
        {demo && <Mapbox.ShapeSource id="sampleEnd" shape={destination}><Mapbox.CircleLayer id="sampleEndDot" style={{ circleRadius: 7, circleColor: palette.orange, circleStrokeWidth: 2, circleStrokeColor: '#FFFFFF' }} /></Mapbox.ShapeSource>}
        {userPoint && <Mapbox.ShapeSource id="customerLocation" shape={userPoint}><Mapbox.CircleLayer id="customerDot" style={{ circleRadius: 7, circleColor: '#208AEF', circleStrokeWidth: 3, circleStrokeColor: '#FFFFFF' }} /></Mapbox.ShapeSource>}
        {destinations.length > 0 && <Mapbox.ShapeSource id="savedDestinations" shape={{ type: 'FeatureCollection', features: destinations.map(p => ({ type: 'Feature', id: p.id, properties: { label: p.label }, geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] } })) }}>
          <Mapbox.CircleLayer id="savedDestinationDots" style={{ circleRadius: 8, circleColor: palette.orange, circleStrokeWidth: 2, circleStrokeColor: '#FFFFFF' }} />
          <Mapbox.SymbolLayer id="savedDestinationLabels" style={{ textField: ['get', 'label'], textSize: 12, textOffset: [0, 1.5], textAllowOverlap: true, textColor: palette.green, textHaloColor: '#FFFFFF', textHaloWidth: 2 }} />
        </Mapbox.ShapeSource>}
        <Mapbox.ShapeSource id="runnerLocations" shape={runners}>
          <Mapbox.SymbolLayer id="runnerSymbols" style={{
            iconImage: 'runner-icon', iconSize: 0.7, iconAnchor: 'bottom',
            iconAllowOverlap: true, iconIgnorePlacement: true, iconOpacity: stale ? 0.45 : 1,
          }} />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>
      {(!ready || failed) && <View pointerEvents="none" style={styles.message}><Text style={ui.small}>{failed ? 'Map unavailable. Check your connection and map configuration.' : 'Loading map…'}</Text></View>}
    </View>
    <CustomerButton onPress={() => {
      if (failed) { setReady(false); setFailed(false); setRetry(value => value + 1); }
      setFollow(true);
      if (fitToMarkers) {

        camera.current?.fitBounds([region.longitude + region.longitudeDelta / 2, region.latitude + region.latitudeDelta / 2], [region.longitude - region.longitudeDelta / 2, region.latitude - region.latitudeDelta / 2], 25, 700);
      } else camera.current?.setCamera({ centerCoordinate: [center.longitude, center.latitude], zoomLevel: 15, animationDuration: 700 });
    }}>{failed ? 'Retry map' : fitToMarkers && data.pins.length > 1 ? 'Show route' : 'Recenter map'}</CustomerButton>
    {demo && <Text style={ui.small}>Dashed line: illustrative sample route, not road directions or your errand addresses.</Text>}
  </View>;
}
const styles = StyleSheet.create({
  frame: { height: 310, borderRadius: 18, overflow: 'hidden', backgroundColor: palette.pale },
  message: { position: 'absolute', top: 10, left: 10, right: 10, padding: 10, borderRadius: 10, backgroundColor: '#FFFFFF' },
});
