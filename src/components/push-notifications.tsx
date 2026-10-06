import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Linking, Platform, Switch, Text, View } from 'react-native';
import { useConvex, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useRootNavigationState, useRouter } from 'expo-router';
import { api } from '../../convex/_generated/api';
import { binding, getPushToken, installationId, nativeNotifications, pushSupported, saveBinding } from '@/lib/push-device';
import { CustomerButton, FormError, ui } from './customer-ui';

type Preferences = { messages: boolean; updates: boolean };
type PushContextValue = { enabled: boolean; preferences: Preferences; busy: boolean; ready: boolean; error: string; notice: string; enable: (preferences: Preferences) => Promise<void>; disable: () => Promise<void> };
const PushContext = createContext<PushContextValue | null>(null);
export const usePushNotifications = () => useContext(PushContext);

export function PushNotificationsProvider({ children }: PropsWithChildren) {
  const convex = useConvex(); const { isAuthenticated } = useConvexAuth(); const router = useRouter(); const navigation = useRootNavigationState();
  const account = useQuery(api.accounts.me, isAuthenticated ? {} : 'skip');
  const accountRef = useRef(account); accountRef.current = account;
  const register = useMutation(api.push.register); const unregister = useMutation(api.push.unregister);
  const [installation, setInstallation] = useState<string | null>(null);
  const device = useQuery(api.push.device, installation && account?.role ? { installationId: installation } : 'skip');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ id: string; recipientId: string } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  function serial<T>(run: () => Promise<T>): Promise<T> { const result = queue.current.then(run, run); queue.current = result.catch(() => undefined); return result; }
  useEffect(() => { let live = true; void installationId().then(id => { if (live) setInstallation(id); }).catch(() => { if (live) setError('Could not prepare notification settings. Restart the app and try again.'); }); return () => { live = false; }; }, []);
  async function enable(preferences: Preferences) {
    await serial(async () => {
      const current = accountRef.current;
      if (!current?.role || !installation) return;
      setBusy(true); setError(''); setNotice('');
      try {
        const token = await getPushToken(true);
        if (!token) throw new Error('Notifications are not permitted. Allow them in your phone settings, then try again.');
        if (accountRef.current?._id !== current._id) return;
        await register({ installationId: installation, token, platform: Platform.OS === 'ios' ? 'ios' : 'android', ...preferences });
        await saveBinding({ userId: current._id, ...preferences });
        setNotice('Push alerts enabled on this device.');
      } catch (err) { setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : err instanceof Error ? err.message : 'Could not enable notifications.'); }
      finally { setBusy(false); }
    });
  }
  async function disable() {
    await serial(async () => {
      setBusy(true); setError('');
      try {
        const deviceId = installation ?? await installationId();
        if (deviceId && accountRef.current?.role) await unregister({ installationId: deviceId });
        await saveBinding(null);
        if (pushSupported) { const n = await nativeNotifications(); await n.dismissAllNotificationsAsync().catch(() => undefined); await n.clearLastNotificationResponseAsync().catch(() => undefined); }
        setPending(null); setNotice('Push alerts are off on this device.');
      } finally { setBusy(false); }
    });
  }
  // Refresh an opted-in account's token on resume; never request permission automatically.
  useEffect(() => {
    if (!installation || !account?.role || !pushSupported) return;
    let live = true; const current = account;
    async function sync() {
      await serial(async () => {
        const stored = await binding();
        if (!live || !stored || stored.userId !== current._id) return;
        const token = await getPushToken(false);
        if (!live || accountRef.current?._id !== current._id) return;
        if (!token) { await unregister({ installationId: installation! }); await saveBinding(null); setNotice('Push alerts paused because notification permission is off.'); return; }
        await register({ installationId: installation!, token, platform: Platform.OS === 'ios' ? 'ios' : 'android', messages: stored.messages, updates: stored.updates });
      }).catch(() => { if (live) setNotice('Could not refresh push registration. Reopen notification settings when connected.'); });
    }
    void sync(); const sub = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    let tokenListener: { remove: () => void } | undefined;
    void nativeNotifications().then(n => { if (live) tokenListener = n.addPushTokenListener(() => { void sync(); }); }).catch(() => { if (live) setNotice('Rebuild Melange to enable notification support.'); });
    return () => { live = false; sub.remove(); tokenListener?.remove(); };
  }, [account?._id, account?.role, installation, register, unregister]);
  useEffect(() => {
    if (!pushSupported) return;
    let live = true; let listener: { remove: () => void } | undefined;
    void nativeNotifications().then(async n => {
      if (!live) return;
      n.setNotificationHandler({ handleNotification: async notification => {
        const show = !!accountRef.current && notification.request.content.data?.recipientId === accountRef.current._id;
        return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
      } });
      function handle(response: import('expo-notifications').NotificationResponse | null) {
        const data = response?.notification.request.content.data;
        if (live && typeof data?.notificationId === 'string' && typeof data.recipientId === 'string') setPending({ id: data.notificationId, recipientId: data.recipientId });
      }
      listener = n.addNotificationResponseReceivedListener(handle);
      handle(await n.getLastNotificationResponseAsync());
    }).catch(() => { if (live) setError('Notification support is unavailable in this build.'); });
    return () => { live = false; listener?.remove(); };
  }, []);
  useEffect(() => {
    if (!pending || !account?.role || !navigation?.key) return;
    let live = true; const current = account;
    async function open() {
      if (pending!.recipientId === current._id) {
        const target = await convex.query(api.push.target, { notificationId: pending!.id });
        if (!live || accountRef.current?._id !== current._id) return;
        if (target) {
          if (target.screen === 'share' && target.shareGroupId) router.push({ pathname: '/runner/share', params: { id: target.shareGroupId } });
          else if (target.screen === 'quotes') router.push('/runner/pricing');
          else if (target.role === 'runner') router.push({ pathname: target.screen === 'chat' ? '/runner/chat' : '/runner/errand', params: { id: target.errandId } });
          else router.push({ pathname: target.screen === 'chat' ? '/errands/chat' : '/errands/[id]', params: { id: target.errandId } });
        }
      }
      if (live) { setPending(null); await (await nativeNotifications()).clearLastNotificationResponseAsync(); }
    }
    void open().catch(() => { if (live) { setPending(null); setNotice('Could not open that alert. Find the errand in your dashboard.'); } });
    return () => { live = false; };
  }, [pending, account?._id, account?.role, navigation?.key, convex, router]);
  return <PushContext.Provider value={{ enabled: !!device, preferences: device ?? { messages: true, updates: true }, busy, ready: !!installation && !!account?.role && device !== undefined, error, notice, enable, disable }}>{children}</PushContext.Provider>;
}

export function NotificationSettings() {
  const push = usePushNotifications(); const [error, setError] = useState('');
  if (!push) return null;
  const set = (preferences: Preferences) => { void push.enable(preferences); };
  return <View style={ui.card}><Text style={ui.h2}>Push notifications</Text><Text style={ui.body}>Get alerts for messages, quotes, delivery updates, reviews and payment confirmations. Settings apply to this account on this device.</Text>
    {!pushSupported ? <Text style={ui.small}>Install a development build with push credentials to enable phone alerts. Expo Go and web do not receive these push notifications.</Text> : <>
      <Text accessibilityLiveRegion="polite" style={ui.h3}>{!push.ready ? 'Loading settings…' : push.enabled ? 'Enabled on this device' : 'Off on this device'}</Text>
      {push.enabled && <><View style={ui.between}><Text style={ui.body}>Messages and images</Text><Switch accessibilityLabel="Message notifications" disabled={push.busy} value={push.preferences.messages} onValueChange={messages => set({ ...push.preferences, messages })} /></View><View style={ui.between}><Text style={ui.body}>Errand and payment updates</Text><Switch accessibilityLabel="Errand update notifications" disabled={push.busy} value={push.preferences.updates} onValueChange={updates => set({ ...push.preferences, updates })} /></View></>}
      <CustomerButton disabled={push.busy || !push.ready} onPress={() => { setError(''); if (push.enabled) void push.disable().catch(() => setError('Could not turn off alerts. Reconnect and try again.')); else void push.enable(push.preferences); }}>{push.busy ? 'Saving…' : push.enabled ? 'Turn off push alerts' : 'Enable push alerts'}</CustomerButton>
      <CustomerButton onPress={() => { void Linking.openSettings().catch(() => setError('Open your phone settings manually.')); }}>Open phone notification settings</CustomerButton>
    </>}<FormError message={error || push.error} />{!!push.notice && <Text accessibilityLiveRegion="polite" style={ui.small}>{push.notice}</Text>}
  </View>;
}
