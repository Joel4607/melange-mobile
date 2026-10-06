import { expect, test } from 'vitest';
import { leafletDocument, pickedMapPoint, serializeMapData, trackingMapData } from '../src/lib/leaflet-document';
import { runnersToGeoJSON } from '../src/lib/runner-geojson';

test('two people at the same location remain two distinct pins; stale applies only to runner', () => {
  const center = { latitude: 5.56, longitude: -0.19 };
  const map = trackingMapData({ center, customer: center, fitToMarkers: true, stale: true,
    runners: runnersToGeoJSON([{ runnerId: 'r', name: 'Runner', lat: 5.56, lng: -0.19 }]) });
  expect(map.pins).toHaveLength(2);
  expect(map.pins.map(p => p.kind)).toEqual(['runner', 'buyer']);
  expect(map.pins[0].stale).toBe(true);
  expect(map.pins[1].stale).toBeUndefined();
  expect(map.button).toBe('Show route');
});

test('single available position offers recenter instead of pretending both people exist', () => {
  const center = { latitude: 5.56, longitude: -0.19 };
  const map = trackingMapData({ center, customer: center, fitToMarkers: true, runners: runnersToGeoJSON([]) });
  expect(map.pins).toHaveLength(1);
  expect(map.button).toBe('Recenter map');
  expect(map.line).toBeUndefined();
});

test('map picking validates channel and coordinates, and script serialization cannot inject markup', () => {
  expect(pickedMapPoint({ channel: 'a', type: 'pick', lat: 5.56, lng: -0.19 }, 'a')).toEqual({ lat: 5.56, lng: -0.19 });
  for (const value of [{ channel: 'b', type: 'pick', lat: 5, lng: 0 }, { channel: 'a', type: 'pick', lat: NaN, lng: 0 }, { channel: 'a', type: 'pick', lat: 5, lng: 181 }]) expect(pickedMapPoint(value, 'a')).toBeNull();
  const label = '</script><script>alert(1)</script>';
  expect(serializeMapData({ label })).not.toContain('<');
  expect(JSON.parse(serializeMapData({ label })).label).toBe(label);
  const html = leafletDocument(label);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  expect(() => new Function(script)).not.toThrow();
  expect(html).not.toContain('navigator.geolocation');
});
