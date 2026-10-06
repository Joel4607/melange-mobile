// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { waitForRefresh } from '../src/lib/refresh-sync';

afterEach(() => vi.useRealTimers());

function subscription() {
  let update = () => {};
  const unsubscribe = vi.fn();
  const watch = { onUpdate: vi.fn((callback: () => void) => { update = callback; return unsubscribe; }), localQueryResult: vi.fn<() => number | undefined>(() => undefined) };
  return { watch, unsubscribe, update: () => update() };
}

test('refresh waits for server acknowledgement and releases its subscription', async () => {
  const { watch, unsubscribe, update } = subscription();
  let finished = false;
  const pending = waitForRefresh(watch, new AbortController().signal).then(() => { finished = true; });
  update(); await Promise.resolve();
  expect(finished).toBe(false);
  watch.localQueryResult.mockReturnValue(1234);
  update(); await pending;
  expect(finished).toBe(true);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('server failures reject refresh and release the subscription', async () => {
  const { watch, unsubscribe, update } = subscription();
  watch.localQueryResult.mockImplementation(() => { throw new Error('server unavailable'); });
  const pending = waitForRefresh(watch, new AbortController().signal);
  const assertion = expect(pending).rejects.toThrow('server unavailable');
  update(); await assertion;
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('an offline refresh times out and leaves no active watch or timer', async () => {
  vi.useFakeTimers();
  const { watch, unsubscribe } = subscription();
  const pending = waitForRefresh(watch, new AbortController().signal);
  const assertion = expect(pending).rejects.toThrow('Check your connection');
  await vi.advanceTimersByTimeAsync(12000); await assertion;
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test('leaving a screen cancels refresh and ignores late server updates', async () => {
  vi.useFakeTimers();
  const { watch, unsubscribe, update } = subscription();
  const controller = new AbortController();
  const pending = waitForRefresh(watch, controller.signal);
  const assertion = expect(pending).rejects.toThrow('cancelled');
  controller.abort(); await assertion;
  watch.localQueryResult.mockReturnValue(1234); update();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test('a cancelled request never opens a subscription', async () => {
  const { watch } = subscription();
  const controller = new AbortController(); controller.abort();
  await expect(waitForRefresh(watch, controller.signal)).rejects.toThrow('cancelled');
  expect(watch.onUpdate).not.toHaveBeenCalled();
});
