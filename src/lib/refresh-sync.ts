type RefreshWatch = {
  onUpdate: (callback: () => void) => () => void;
  localQueryResult: () => number | undefined;
};

export function waitForRefresh(watch: RefreshWatch, signal: AbortSignal, timeoutMs = 12000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Refresh cancelled')); return; }
    let settled = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      unsubscribe();
      if (error) reject(error); else resolve();
    };
    const cancel = () => finish(new Error('Refresh cancelled'));
    signal.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error('Couldn’t refresh. Check your connection and pull down to try again.')), timeoutMs);
    try {
      unsubscribe = watch.onUpdate(() => {
        if (settled) return;
        try { if (watch.localQueryResult() !== undefined) finish(); }
        catch (error) { finish(error); }
      });
      // Also release a watch implementation that acknowledges synchronously.
      if (settled) unsubscribe();
    } catch (error) { finish(error); }
  });
}
