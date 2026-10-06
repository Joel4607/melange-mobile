import { usePushNotifications } from './push-notifications';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import { stopRunnerBackground } from '@/lib/runner-background';
import { CustomerButton, CustomerPage, FormError, palette, ui } from './customer-ui';

export function useAccountRole() {
  const auth = useConvexAuth();
  const account = useQuery(api.accounts.me, auth.isAuthenticated ? {} : 'skip');
  return { ...auth, account, loading: auth.isLoading || (auth.isAuthenticated && account === undefined) };
}

export function AccountLoading() {
  return <CustomerPage><ActivityIndicator color={palette.green} /><Text style={ui.body}>Opening your workspace…</Text></CustomerPage>;
}

export function RoleOptions({ value, onChange, disabled = false }: { value: 'buyer' | 'runner'; onChange: (role: 'buyer' | 'runner') => void; disabled?: boolean }) {
  return <View style={{ gap: 10 }}><Text style={ui.h3}>I want to join as a…</Text>{([
    ['buyer', 'Buyer', 'Post errands and get help with your day.'],
    ['runner', 'Runner', 'Carry out errands and manage your deliveries.'],
  ] as const).map(([role, title, detail]) => <Pressable key={role} accessibilityRole="radio" accessibilityState={{ checked: value === role, disabled }} disabled={disabled} onPress={() => onChange(role)} style={[ui.card, { padding: 15, borderColor: value === role ? palette.green : palette.line, backgroundColor: value === role ? palette.pale : '#FFFFFF', gap: 4 }]}><Text style={ui.h3}>{value === role ? '●' : '○'}  {title}</Text><Text style={ui.small}>{detail}</Text></Pressable>)}</View>;
}

export function ChooseAccountRole() {
  const [role, setRole] = useState<'buyer' | 'runner'>('buyer');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const choose = useMutation(api.accounts.chooseRole);
  const { isWebSocketConnected } = useConvexConnectionState();
  async function save() {
    if (locked.current || !isWebSocketConnected) return;
    locked.current = true; setBusy(true); setError('');
    try { await choose({ role }); } catch { setError('Could not save your role. Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <CustomerPage><Text style={ui.eyebrow}>YOUR MELANGE ACCOUNT</Text><Text style={ui.title}>Choose your workspace.</Text><Text style={ui.body}>Your account was created before role selection. Choose its role once, and we’ll open the right dashboard whenever you sign in.</Text><RoleOptions value={role} onChange={setRole} disabled={busy} /><FormError message={error} /><CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void save()}>{busy ? 'Saving…' : `Continue as ${role === 'buyer' ? 'Buyer' : 'Runner'}`}</CustomerButton><AccountSignOut /></CustomerPage>;
}

export function AccountSignOut() {
  const push = usePushNotifications();
  const { signOut } = useAuthActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  async function logout() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await push?.disable(); await stopRunnerBackground(); await signOut(); } catch { setError('Could not sign out. Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <View style={{ gap: 8 }}><FormError message={error} /><CustomerButton disabled={busy} onPress={() => void logout()}>{busy ? 'Signing out…' : 'Sign out'}</CustomerButton></View>;
}
