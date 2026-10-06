import { useAuthToken } from '@convex-dev/auth/react';
import { useConvex, useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import * as Location from 'expo-location';
import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Platform, Pressable, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { backgroundSupported, freshPoint, refreshRunnerBackgroundToken, startRunnerBackground, stopRunnerBackground } from '@/lib/runner-background';
import { CustomerButton, FormError, palette, ui } from './customer-ui';
import { updateRunnerAddress } from '@/lib/runner-address';
import { LocationLabel } from './runner-location-label';
import { watchFreshPosition } from '@/lib/watch-fresh-position';
import { createRunnerPublisher, type PublisherScope } from '@/lib/runner-publisher';
import { TrackingCondition } from './tracking-condition';
import { trackingPresentation } from '@/lib/tracking-presentation';

type Selection = { mode: 'availability' } | { mode: 'errand'; id: Id<'errands'> };
type Sharing = { reserved: boolean; activeId: Id<'errands'> | null; trackingRequired: boolean; trackingMemberId?: Id<'errands'>; mode: Selection['mode'] | null; message: string; error: string; background: boolean; setBackground: (on: boolean) => void; start: (selection: Selection) => void; stop: () => void; restore: () => void };
const SharingContext = createContext<Sharing | null>(null);

export function RunnerLocationProvider({ children }: PropsWithChildren) {
  const active = useQuery(api.runnerJobs.capacity, {});
  const convex = useConvex();
  const token = useAuthToken();
  const tokenRef = useRef(token); tokenRef.current = token;
  const beginPrivate = useMutation(api.locations.startRunner);
  const publishPrivate = useMutation(api.locations.publishRunner);
  const stopPrivate = useMutation(api.locations.stopRunner);
  const beginOnline = useMutation(api.runners.startAvailability);
  const publishOnline = useMutation(api.runners.updateLocation);
  const publishAddress = useMutation(api.runners.updateAddress);
  const stopOnline = useMutation(api.runners.setOffline);
  const { isWebSocketConnected: connected } = useConvexConnectionState();
  const [selection, select] = useState<Selection | null>(null);
  const [background, setBackground] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [message, setMessage] = useState('Location sharing is off.');
  const [error, setError] = useState('');
  const [lastPublishedAt, setLastPublishedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const askedPermission = useRef(new Set<string>());
  const initialBackgroundCleanup = useRef<Promise<void>>(Promise.resolve());
  // A reserved shared offer still needs eligibility updates until both buyers approve.
  const reserved = active?.status === 'posted';
  const activeId = reserved ? null : active?.id ?? null;
  const trackingRequired = !!activeId && !!active?.trackingRequired;
  const tracking = useQuery(api.tracking.current, trackingRequired && active?.trackingMemberId ? { id: active.trackingMemberId } : 'skip');
  const useBackground = background && backgroundSupported;
  const canRun = useBackground || (connected && (Platform.OS === 'web' || appState === 'active'));
  const mode = trackingRequired ? 'errand' : selection && (selection.mode === 'availability' ? !activeId : selection.id === activeId) ? selection.mode : null;
  const key = mode ? mode + ':' + (mode === 'errand' ? activeId : '') + ':' + (useBackground ? 'background' : 'foreground') : null;
  const startRef = useRef<(scope: PublisherScope, key: string) => Promise<void>>(async () => undefined);
  const [publisher] = useState(() => createRunnerPublisher<string>((scope, target) => startRef.current(scope, target), (reason, delay) => {
    setError(reason); setMessage(delay === null ? 'Restore location when ready.' : 'Retrying location in ' + Math.ceil(delay / 1000) + ' seconds…');
  }));

  startRef.current = async (scope, target) => {
    const [sessionMode, rawId, capability] = target.split(':');
    const id = sessionMode === 'errand' ? rawId as Id<'errands'> : undefined;
    const withBackground = capability === 'background';
    const sessionId = 'gps-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    let pending = false, lastAttempt = 0;
    setError(''); setLastPublishedAt(0); setMessage('Starting location sharing…');
    const fail = (reason: unknown) => scope.fail(reason instanceof ConvexError && typeof reason.data === 'string' ? reason.data : reason instanceof Error ? reason.message : 'Check your connection and restore location.', !(reason instanceof ConvexError));
    const stopServer = () => sessionMode === 'availability' ? stopOnline({ sessionId }) : stopPrivate({ id: id!, sessionId });
    async function send(reading: Location.LocationObject) {
      if (!scope.isCurrent() || pending || (Platform.OS !== 'web' && AppState.currentState !== 'active')) return;
      const point = freshPoint(reading);
      if (!point || Date.now() - lastAttempt < 5000) return;
      pending = true; lastAttempt = Date.now();
      try {
        const accepted = sessionMode === 'availability'
          ? await publishOnline({ lat: point.latitude, lng: point.longitude, capturedAt: point.capturedAt, status: 'online', sessionId })
          : await publishPrivate({ id: id!, sessionId, point });
        if (!scope.isCurrent()) return;
        if (accepted) {
          scope.healthy(); setError(''); setLastPublishedAt(point.capturedAt);
          setMessage(sessionMode === 'availability' ? 'Sharing availability with nearby buyers.' : 'Sharing privately with the active buyers on your route.');
          if (sessionMode === 'availability') void updateRunnerAddress(point, sessionId, update => scope.isCurrent() ? publishAddress(update) : Promise.resolve(false));
        } else {
          const current = sessionMode === 'availability' ? await convex.query(api.runners.availabilitySession, {}) : (await convex.query(api.locations.current, { id: id! }))?.sessionId;
          if (scope.isCurrent() && current !== sessionId) scope.fail('This location session ended or was replaced. Restore location on the device you want to use.', false);
        }
      } catch (err) { fail(err); }
      finally { pending = false; }
    }
    await initialBackgroundCleanup.current;
    if (!scope.isCurrent()) return;
    // Ask once on first start (or explicit Restore). Reconnects check permission
    // without repeatedly opening system permission dialogs.
    const mayAsk = !askedPermission.current.has(target);
    askedPermission.current.add(target);
    let permission = await Location.getForegroundPermissionsAsync();
    if (!scope.isCurrent()) return;
    if (!permission.granted && mayAsk) permission = await Location.requestForegroundPermissionsAsync();
    if (!scope.isCurrent()) return;
    if (!permission.granted) { scope.fail('Allow location access in your device or browser settings, then tap Restore location.', false); return; }
    if (!(await Location.hasServicesEnabledAsync())) { scope.fail('Turn on location services, then tap Restore location.', false); return; }
    if (!scope.isCurrent()) return;
    if (withBackground) {
      let permission = await Location.getBackgroundPermissionsAsync();
      if (!scope.isCurrent()) return;
      if (!permission.granted && mayAsk) permission = await Location.requestBackgroundPermissionsAsync();
      if (!scope.isCurrent()) return;
      if (!permission.granted) { scope.fail('Background permission is unavailable. Choose foreground sharing or allow permission in settings, then restore location.', false); return; }
    }
    if (!scope.isCurrent() || !tokenRef.current) return;
    if (sessionMode === 'availability') await beginOnline({ sessionId }); else await beginPrivate({ id: id!, sessionId });
    await scope.addCleanup(() => { void stopServer().catch(() => undefined); });
    if (!scope.isCurrent()) return;
    if (withBackground) {
      await startRunnerBackground({ mode: sessionMode as Selection['mode'], id, sessionId, token: tokenRef.current! });
      await scope.addCleanup(() => stopRunnerBackground(sessionId));
      if (scope.isCurrent()) setMessage('Background sharing enabled. Live status depends on fresh GPS updates.');
    } else {
      setMessage('Waiting for a fresh GPS position…');
      const watcher = await watchFreshPosition(fix => { void send(fix); }, () => scope.fail('GPS is unavailable. Check location services.'));
      await scope.addCleanup(() => watcher.remove());
    }
  };

  useEffect(() => {
    // Clear a native task left by a previous app instance before opening a watch.
    initialBackgroundCleanup.current = stopRunnerBackground().catch(() => undefined);
    const sub = AppState.addEventListener('change', setAppState);
    return () => { sub.remove(); publisher.set(null); };
  }, [publisher]);
  useEffect(() => { publisher.set(key && canRun && token ? key : null); }, [publisher, key, canRun, !!token]);
  useEffect(() => { if (!mode) return; const timer = setInterval(() => setNow(Date.now()), 3000); return () => clearInterval(timer); }, [mode]);
  useEffect(() => { if (token) void refreshRunnerBackgroundToken(token).catch(() => undefined); }, [token]);
  useEffect(() => {
    if (active !== undefined && selection && ((selection.mode === 'availability' && activeId) || (selection.mode === 'errand' && activeId !== selection.id))) select(null);
  }, [active, activeId, selection]);
  const restore = () => { if (key) askedPermission.current.delete(key); setError(''); publisher.retry(); };
  const value: Sharing = { reserved, activeId, trackingRequired, trackingMemberId: active?.trackingMemberId, mode, background, setBackground, error,
    message: mode === 'availability' && reserved && canRun && !error ? 'Keeping your location current for the reserved shared run. You are hidden from nearby search.' : !mode ? 'Location sharing is off.' : !canRun ? 'Paused. Keep the app open and connected for foreground sharing.' : !useBackground && lastPublishedAt > 0 && now - lastPublishedAt >= 30000 && !error ? 'GPS update delayed. Your last position is shown until a fresh reading arrives.' : message,
    start: next => {
      setError('');
      if (key && mode === next.mode) restore();
      else {
        askedPermission.current.delete(next.mode + ':' + (next.mode === 'errand' ? next.id : '') + ':' + (useBackground ? 'background' : 'foreground'));
        select(next);
      }
    },
    stop: () => { if (!trackingRequired) { select(null); setError(''); } }, restore,
  };
  return <SharingContext.Provider value={value}><View style={ui.screen}>
    {children}
    {mode && <SafeAreaView edges={['bottom', 'left', 'right']} style={{ backgroundColor: palette.pale }}>
      <View style={{ padding: 12, gap: 5 }}>
        <Text accessibilityLiveRegion="polite" style={ui.small}>{trackingRequired ? (tracking ? trackingPresentation(tracking, 0, connected).title : 'Waiting for tracking status') + ' · ' : ''}{error || value.message}</Text>
        {mode === 'availability' && !!error && <CustomerButton disabled={!canRun} onPress={restore}>Restore location</CustomerButton>}
        <CustomerButton disabled={trackingRequired && !canRun} onPress={trackingRequired ? restore : value.stop}>{mode === 'availability' ? 'Go offline' : trackingRequired ? 'Restore location' : 'Stop sharing location'}</CustomerButton>
      </View>
    </SafeAreaView>}
  </View></SharingContext.Provider>;
}
function BackgroundChoice({ sharing }: { sharing: Sharing }) {
  return <><View style={ui.between}><Text style={[ui.body, { flex: 1 }]}>Keep sharing when the screen locks</Text><Switch accessibilityLabel="Background location sharing" value={sharing.background} disabled={!backgroundSupported || (!!sharing.mode && !sharing.trackingRequired)} onValueChange={sharing.setBackground} /></View><Text style={ui.small}>{backgroundSupported ? 'Requires background location permission. Android shows a notification. Phone settings or an expired sign-in may pause updates; reopen the app to resume.' : 'Background tracking needs a development build. Expo Go and web use foreground location. Switching browser tabs does not turn sharing off, but the browser may suspend GPS updates.'}</Text></>;
}
export function RunnerAvailabilityControls({ compact = false }: { compact?: boolean }) {
  const sharing = useContext(SharingContext);
  const { isWebSocketConnected } = useConvexConnectionState();
  const dashboard = useQuery(api.runners.dashboard, {});
  const [showOptions, setShowOptions] = useState(false);
  if (!sharing) return null;
  if (compact) return <View style={{ gap: 10, borderBottomWidth: 1, borderBottomColor: palette.line, paddingBottom: 14 }}>
    <View style={[ui.between, { flexWrap: 'wrap' }]}>
      <View style={{ flex: 1, minWidth: 150, gap: 4 }}><Text style={ui.h2}>{sharing.reserved ? 'Shared run reserved' : sharing.activeId ? 'On an errand' : dashboard?.availability === 'online' ? 'You’re online' : dashboard?.availability === 'busy' ? 'You’re busy' : 'You’re offline'}</Text><Text style={ui.small}>{sharing.reserved ? 'Keep location updates on while the other buyer approves.' : sharing.activeId ? sharing.trackingRequired ? 'Location sharing starts automatically for this route.' : 'Open your route to share live location.' : dashboard?.availability === 'online' ? 'Nearby buyers can see your location.' : 'Go online to appear to nearby buyers.'}</Text></View>
      <CustomerButton disabled={sharing.mode !== 'availability' && (!!sharing.activeId || !isWebSocketConnected)} onPress={() => sharing.mode === 'availability' ? sharing.stop() : sharing.start({ mode: 'availability' })}>{sharing.mode === 'availability' ? 'Go offline' : 'Go online'}</CustomerButton>
    </View>
    {dashboard?.availability === 'online' && <LocationLabel label={dashboard.locationLabel} />}
    <FormError message={sharing.error} />
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showOptions }} onPress={() => setShowOptions(!showOptions)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.small}>{showOptions ? '− Hide location options' : '+ Location options'}</Text></Pressable>
    {showOptions && <><BackgroundChoice sharing={sharing} /><Text style={ui.small}>Assignment ends public availability. Location is shared only with the active buyers on your route.</Text>{dashboard?.locationUpdatedAt != null && <Text style={ui.small}>Last update: {new Date(dashboard.locationUpdatedAt).toLocaleString()}</Text>}</>}
  </View>;
  return <View style={ui.card}><Text style={ui.h2}>Available for errands</Text><Text style={ui.body}>{sharing.reserved ? 'Keep location updates on while the other buyer approves. Your position is hidden from nearby search.' : sharing.activeId ? sharing.trackingRequired ? 'Private sharing starts automatically for your active errand.' : 'You have an active errand. Share your location privately from its details.' : 'Go online to share your current position with nearby buyers. Accepting a job ends this availability session.'}</Text><Text style={ui.h3}>Map status: {dashboard?.availability ?? 'loading'}</Text><BackgroundChoice sharing={sharing} /><FormError message={sharing.error} /><CustomerButton disabled={sharing.mode !== 'availability' && (!!sharing.activeId || !isWebSocketConnected)} onPress={() => sharing.mode === 'availability' ? sharing.stop() : sharing.start({ mode: 'availability' })}>{sharing.mode === 'availability' ? 'Go offline' : 'Go online'}</CustomerButton></View>;
}
export function RunnerLocationControls({ errandId, shared = false }: { errandId: Id<'errands'>; shared?: boolean }) {
  const sharing = useContext(SharingContext);
  const { isWebSocketConnected } = useConvexConnectionState();
  const location = useQuery(api.locations.current, { id: errandId });
  if (!sharing || sharing.activeId !== errandId) return null;
  return <View style={ui.card}><Text style={ui.h2}>Live location</Text><Text style={ui.body}>{shared ? 'Share with both buyers while their deliveries are active. Each buyer’s access ends at their delivery.' : sharing.trackingRequired ? 'Sharing starts automatically and stays private to this buyer until delivery.' : 'Share your position with this buyer until delivery. Stop sharing at any time.'}</Text><BackgroundChoice sharing={sharing} /><TrackingCondition id={sharing.trackingMemberId ?? errandId} enabled={sharing.trackingRequired} />{!sharing.trackingRequired && <Text style={ui.small}>{location?.sharing && isWebSocketConnected ? 'A location session is active. Check the map for the last update.' : 'No live GPS update yet.'}</Text>}<Text style={ui.small}>{sharing.message}</Text><FormError message={sharing.error} /><CustomerButton disabled={!isWebSocketConnected && !sharing.background && (sharing.trackingRequired || sharing.mode !== 'errand')} onPress={() => sharing.trackingRequired ? sharing.restore() : sharing.mode === 'errand' ? sharing.stop() : sharing.start({ mode: 'errand', id: errandId })}>{sharing.trackingRequired ? 'Restore location' : sharing.mode === 'errand' ? 'Stop sharing location' : 'Share my live location'}</CustomerButton>{sharing.trackingRequired && <Text style={ui.small}>Recovery needs fresh readings over at least 10 seconds. Keep location permission enabled. Signing out or turning off device location can interrupt tracking; it does not reset the server timer.</Text>}</View>;
}
