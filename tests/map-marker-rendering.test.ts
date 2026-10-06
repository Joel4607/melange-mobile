// @vitest-environment node
import { readFileSync } from 'node:fs';
import * as React from 'react';
import * as ts from 'typescript';
import { expect, test, vi } from 'vitest';
import { leafletDocument, trackingMapData } from '../src/lib/leaflet-document';
import { mapMarkerRegion } from '../src/lib/delivery-map-region';
import { runnersToGeoJSON } from '../src/lib/runner-geojson';

const center = { latitude: 5.56, longitude: -0.19 };
const props = { center, customer: center, runners: runnersToGeoJSON([{ runnerId: 'runner-one', name: 'Runner', lat: 5.561, lng: -0.191 }]), destinations: [{ ...center, id: 'delivery', label: 'Delivery' }], fitToMarkers: true };

function nativeRenderer() {
  // Render the actual native function without loading a phone-only module.
  const source = readFileSync(new URL('../src/components/maps/map-surface-expo.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AppleMap');
  if (!fn) throw new Error('AppleMap not found');
  const states: unknown[] = []; let slot = 0;
  const context = { React, trackingMapData, mapMarkerRegion, useRef: () => ({ current: null }), useEffect: () => {},
    useState: (initial: unknown) => { const index = slot++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = value; }]; },
    View: 'view', MapView: 'map', Marker: 'marker', Polyline: 'line', Text: 'text', CustomerButton: 'button',
    LeafletMap: 'leaflet', Pressable: 'pressable', StyleSheet: { absoluteFill: {} }, ui: { small: {} }, palette: { green: '#234E40', orange: '#B95629' }, demoRoute: [], require: () => 'walker.png',
  };
  const code = ts.transpileModule(fn.getText(file) + '\nreturn AppleMap;', { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const render = new Function(...Object.keys(context), code)(...Object.values(context));
  return () => { slot = 0; return render(props); };
}
function nodes(element: React.ReactNode): React.ReactElement<any>[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(nodes)];
}

test('Apple Maps assigns standard colored pins to runner GPS, buyer GPS and saved delivery', () => {
  const markers = nodes(nativeRenderer()()).filter(node => node.type === 'marker');
  expect(markers).toHaveLength(3);
  const runner = markers.find(node => node.props.title === 'Runner')!;
  expect(runner.props.coordinate).toEqual({ latitude: 5.561, longitude: -0.191 });
  expect(runner.props.pinColor).toBe('#234E40');
  expect(runner.props.image).toBeUndefined();
  expect(markers.find(node => node.props.title === 'You are here')!.props.pinColor).toBe('#208AEF');
  expect(markers.find(node => node.props.title === 'Delivery')!.props.pinColor).toBe('#B95629');
});

test('a blank Apple map can switch to Leaflet while retaining the same real positions', () => {
  const render = nativeRenderer();
  const alternative = nodes(render()).find(node => node.props.accessibilityLabel === 'Switch to OpenStreetMap');
  expect(alternative).toBeDefined();
  alternative!.props.onPress();
  const leaflet = nodes(render()).find(node => node.type === 'leaflet');
  expect(leaflet?.props.data.pins.map((pin: { kind: string }) => pin.kind)).toEqual(['runner', 'buyer', 'stop']);
  expect(leaflet?.props.data.center).toEqual(center);
});

test('Leaflet draws a centered colored runner dot and updates it in place, including stale style', () => {
  const map = { on: vi.fn(), invalidateSize: vi.fn(), fitBounds: vi.fn(), setView: vi.fn(), removeLayer: vi.fn() };
  const layer = () => ({ addTo: vi.fn().mockReturnThis(), setLatLng: vi.fn().mockReturnThis(), setOpacity: vi.fn().mockReturnThis(), setStyle: vi.fn().mockReturnThis(), bindPopup: vi.fn().mockReturnThis() });
  const dot = layer();
  const L = { map: () => ({ ...map, setView: () => map }), tileLayer: () => ({ addTo: () => ({ on: vi.fn() }) }), marker: vi.fn(() => layer()), circleMarker: vi.fn(() => dot), divIcon: (value: unknown) => value, latLngBounds: (value: unknown) => value };
  const elements = new Map<string, object>();
  const document = { getElementById: (id: string) => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); }, createElement: () => ({ textContent: '' }) };
  const window: any = { L, parent: { postMessage: vi.fn() }, addEventListener: vi.fn() };
  const script = leafletDocument('test').match(/<script>([\s\S]*?)<\/script>/)![1];
  new Function('window', 'document', 'L', 'setTimeout', 'clearTimeout', script)(window, document, L, () => 1, () => {});
  window.updateMelangeMap(trackingMapData(props));
  expect(L.circleMarker).toHaveBeenCalledWith([5.561, -0.191], expect.objectContaining({ fillColor: '#234e40', radius: 9 }));
  window.updateMelangeMap(trackingMapData({ ...props, stale: true, runners: runnersToGeoJSON([{ runnerId: 'runner-one', name: 'Runner', lat: 5.562, lng: -0.192 }]) }));
  expect(L.circleMarker).toHaveBeenCalledOnce();
  expect(dot.setLatLng).toHaveBeenLastCalledWith([5.562, -0.192]);
  expect(dot.setStyle).toHaveBeenLastCalledWith(expect.objectContaining({ fillOpacity: 0.6 }));
});
