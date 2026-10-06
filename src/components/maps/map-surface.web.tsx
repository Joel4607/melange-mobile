import { Text, View } from 'react-native';
import type { MapSurfaceProps } from '@/lib/runner-geojson';
import { ui } from '../customer-ui';
import { trackingMapData } from '@/lib/leaflet-document';
import LeafletMap from './leaflet-map';

export default function MapSurface(props: MapSurfaceProps) {
  return <View style={{ gap: 8 }}><LeafletMap data={trackingMapData(props)} />
    {props.demo && <Text style={ui.small}>Dashed line: illustrative sample route, not road directions.</Text>}
  </View>;
}
