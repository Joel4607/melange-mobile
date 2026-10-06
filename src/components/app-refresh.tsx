import { useConvex } from 'convex/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import { api } from '../../convex/_generated/api';
import { waitForRefresh } from '../lib/refresh-sync';

const RefreshContext = createContext<((signal: AbortSignal) => Promise<void>) | null>(null);
let requestNumber = 0;

export function AppRefreshProvider({ children }: PropsWithChildren) {
  const convex = useConvex();
  const refresh = useCallback((signal: AbortSignal) => {
    // Using new arguments prevents query() from returning its existing cache.
    // Convex applies this result and the active screen subscriptions together.
    const nonce = Date.now() + '-' + (++requestNumber) + '-' + Math.random().toString(36).slice(2);
    return waitForRefresh(convex.watchQuery(api.refresh.sync, { nonce }), signal);
  }, [convex]);
  return <RefreshContext.Provider value={refresh}>{children}</RefreshContext.Provider>;
}

export function usePullToRefresh() {
  const refresh = useContext(RefreshContext);
  const pending = useRef<AbortController | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const enabled = Platform.OS !== 'web' && refresh !== null;
  useEffect(() => () => { pending.current?.abort(); }, []);
  const onRefresh = useCallback(async () => {
    if (!enabled || !refresh || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setRefreshing(true); setError('');
    try { await refresh(controller.signal); }
    catch {
      if (!controller.signal.aborted) setError('Couldn’t refresh. Check your connection and pull down to try again.');
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, [enabled, refresh]);
  return { enabled, refreshing, error, onRefresh };
}
