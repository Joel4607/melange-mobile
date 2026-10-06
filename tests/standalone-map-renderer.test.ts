// @vitest-environment node
import { readFileSync } from 'node:fs';
import * as React from 'react';
import * as ts from 'typescript';
import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

function render(environment: string, token?: string, renderer?: string) {
  vi.stubEnv('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN', token);
  vi.stubEnv('EXPO_PUBLIC_MAP_RENDERER', renderer);
  const source = readFileSync(new URL('../src/components/maps/map-surface.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('map.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MapSurface')!;
  const code = ts.transpileModule(fn.getText(file).replace('export default ', '') + '\nreturn MapSurface;', {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const requireModule = vi.fn((name: string) => ({ default: name }));
  const context = { React, Constants: { executionEnvironment: environment }, ExecutionEnvironment: { StoreClient: 'storeClient' },
    require: requireModule, process, View: 'view', Text: 'text', ui: { card: {}, h3: {}, body: {} } };
  const component = new Function(...Object.keys(context), code)(...Object.values(context));
  const props = { center: { latitude: 5.56, longitude: -0.19 }, runners: { type: 'FeatureCollection', features: [] } };
  return { element: component(props), props, requireModule };
}

test('standalone APK without a Mapbox token uses the working compatibility map', () => {
  const { element, props, requireModule } = render('standalone');
  expect(element.type).toBe('./map-surface-expo');
  expect(element.props).toEqual(props);
  expect(requireModule).toHaveBeenCalledOnce();
});

test('APK preview keeps Leaflet even if a Mapbox token exists in the account environment', () => {
  const { element, requireModule } = render('standalone', 'pk.test', 'leaflet');
  expect(element.type).toBe('./map-surface-expo');
  expect(requireModule).not.toHaveBeenCalledWith('./map-surface-mapbox');
});

test('configured custom builds can still use Mapbox and Expo Go never loads it', () => {
  expect(render('standalone', 'pk.test').element.type).toBe('./map-surface-mapbox');
  expect(render('storeClient', 'pk.test').element.type).toBe('./map-surface-expo');
});
