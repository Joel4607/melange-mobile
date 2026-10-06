import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import type { FunctionReturnType } from 'convex/server';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import { CustomerButton, CustomerField, CustomerPage, FormError, palette, ui } from './customer-ui';
import { runnerServiceOptions, transportOptions } from '@/lib/runner-profile-options';
import { AccountSignOut } from './account-role';
import { RunnerPhotoEditor } from './runner-photo';

type Profile = NonNullable<FunctionReturnType<typeof api.runners.profile>>;

export function RunnerOnboarding({ editing = false }: { editing?: boolean }) {
  const profile = useQuery(api.runners.profile, {});
  if (profile === undefined) return <CustomerPage><ActivityIndicator color={palette.green} /><Text style={ui.body}>Loading your runner details…</Text></CustomerPage>;
  return <ProfileForm initial={profile} editing={editing} />;
}

function ProfileForm({ initial, editing }: { initial: Profile | null; editing: boolean }) {
  const router = useRouter();
  const register = useMutation(api.runners.register);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [area, setArea] = useState(initial?.area ?? '');
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [transport, setTransport] = useState<Profile['transport']>(initial?.transport ?? 'walking');
  const [services, setServices] = useState<Profile['services']>(initial?.services ?? ['delivery']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  async function submit() {
    if (locked.current || !isWebSocketConnected) return;
    if (!/^\+?[0-9]{9,15}$/.test(phone.trim().replace(/[\s()-]/g, ''))) return setError('Enter a phone number with 9–15 digits.');
    if (area.trim().length < 2) return setError('Enter the neighbourhood or town where you want to work.');
    if (services.length === 0) return setError('Choose at least one service.');
    locked.current = true; setBusy(true); setError('');
    try {
      await register({ phone, area, transport, services, bio });
      router.replace('/runner');
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not save your runner profile. Please try again.');
    } finally { locked.current = false; setBusy(false); }
  }

  return <CustomerPage>
    {editing && <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.replace('/runner')} style={{ paddingVertical: 10 }}><Text style={ui.h3}>← Dashboard</Text></Pressable>}
    <View style={{ gap: 8 }}><Text style={ui.eyebrow}>{editing ? 'YOUR RUNNER PROFILE' : 'BECOME A RUNNER · STEP 2 OF 2'}</Text><Text style={ui.title}>{editing ? 'Make it yours.' : 'Your next chapter starts here.'}</Text><Text style={ui.body}>{editing ? 'Keep your working area and services up to date.' : 'Tell us where and how you’d like to help. Save your details and head straight to your runner dashboard.'}</Text></View>
    <View style={ui.card}>
      <CustomerField label="Short introduction" value={bio} onChangeText={setBio} placeholder="Tell buyers about the errands you enjoy helping with." hint={`${bio.length}/300 · visible to buyers with your quotes`} multiline maxLength={300} editable={!busy} />
      <CustomerField label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="024 123 4567" maxLength={24} editable={!busy} />
      <CustomerField label="Your working area" value={area} onChangeText={setArea} placeholder="e.g. Osu, Accra" hint="Enter your neighbourhood or town." maxLength={100} editable={!busy} />
    </View>
    <View style={{ gap: 12 }}><Text style={ui.h2}>How will you get around?</Text><View style={styles.options}>
      {transportOptions.map(option => <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ checked: transport === option.id, disabled: busy }} disabled={busy} onPress={() => setTransport(option.id)} style={[styles.transport, transport === option.id && styles.selected]}><Text style={{ fontSize: 25 }}>{option.icon}</Text><Text style={ui.h3}>{option.label}</Text></Pressable>)}
    </View></View>
    <View style={{ gap: 12 }}><Text style={ui.h2}>What can you help with?</Text><Text style={ui.small}>Choose one or more services.</Text><View style={styles.options}>
      {runnerServiceOptions.map(option => <Pressable key={option.id} accessibilityRole="checkbox" accessibilityState={{ checked: services.includes(option.id), disabled: busy }} disabled={busy} onPress={() => setServices(current => current.includes(option.id) ? current.filter(id => id !== option.id) : [...current, option.id])} style={[styles.chip, services.includes(option.id) && styles.selected]}><Text style={ui.h3}>{services.includes(option.id) ? '✓  ' : '+  '}{option.label}</Text></Pressable>)}
    </View></View>
    <FormError message={error} />
    {!isWebSocketConnected && <Text accessibilityLiveRegion="polite" style={ui.body}>{busy ? 'Reconnecting… your profile will save when the connection returns.' : 'Connect to the internet to save your runner profile.'}</Text>}
    <CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void submit()}>{busy ? 'Saving your profile…' : editing ? 'Save runner profile' : 'Start as a runner →'}</CustomerButton>
    {editing && initial && <RunnerPhotoEditor photoUrl={initial.photoUrl} photoId={initial.photoId} />}
    {!editing && <><Text style={ui.small}>Your details stay saved with your runner account.</Text><AccountSignOut /></>}
  </CustomerPage>;
}

const styles = StyleSheet.create({
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  transport: { width: '46%', flexGrow: 1, minHeight: 95, borderWidth: 1, borderColor: palette.line, borderRadius: 18, backgroundColor: '#FFFFFF', padding: 16, gap: 8 },
  chip: { padding: 14, minHeight: 48, borderWidth: 1, borderColor: palette.line, borderRadius: 16, backgroundColor: '#FFFFFF' },
  selected: { backgroundColor: palette.pale, borderColor: palette.green },
});
