type Cleanup = () => void | Promise<void>;
export type PublisherScope = {
  isCurrent: () => boolean;
  addCleanup: (cleanup: Cleanup) => Promise<void>;
  fail: (message: string, retryable?: boolean) => void;
  healthy: () => void;
};

/** Owns one GPS resource. Superseded async work must check isCurrent after awaits. */
export function createRunnerPublisher<T>(
  start: (scope: PublisherScope, target: T) => Promise<void>,
  onError: (message: string, retryInMs: number | null) => void = () => undefined,
  retryDelays = [1000, 2000, 4000, 8000, 16000],
) {
  let target: T | null = null, generation = 0, attempt = 0;
  let tail = Promise.resolve(), releases = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: { dead: boolean; cleanups: Cleanup[] } | undefined;
  function release(cleanup: Cleanup) {
    // Invoke removal immediately, even while a permission/session request is pending.
    let result: void | Promise<void>;
    try { result = cleanup(); } catch { return Promise.resolve(); }
    const done = Promise.resolve(result).catch(() => undefined);
    releases = Promise.all([releases, done]).then(() => undefined);
    return done;
  }
  function cancel() {
    generation++;
    if (timer) clearTimeout(timer); timer = undefined;
    if (current) { current.dead = true; current.cleanups.splice(0).forEach(cleanup => { void release(cleanup); }); }
  }
  function launch() {
    const mine = generation, next = target;
    tail = tail.catch(() => undefined).then(async () => {
      await releases;
      if (mine !== generation || next === null) return;
      const owner = { dead: false, cleanups: [] as Cleanup[] }; current = owner;
      const valid = () => !owner.dead && generation === mine;
      const scope: PublisherScope = {
        isCurrent: valid,
        addCleanup: async cleanup => { if (valid()) owner.cleanups.push(cleanup); else await release(cleanup); },
        healthy: () => { if (valid()) attempt = 0; },
        fail: (message, retryable = true) => {
          if (!valid()) return;
          cancel();
          const retryIn = retryable && attempt < retryDelays.length ? retryDelays[attempt++] : null;
          onError(message, retryIn);
          if (retryIn !== null) {
            const retryGeneration = generation;
            timer = setTimeout(() => { timer = undefined; if (generation === retryGeneration && target !== null) launch(); }, retryIn);
          }
        },
      };
      try { await start(scope, next); }
      catch (error) { scope.fail(error instanceof Error ? error.message : 'Could not restore location.'); }
    });
  }
  return {
    set(next: T | null) { if (target === next) return; cancel(); target = next; attempt = 0; launch(); },
    retry() { if (target === null) return; cancel(); attempt = 0; launch(); },
    async settled() { let pending: Promise<void>; do { pending = tail; await pending; await releases; } while (pending !== tail); },
  };
}
