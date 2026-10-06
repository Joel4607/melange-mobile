// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const native = vi.hoisted(() => ({ reverseGeocodeAsync: vi.fn() }));
const platform = vi.hoisted(() => ({ OS: 'web' }));
vi.mock('expo-location', () => native);
vi.mock('react-native', () => ({ Platform: platform }));

beforeEach(() => { vi.resetModules(); platform.OS = 'web'; native.reverseGeocodeAsync.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const result = (properties: Record<string, unknown>) => ({ features: [{ properties }] });
async function publish(payload: unknown, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal('fetch', fetcher);
  const save = vi.fn(async () => true);
  const { updateRunnerAddress } = await import('../src/lib/runner-address');
  await updateRunnerAddress({ latitude: 5.56, longitude: -0.19, capturedAt: Date.now() }, 'private-session-id', save);
  return { fetcher, save };
}

test('a browser GPS fix resolves city and street and publishes through the current session', async () => {
  const { fetcher, save } = await publish(result({ city: 'Accra', street: 'Tawiah France Ln.', housenumber: '42' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ city: 'Accra', street: 'Tawiah France Ln.', sessionId: 'private-session-id' }));
  const [request, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  const url = new URL(request);
  expect(url.searchParams.get('lat')).toBe('5.56');
  expect(url.searchParams.get('lon')).toBe('-0.19');
  expect(request).not.toContain('private-session-id');
  expect(options.credentials).toBe('omit');
  expect(native.reverseGeocodeAsync).not.toHaveBeenCalled();
});

test('road features can use their name and an available locality', async () => {
  const { save } = await publish(result({ district: 'Osu', osm_key: 'highway', osm_value: 'residential', name: 'Oxford Street' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ city: 'Osu', street: 'Oxford Street' }));
});

test('does not invent a street from a shop or building name', async () => {
  const { save } = await publish(result({ city: 'Accra', osm_key: 'shop', name: 'A shop' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ city: 'Accra', street: '' }));
});

test.each([{}, { features: [{ properties: { city: 123, street: {} } }] }])('invalid provider data is not published', async payload => {
  const { save } = await publish(payload);
  expect(save).not.toHaveBeenCalled();
});

test('provider HTTP failure cannot interrupt location sharing', async () => {
  const { save } = await publish(result({ city: 'Accra' }), 429);
  expect(save).not.toHaveBeenCalled();
});

test('slow browser lookups are aborted rather than blocking future lookups', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  vi.stubGlobal('fetch', fetcher);
  const save = vi.fn(async () => true);
  const { updateRunnerAddress } = await import('../src/lib/runner-address');
  const pending = updateRunnerAddress({ latitude: 5.56, longitude: -0.19, capturedAt: Date.now() }, 'one', save);
  await vi.advanceTimersByTimeAsync(8000);
  await pending;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(save).not.toHaveBeenCalled();
});

test('native phones still use their device geocoder', async () => {
  platform.OS = 'ios';
  native.reverseGeocodeAsync.mockResolvedValue([{ city: 'Accra', street: 'Oxford Street' }]);
  const { fetcher, save } = await publish({});
  expect(native.reverseGeocodeAsync).toHaveBeenCalledOnce();
  expect(fetcher).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ city: 'Accra', street: 'Oxford Street' }));
});
