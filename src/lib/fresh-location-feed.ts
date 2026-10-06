type Reading = { timestamp: number };
type Subscription = { remove: () => void };
type Source<T extends Reading> = {
  watch: (onReading: (reading: T) => void, onError: () => void) => Promise<Subscription>;
  current: () => Promise<T>;
  onReading: (reading: T) => void;
  onError: () => void;
};

// iOS/browser watches need not emit while stationary. Ask the GPS provider
// again rather than re-dating and republishing an old coordinate as live.
export async function freshLocationFeed<T extends Reading>(source: Source<T>): Promise<Subscription> {
  let stopped = false, pending = false, lastReading = 0;
  let watch: Subscription | undefined;
  function receive(reading: T) {
    if (stopped || !Number.isFinite(reading.timestamp) || reading.timestamp <= lastReading
      || reading.timestamp < Date.now() - 15000 || reading.timestamp > Date.now() + 10000) return;
    lastReading = reading.timestamp;
    source.onReading(reading);
  }
  async function refresh() {
    if (stopped || pending || Date.now() - lastReading < 8000) return;
    pending = true;
    try { receive(await source.current()); }
    catch { /* A temporary GPS failure is reflected by freshness, then retried. */ }
    finally { pending = false; }
  }
  const timer = setInterval(() => void refresh(), 10000);
  function remove() { stopped = true; clearInterval(timer); watch?.remove(); }
  void refresh();
  try {
    watch = await source.watch(receive, () => { if (!stopped) source.onError(); });
    if (stopped) watch.remove();
    return { remove };
  } catch (error) { remove(); throw error; }
}
