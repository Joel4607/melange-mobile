import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { freshLocationFeed } from '../src/lib/fresh-location-feed';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 28)); });
afterEach(() => vi.useRealTimers());

test('stationary devices request new fixes and stopping removes both watcher and refresh timer', async () => {
  const onReading = vi.fn(), remove = vi.fn();
  const current = vi.fn(async () => ({ timestamp: Date.now() }));
  const feed = await freshLocationFeed({ current, watch: async () => ({ remove }), onReading, onError: vi.fn() });
  expect(onReading).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30000);
  expect(onReading).toHaveBeenCalledTimes(4);
  feed.remove();
  await vi.advanceTimersByTimeAsync(30000);
  expect(onReading).toHaveBeenCalledTimes(4);
  expect(remove).toHaveBeenCalledTimes(1);
});

test('cached fixes are not re-dated or re-published, and fresh watch readings avoid unnecessary polls', async () => {
  const timestamp = Date.now(), onReading = vi.fn();
  let receive!: (reading: { timestamp: number }) => void;
  const current = vi.fn(async () => ({ timestamp }));
  const feed = await freshLocationFeed({ current, watch: async callback => { receive = callback; return { remove() {} }; }, onReading, onError: vi.fn() });
  await vi.advanceTimersByTimeAsync(10000);
  expect(onReading).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000); receive({ timestamp: Date.now() });
  await vi.advanceTimersByTimeAsync(5000);
  expect(current).toHaveBeenCalledTimes(2);
  expect(onReading).toHaveBeenCalledTimes(2);
  feed.remove();
});

test('a fix arriving after stop cannot publish and temporary GPS errors are retried', async () => {
  let resolve!: (reading: { timestamp: number }) => void;
  const onReading = vi.fn();
  const feed = await freshLocationFeed({ current: () => new Promise(done => { resolve = done; }), watch: async () => ({ remove() {} }), onReading, onError: vi.fn() });
  feed.remove(); resolve({ timestamp: Date.now() }); await Promise.resolve();
  expect(onReading).not.toHaveBeenCalled();
  const current = vi.fn().mockRejectedValueOnce(new Error('GPS unavailable')).mockImplementation(async () => ({ timestamp: Date.now() }));
  const retrying = await freshLocationFeed({ current, watch: async () => ({ remove() {} }), onReading, onError: vi.fn() });
  await vi.advanceTimersByTimeAsync(10000);
  expect(onReading).toHaveBeenCalledTimes(1);
  retrying.remove();
});
