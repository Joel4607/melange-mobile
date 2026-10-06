import { expect, test, vi } from 'vitest';
import { addressParts, createAddressPublisher } from '../src/lib/runner-address-data';
import { addressText, currentAddressLabel } from '../convex/lib/runnerAddress';

test('formats locality and street without building numbers, missing values or duplicates', () => {
  expect(addressParts({ city: ' Accra ', street: 'Tawiah\n France Ln.' })).toEqual({ city: 'Accra', street: 'Tawiah France Ln.' });
  expect(addressParts({ city: null, district: 'Osu', street: null })).toEqual({ city: 'Osu', street: '' });
  expect(addressText('Accra', 'Accra')).toBe('Accra');
  expect(addressText('', '')).toBeNull();
  expect(addressParts()).toEqual({ city: '', street: '' });
});

test('throttles moving lookups, caches stationary fixes, refreshes and retries failures', async () => {
  let time = 1000000;
  const lookup = vi.fn(async () => [{ city: 'Accra', street: 'Tawiah France Ln.' }]);
  const publish = vi.fn(async () => true);
  const run = createAddressPublisher(lookup, () => time);
  const fix = (latitude = 5.56) => ({ latitude, longitude: -0.19, capturedAt: time });
  await run(fix(), 'session-one', publish);
  time += 5000; await run(fix(5.561), 'session-one', publish);
  expect(lookup).toHaveBeenCalledTimes(1);
  time += 25000; await run(fix(5.561), 'session-one', publish);
  expect(lookup).toHaveBeenCalledTimes(2);
  time += 30000; await run(fix(5.561), 'session-one', publish);
  expect(lookup).toHaveBeenCalledTimes(2);
  time += 90000; lookup.mockRejectedValueOnce(new Error('geocoder offline'));
  await expect(run(fix(5.561), 'session-one', publish)).resolves.toBeUndefined();
  time += 30000; await run(fix(5.561), 'session-one', publish);
  expect(publish).toHaveBeenCalledTimes(3);
  await run(fix(5.561), 'new-session', publish);
  expect(publish).toHaveBeenCalledTimes(4);
});

test('coalesces slow lookups and discards results older than the allowed GPS window', async () => {
  let time = 1000000;
  let resolve!: (value: { city: string }[]) => void;
  const lookup = vi.fn(() => new Promise<{ city: string }[]>(done => { resolve = done; }));
  const publish = vi.fn(async () => true);
  const run = createAddressPublisher(lookup, () => time);
  const fix = { latitude: 5.56, longitude: -0.19, capturedAt: time };
  const first = run(fix, 'one', publish);
  await run(fix, 'one', publish);
  expect(lookup).toHaveBeenCalledTimes(1);
  time += 31000; resolve([{ city: 'Accra' }]); await first;
  expect(publish).not.toHaveBeenCalled();
});

test('does not replace an address with an empty lookup or propagate a publish failure', async () => {
  let time = 1000000;
  const lookup = vi.fn(async (): Promise<{ city: string }[]> => []);
  const publish = vi.fn(async () => { throw new Error('offline'); });
  const run = createAddressPublisher(lookup, () => time);
  await run({ latitude: 5.56, longitude: -0.19, capturedAt: time }, 'one', publish);
  expect(publish).not.toHaveBeenCalled();
  time += 30000; lookup.mockResolvedValue([{ city: 'Accra' }]);
  await expect(run({ latitude: 5.56, longitude: -0.19, capturedAt: time }, 'one', publish)).resolves.toBeUndefined();
});

test('hides address after movement, time expiry, session replacement and going offline', () => {
  const runner = { status: 'online', lat: 5.56, lng: -0.19, capturedAt: 1000000, locationSessionId: 'one', address: { city: 'Accra', street: 'Tawiah France Ln.', lat: 5.56, lng: -0.19, capturedAt: 1000000, sessionId: 'one' } };
  expect(currentAddressLabel(runner)).toBe('Accra, Tawiah France Ln.');
  expect(currentAddressLabel({ ...runner, lat: 5.562 })).toBeNull();
  expect(currentAddressLabel({ ...runner, capturedAt: 1180001 })).toBeNull();
  expect(currentAddressLabel({ ...runner, locationSessionId: 'two' })).toBeNull();
  expect(currentAddressLabel({ ...runner, status: 'offline' })).toBeNull();
});
