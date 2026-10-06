import { beforeEach, expect, test, vi } from 'vitest';
import { ConvexError } from 'convex/values';

const state = vi.hoisted(() => ({ values: new Map<string, string>(), started: false, task: null as null | ((args: any) => Promise<void>), mutation: vi.fn(), query: vi.fn(), geocode: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { executionEnvironment: 'standalone' }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
vi.mock('expo-secure-store', () => ({ AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device', getItemAsync: async (key: string) => state.values.get(key) ?? null, setItemAsync: async (key: string, value: string) => { state.values.set(key, value); }, deleteItemAsync: async (key: string) => { state.values.delete(key); } }));
vi.mock('expo-task-manager', () => ({ isTaskDefined: () => false, isAvailableAsync: async () => true, defineTask: (_name: string, task: typeof state.task) => { state.task = task; } }));
vi.mock('expo-location', () => ({ reverseGeocodeAsync: state.geocode, Accuracy: { High: 4 }, hasStartedLocationUpdatesAsync: async () => state.started, stopLocationUpdatesAsync: async () => { state.started = false; }, startLocationUpdatesAsync: async () => { state.started = true; } }));
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { setAuth() {} mutation = state.mutation; query = state.query; } }));
const token = (exp = Date.now() / 1000 + 3600) => `header.${btoa(JSON.stringify({ exp }))}.signature`;
const fix = (timestamp: number) => ({ timestamp, coords: { latitude: 5.56, longitude: -0.19, accuracy: 8 } });
beforeEach(() => {
  vi.resetModules(); state.values.clear(); state.started = false; state.task = null;
  state.mutation.mockReset().mockResolvedValue(true); state.query.mockReset();
  state.geocode.mockReset().mockResolvedValue([]);
  vi.stubEnv('EXPO_PUBLIC_CONVEX_URL', 'https://test.convex.cloud');
});
test('stopping background sharing removes the task, credential and server session', async () => {
  const bg = await import('../src/lib/runner-background');
  await bg.startRunnerBackground({ mode: 'availability', sessionId: 'session-first', token: token() });
  expect(state.started).toBe(true);
  await bg.stopRunnerBackground();
  expect(state.started).toBe(false); expect(state.values.size).toBe(0);
  expect(state.mutation).toHaveBeenLastCalledWith(expect.anything(), { sessionId: 'session-first' });
});
test('cleanup from an old task cannot stop a replacement session', async () => {
  const bg = await import('../src/lib/runner-background');
  await bg.startRunnerBackground({ mode: 'availability', sessionId: 'session-first', token: token() });
  await bg.startRunnerBackground({ mode: 'availability', sessionId: 'session-second', token: token() });
  await bg.stopRunnerBackground('session-first');
  expect(state.started).toBe(true);
  expect([...state.values.values()][0]).toContain('session-second');
});
test('native task sends the freshest batched fix and ignores stale locations', async () => {
  const bg = await import('../src/lib/runner-background');
  await bg.startRunnerBackground({ mode: 'availability', sessionId: 'session-first', token: token() });
  const newest = Date.now();
  await state.task!({ data: { locations: [fix(newest), fix(newest - 5000)] } });
  expect(state.mutation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ capturedAt: newest, sessionId: 'session-first' }));
  state.mutation.mockClear();
  await state.task!({ data: { locations: [fix(newest - 60_000)] } });
  expect(state.mutation).not.toHaveBeenCalled();
});
test('expired authentication and ended errands unregister background tracking', async () => {
  const bg = await import('../src/lib/runner-background');
  await bg.startRunnerBackground({ mode: 'availability', sessionId: 'session-first', token: token(Date.now() / 1000 - 1) });
  await state.task!({ data: { locations: [fix(Date.now())] } });
  expect(state.started).toBe(false); expect(state.values.size).toBe(0);
  await bg.startRunnerBackground({ mode: 'errand', id: 'test-errand' as any, sessionId: 'session-next', token: token() });
  state.mutation.mockRejectedValue(new ConvexError('Only the assigned runner can share location for an active errand.'));
  await state.task!({ data: { locations: [fix(Date.now())] } });
  expect(state.started).toBe(false); expect(state.values.size).toBe(0);
});
test('a temporary network outage retains the task for a fresh retry', async () => {
  const bg = await import('../src/lib/runner-background');
  await bg.startRunnerBackground({ mode: 'availability', sessionId: 'session-first', token: token() });
  state.mutation.mockRejectedValue(new Error('Network request failed'));
  await state.task!({ data: { locations: [fix(Date.now())] } });
  expect(state.started).toBe(true); expect(state.values.size).toBe(1);
});

test('background availability publishes its street after GPS, while geocoder failures keep sharing alive', async () => {
  const bg = await import('../src/lib/runner-background');
  await bg.startRunnerBackground({ mode: 'availability', sessionId: 'address-session', token: token() });
  state.geocode.mockResolvedValue([{ city: 'Accra', street: 'Tawiah France Ln.' }]);
  const capturedAt = Date.now();
  await state.task!({ data: { locations: [fix(capturedAt)] } });
  expect(state.mutation).toHaveBeenLastCalledWith(expect.anything(), { lat: 5.56, lng: -0.19, capturedAt, sessionId: 'address-session', city: 'Accra', street: 'Tawiah France Ln.' });
  await bg.startRunnerBackground({ mode: 'availability', sessionId: 'address-failure-session', token: token() });
  state.geocode.mockRejectedValue(new Error('No geocoder service'));
  await state.task!({ data: { locations: [fix(Date.now())] } });
  expect(state.started).toBe(true); expect(state.values.size).toBe(1);
});

test('private delivery tracking does not publish a public street address', async () => {
  const bg = await import('../src/lib/runner-background');
  await bg.startRunnerBackground({ mode: 'errand', sessionId: 'private-address-session', id: 'test-errand' as any, token: token() });
  await state.task!({ data: { locations: [fix(Date.now())] } });
  expect(state.geocode).not.toHaveBeenCalled();
});
