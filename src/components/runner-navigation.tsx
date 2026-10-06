import { useQuery } from 'convex/react';
import * as Linking from 'expo-linking';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Id } from '../../convex/_generated/dataModel';
import { navigationDestination } from '@/lib/errand-destinations';
import { api } from '../../convex/_generated/api';
import { directionsUrl, nextRunnerStop, travelModeFor, type TravelMode } from '@/lib/runner-navigation';
import { CustomerButton, FormError, palette, ui } from './customer-ui';

const modes: { id: TravelMode; label: string }[] = [
  { id: 'walking', label: 'Walk' }, { id: 'bicycling', label: 'Cycle' }, { id: 'two-wheeler', label: 'Motorbike' }, { id: 'driving', label: 'Drive' },
];

export function RunnerNavigation({ pickup, dropoff, status, id }: { pickup: string; dropoff: string; status: string; id?: Id<'errands'> }) {
  const saved = useQuery(api.errands.destinations, id ? { id } : 'skip');
  const pickupTarget = navigationDestination(pickup, saved?.pickupPoint);
  const dropoffTarget = navigationDestination(dropoff, saved?.dropoffPoint);
  const profile = useQuery(api.runners.profile, {});
  const [selected, setSelected] = useState<TravelMode>();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const locked = useRef(false);
  const mode = selected ?? travelModeFor(profile?.transport);
  const next = nextRunnerStop(status);
  async function open(destination: string, origin?: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await Linking.openURL(directionsUrl(destination, mode, origin)); }
    catch (err) { setError(err instanceof Error && err.message.includes('address') ? err.message : 'Could not open Google Maps. Try again or search for the address in your maps app.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <View style={ui.card}>
    <Text style={ui.h2}>{next ? 'Your next stop' : 'Plan this route'}</Text>
    {next && <><Text style={ui.eyebrow}>{next === 'pickup' ? 'PICKUP' : 'DELIVERY'}</Text><Text selectable style={ui.body}>{next === 'pickup' ? pickup : dropoff}</Text></>}
    <Text style={ui.small}>Travel mode</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{modes.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: mode === item.id, disabled: busy }} disabled={busy} onPress={() => setSelected(item.id)} style={[ui.badge, { minHeight: 44, justifyContent: 'center', backgroundColor: mode === item.id ? palette.green : palette.pale }]}><Text style={[ui.h3, mode === item.id && { color: '#FFFFFF' }]}>{item.label}</Text></Pressable>)}</View>
    {next && <CustomerButton disabled={busy || profile === undefined || (!!id && saved === undefined)} onPress={() => void open(next === 'pickup' ? pickupTarget : dropoffTarget)}>Directions to {next === 'pickup' ? 'pickup' : 'delivery'}</CustomerButton>}
    {!next && <CustomerButton disabled={busy || profile === undefined || (!!id && saved === undefined)} onPress={() => void open(pickupTarget)}>Directions to pickup</CustomerButton>}
    <CustomerButton disabled={busy || profile === undefined || (!!id && saved === undefined)} onPress={() => void open(dropoffTarget, pickupTarget)}>Preview pickup → delivery route</CustomerButton>
    <Text style={ui.small}>Opens Google Maps using saved destination pins when available, or the buyer’s written addresses. Check the destination before starting. Maps supplies directions and travel estimates; opening it does not change the errand’s status.</Text>
    {(mode === 'two-wheeler' || mode === 'bicycling') && <Text style={ui.small}>If Maps cannot offer this mode in your area, choose another travel mode.</Text>}
    {!!next && <Text style={ui.small}>In Expo Go, live location sharing pauses while you use another app. Return to Melange to resume sharing and update the job.</Text>}
    <FormError message={error} />
  </View>;
}
