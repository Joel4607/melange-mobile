import { afterEach, expect, test, vi } from 'vitest';
import { createRunnerPublisher, type PublisherScope } from '../src/lib/runner-publisher';
afterEach(() => vi.useRealTimers());
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('repeat renders of the same assignment do not open two GPS watches', async () => {
  const start = vi.fn(async () => undefined); const p = createRunnerPublisher(start);
  p.set('private-A'); p.set('private-A'); await p.settled();
  expect(start).toHaveBeenCalledTimes(1); p.set(null);
});
test('obsolete permission work cannot start a late watch or replace another assignment', async () => {
  const permission = deferred(), started = deferred(); const watches: string[] = [];
  const p = createRunnerPublisher(async (scope, target: string) => {
    if (target === 'A') { started.resolve(); await permission.promise; }
    if (!scope.isCurrent()) return;
    watches.push(target); await scope.addCleanup(() => { watches.splice(watches.indexOf(target), 1); });
  });
  p.set('A'); await started.promise; p.set('B'); permission.resolve(); await p.settled();
  expect(watches).toEqual(['B']); p.set(null); await p.settled(); expect(watches).toEqual([]);
});
test('replacement waits for background teardown and late resources are removed', async () => {
  const pending = deferred(), teardown = deferred(), started = deferred(); const events: string[] = [];
  const p = createRunnerPublisher(async (scope, target: string) => {
    if (target === 'A') { started.resolve(); await pending.promise; await scope.addCleanup(async () => { events.push('stop A'); await teardown.promise; }); }
    if (scope.isCurrent()) events.push(`start ${target}`);
  });
  p.set('A'); await started.promise; p.set('B'); pending.resolve();
  await vi.waitFor(() => expect(events).toEqual(['stop A']));
  teardown.resolve(); await p.settled(); expect(events).toEqual(['stop A', 'start B']);
  p.set(null);
});
test('temporary errors retry with bounded backoff, then require explicit recovery', async () => {
  vi.useFakeTimers(); const error = vi.fn(); const start = vi.fn(async () => { throw new Error('Network unavailable'); });
  const p = createRunnerPublisher(start, error, [1000, 2000]); p.set('A'); await p.settled();
  expect(start).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000); await p.settled(); expect(start).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000); await p.settled(); expect(start).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(60_000); expect(start).toHaveBeenCalledTimes(3);
  expect(error).toHaveBeenLastCalledWith('Network unavailable', null);
  p.retry(); await p.settled(); expect(start).toHaveBeenCalledTimes(4); p.set(null);
});
test('permission refusal has no automatic permission retries', async () => {
  vi.useFakeTimers(); let scope!: PublisherScope;
  const start = vi.fn(async (s: PublisherScope) => { scope = s; s.fail('Allow location in settings.', false); });
  const p = createRunnerPublisher(start); p.set('A'); await p.settled();
  await vi.advanceTimersByTimeAsync(60_000); expect(start).toHaveBeenCalledTimes(1); expect(scope.isCurrent()).toBe(false);
  p.retry(); await p.settled(); expect(start).toHaveBeenCalledTimes(2); p.set(null);
});
test('sign-out or final delivery cancels retries and removes the active watch', async () => {
  vi.useFakeTimers(); const remove = vi.fn(); let scope!: PublisherScope;
  const p = createRunnerPublisher(async s => { scope = s; await s.addCleanup(remove); });
  p.set('A'); await p.settled(); scope.fail('GPS unavailable'); p.set(null);
  await vi.advanceTimersByTimeAsync(60_000); await p.settled(); expect(remove).toHaveBeenCalledTimes(1);
});
test('late errors from a replaced watch cannot stop the new session', async () => {
  const scopes: PublisherScope[] = []; const report = vi.fn();
  const p = createRunnerPublisher(async s => { scopes.push(s); }, report);
  p.set('A'); await p.settled(); p.set('B'); await p.settled(); scopes[0].fail('Old error');
  expect(scopes[1].isCurrent()).toBe(true); expect(report).not.toHaveBeenCalled(); p.set(null);
});
test('new accepted fixes reset retry allowance without republishing cached positions', async () => {
  vi.useFakeTimers(); const scopes: PublisherScope[] = [];
  const p = createRunnerPublisher(async s => { scopes.push(s); }, undefined, [1000]);
  p.set('A'); await p.settled(); scopes[0].fail('Temporary');
  await vi.advanceTimersByTimeAsync(1000); await p.settled(); scopes[1].healthy(); scopes[1].fail('New outage');
  await vi.advanceTimersByTimeAsync(1000); await p.settled(); expect(scopes).toHaveLength(3); p.set(null);
});
