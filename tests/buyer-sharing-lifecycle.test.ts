// @vitest-environment node
import { readFileSync } from 'node:fs';
import * as React from 'react';
import * as ts from 'typescript';
import { expect, test, vi } from 'vitest';
import { freshPoint } from '../src/lib/runner-location-data';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function sharing() {
  const permission = deferred<{ granted: boolean }>();
  const watcher = deferred<{ remove: () => void }>();
  const begin = vi.fn(async () => null), publish = vi.fn(async () => true), end = vi.fn(async () => null);
  const setEnabled = vi.fn();
  let effect: () => () => void = () => () => {};
  let onState: (state: string) => void = () => {};
  let onReading: (value: any) => void = () => {};
  let hook = 0;
  const context = {
    React, freshPoint, Platform: { OS: 'ios' },
    api: { buyerLocationShares: { start: 'start', publish: 'publish', stop: 'stop', current: 'current' } },
    useMutation: (name: string) => ({ start: begin, publish, stop: end })[name as 'start' | 'publish' | 'stop'],
    useQuery: () => null, useConvexConnectionState: () => ({ isWebSocketConnected: true }),
    useState: () => hook++ === 0 ? [true, setEnabled] : ['', () => {}], useCallback: (callback: unknown) => callback,
    useFocusEffect: (callback: typeof effect) => { effect = callback; },
    AppState: { currentState: 'active', addEventListener: (_event: string, callback: typeof onState) => { onState = callback; return { remove: () => {} }; } },
    Location: { requestForegroundPermissionsAsync: () => permission.promise, hasServicesEnabledAsync: async () => true },
    watchFreshPosition: (receive: typeof onReading) => { onReading = receive; return watcher.promise; },
    View: 'view', Text: 'text', FormError: 'error', CustomerButton: 'button', ui: { small: {}, h3: {} },
  };
  const source = readFileSync(new URL('../src/components/buyer-location-sharing.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('sharing.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = file.statements.find(value => ts.isFunctionDeclaration(value) && value.name?.text === 'BuyerLocationSharing');
  if (!node) throw new Error('BuyerLocationSharing not found');
  const code = ts.transpileModule(node.getText(file).replace(/^export /, '') + '\nreturn BuyerLocationSharing;', { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function(...Object.keys(context), code)(...Object.values(context))({ id: 'errand-one' });
  return { permission, watcher, begin, publish, end, setEnabled, start: () => effect(), state: (state: string) => onState(state), reading: () => onReading({ timestamp: Date.now(), coords: { latitude: 5.56, longitude: -0.19, accuracy: 8 } }) };
}

test('the iOS permission dialog does not cancel the buyer’s explicit sharing request', async () => {
  const share = sharing();
  const stop = share.start();
  share.state('inactive');
  expect(share.setEnabled).not.toHaveBeenCalledWith(false);
  share.permission.resolve({ granted: true });
  await vi.waitFor(() => expect(share.begin).toHaveBeenCalledOnce());
  stop(); share.watcher.resolve({ remove: () => {} });
});

test('leaving during GPS startup removes a late watcher and fences late readings', async () => {
  const share = sharing();
  const stop = share.start();
  share.permission.resolve({ granted: true });
  await vi.waitFor(() => expect(share.begin).toHaveBeenCalledOnce());
  stop();
  const remove = vi.fn(); share.watcher.resolve({ remove });
  await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
  share.reading();
  expect(share.publish).not.toHaveBeenCalled();
  expect(share.end).toHaveBeenCalled();
});
