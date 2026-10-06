import { NotificationSettings } from '@/components/push-notifications';
import { RunnerAvatar } from '@/components/runner-photo';
import { OwnRunnerTrust } from '@/components/runner-trust';
import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../../../convex/_generated/api';
import { AccountSignOut } from '@/components/account-role';
import { CustomerButton, CustomerField, CustomerPage, FormError, palette, ui } from '@/components/customer-ui';
import { transportOptions, runnerServiceOptions } from '@/lib/runner-profile-options';

export default function RunnerSettings() {
  const router = useRouter();
  const account = useQuery(api.accounts.me, {});
  const profile = useQuery(api.runners.profile, {});
  const updateName = useMutation(api.customers.updateName);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const locked = useRef(false);
  async function saveName() {
    if (locked.current || !isWebSocketConnected) return;
    if (name.trim().length < 2) return setError('Enter a name of 2–80 characters.');
    locked.current = true; setBusy(true); setError('');
    try { await updateName({ name }); setEditing(false); setNotice('Your name has been updated.'); }
    catch (err) { setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not save your name. Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <CustomerPage>
    <View style={{ gap: 6 }}><Text style={ui.eyebrow}>YOUR RUNNER ACCOUNT</Text><Text style={ui.title}>Settings</Text><Text style={ui.body}>Your profile, your working area, your preferences.</Text></View>
    <View style={[ui.card, { backgroundColor: palette.pale }]}><RunnerAvatar url={profile?.photoUrl} name={account?.name || 'Runner'} /><Text style={ui.h2}>{account?.name || 'Your account'}</Text><Text style={ui.body}>{account?.email}</Text>{!!profile?.bio && <Text style={ui.body}>{profile.bio}</Text>}<Text style={ui.badgeText}>RUNNER ACCOUNT</Text></View>
    {notice ? <Text accessibilityLiveRegion="polite" style={ui.body}>{notice}</Text> : null}
    <View style={ui.card}><Text style={ui.h2}>Personal details</Text>{editing ? <>
      <CustomerField label="Your name" value={name} onChangeText={setName} editable={!busy} maxLength={80} autoComplete="name" />
      <FormError message={error} /><CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void saveName()}>{busy ? 'Saving…' : 'Save name'}</CustomerButton><CustomerButton disabled={busy} onPress={() => { setEditing(false); setError(''); }}>Cancel</CustomerButton>
    </> : <><Text style={ui.body}>{account?.name}</Text><CustomerButton disabled={!account} onPress={() => { setName(account?.name ?? ''); setEditing(true); setError(''); setNotice(''); }}>Edit name</CustomerButton></>}
    <Text style={ui.small}>Sign-in email: {account?.email}. Email changes and password recovery are not available in this prototype.</Text></View>
    <View style={ui.card}><Text style={ui.h2}>Runner details</Text><Text style={ui.body}>Phone: {profile?.phone || 'Loading…'}</Text><Text style={ui.body}>Working area: {profile?.area || 'Loading…'}</Text><Text style={ui.body}>Transport: {transportOptions.find(item => item.id === profile?.transport)?.label || 'Loading…'}</Text><Text style={ui.small}>{profile?.services.map(id => runnerServiceOptions.find(item => item.id === id)?.label).join(' · ')}</Text><CustomerButton onPress={() => router.push('/runner/profile')}>Edit runner details</CustomerButton></View>
    <View style={ui.card}><Text style={ui.h2}>Pricing & payments</Text><CustomerButton onPress={() => router.push('/runner/pricing')}>My pricing & quotes</CustomerButton><CustomerButton onPress={() => router.push('/runner/earnings')}>Job earnings history</CustomerButton><Text style={ui.h2}>Runner guidance</Text><Text style={ui.body}>Your dashboard brings together assigned errands, pickup and delivery details, customer conversations and recent feedback.</Text><Text style={ui.body}>Completing your profile doesn’t make you visible on the live map. Use Find errands to browse requests and submit a service fee. Buyer approval assigns the job; you can have one active job at a time. Open your active errand to confirm pickup, share GPS with its buyer and report delivery. Enable background sharing in a development build to request updates while the screen is locked. Expo Go sharing pauses outside the app. Save a handover photo before reporting delivery.</Text><Text style={ui.small}>Errand budgets are not payouts. Payments are not collected in this prototype.</Text></View>
    <NotificationSettings />
    <OwnRunnerTrust />
    {signingOut ? <View style={ui.card}><Text style={ui.h3}>Sign out of your runner account?</Text><Text style={ui.body}>Your profile and errands stay saved. Use your runner email to return.</Text><AccountSignOut /><CustomerButton onPress={() => setSigningOut(false)}>Stay signed in</CustomerButton></View> : <Pressable accessibilityRole="button" onPress={() => setSigningOut(true)} style={[ui.button, { backgroundColor: '#F8EAE3' }]}><Text style={[ui.buttonText, { color: '#A64430' }]}>Sign out</Text></Pressable>}
  </CustomerPage>;
}
