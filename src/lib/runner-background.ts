import { ConvexHttpClient } from 'convex/browser';
import { ConvexError } from 'convex/values';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { freshPoint, tokenExpiresAt } from './runner-location-data';
import { updateRunnerAddress } from './runner-address';
export { freshPoint } from './runner-location-data';

export const backgroundSupported = Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
const TASK = 'melange-runner-location-v1';
const KEY = 'melange.runner.location.v1';
export type RunnerSession = { mode: 'availability' | 'errand'; id?: Id<'errands'>; sessionId: string; token: string };
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(run, run); queue = result.catch(() => undefined); return result;
}
async function stored(): Promise<RunnerSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? JSON.parse(raw) : null;
}
function client(session: RunnerSession) {
  const url = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!url) throw new Error('Backend is unavailable.');
  const http = new ConvexHttpClient(url, { logger: false, fetch: async (input, init) => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
    try { return await fetch(input, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
  } }); http.setAuth(session.token); return http;
}
async function stopStored(sessionId?: string) {
  const session = await stored();
  if (sessionId && session?.sessionId !== sessionId) return;
  // Delete the credential first: a queued task can no longer send another fix.
  await SecureStore.deleteItemAsync(KEY);
  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  if (session) {
    const http = client(session);
    // Server leases cover an offline/expired-auth cleanup. Session IDs prevent
    // old requests from reopening stopped availability or private GPS sharing.
    try {
      if (session.mode === 'availability') await http.mutation(api.runners.setOffline, { sessionId: session.sessionId });
      else if (session.id) await http.mutation(api.locations.stopRunner, { id: session.id, sessionId: session.sessionId });
    } catch { /* Backend expiry hides a disconnected device. */ }
  }
}
export async function stopRunnerBackground(sessionId?: string) {
  if (backgroundSupported) await serial(() => stopStored(sessionId));
}
export async function refreshRunnerBackgroundToken(token: string) {
  if (!backgroundSupported) return;
  await serial(async () => {
    const session = await stored();
    if (session) await SecureStore.setItemAsync(KEY, JSON.stringify({ ...session, token }), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
  });
}
export async function startRunnerBackground(session: RunnerSession) {
  if (!backgroundSupported || !(await TaskManager.isAvailableAsync())) throw new Error('Background location needs a development build.');
  await serial(async () => {
    await stopStored();
    await SecureStore.setItemAsync(KEY, JSON.stringify(session), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    try {
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 0,
        deferredUpdatesInterval: 10_000, pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: { notificationTitle: 'Melange location sharing', notificationBody: session.mode === 'errand' ? 'Private errand location sharing. Open Melange to check tracking or restore location.' : 'Location is being shared. Open Melange to go offline.', killServiceOnDestroy: true },
      });
    } catch (err) { await SecureStore.deleteItemAsync(KEY); throw err; }
  });
}

// Required at module scope so the native task works without a mounted screen.
if (backgroundSupported && !TaskManager.isTaskDefined(TASK)) TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  await serial(async () => {
    const session = await stored();
    if (!session) { if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK); return; }
    if (error || tokenExpiresAt(session.token) <= Date.now()) { await stopStored(session.sessionId); return; }
    const newest = data?.locations?.reduce<Location.LocationObject | null>((best, fix) => !best || fix.timestamp > best.timestamp ? fix : best, null);
    const point = newest && freshPoint(newest);
    if (!point) return;
    try {
      const http = client(session);
      const accepted = session.mode === 'availability'
        ? await http.mutation(api.runners.updateLocation, { lat: point.latitude, lng: point.longitude, capturedAt: point.capturedAt, status: 'online', sessionId: session.sessionId })
        : session.id && await http.mutation(api.locations.publishRunner, { id: session.id, sessionId: session.sessionId, point });
      if (accepted && session.mode === 'availability') await updateRunnerAddress(point, session.sessionId, update => http.mutation(api.runners.updateAddress, update));
      // A false update can be a duplicate timestamp, so do not treat it as a
      // permission failure. Delivery/revocation raises ConvexError below.
      if (!accepted && session.mode === 'availability') {
        const activeSession = await http.query(api.runners.availabilitySession, {});
        if (activeSession !== session.sessionId) await stopStored(session.sessionId);
      } else if (!accepted && session.id) {
        const current = await http.query(api.locations.current, { id: session.id });
        if (current?.sessionId !== session.sessionId) await stopStored(session.sessionId);
      }
    } catch (err) {
      // Network outages keep the task registered and retry with a new fix.
      // Expired authentication/ended jobs stop sharing; reopen the app to resume.
      if (err instanceof ConvexError || (err instanceof Error && /unauthenticated|token.*expired|not authenticated/i.test(err.message))) await stopStored(session.sessionId);
    }
  });
});
