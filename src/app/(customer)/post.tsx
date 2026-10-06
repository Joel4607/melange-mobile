import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import type { FunctionArgs } from 'convex/server';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { RequireCustomer } from '@/components/customer-auth';
import { CustomerButton, CustomerField, CustomerPage, FormError, palette, ServiceLoading, ui, useServices } from '@/components/customer-ui';

type Submission = FunctionArgs<typeof api.errands.create>;
const urgencies = [{ id: 'low', label: 'Whenever' }, { id: 'normal', label: 'Today' }, { id: 'express', label: 'ASAP' }] as const;
const reference = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function PostScreen() { return <RequireCustomer><PostForm /></RequireCustomer>; }
function PostForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string }>();
  const { services, slow } = useServices();
  const { isWebSocketConnected } = useConvexConnectionState();
  const create = useMutation(api.errands.create);
  const preferences = useQuery(api.customers.preferences);
  const addressEdited = useRef(false);
  const [category, setCategory] = useState<Submission['category']>('groceries');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [budget, setBudget] = useState('');
  const [urgency, setUrgency] = useState<Submission['urgency']>('normal');
  const [review, setReview] = useState<Submission | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(reference());
  const locked = useRef(false);
  useEffect(() => {
    if (preferences && !addressEdited.current && !review && !saved) setDropoff(preferences.deliveryAddress);
  }, [preferences, review, saved]);
  useEffect(() => {
    if (params.category && ['groceries', 'food', 'pharmacy', 'delivery', 'market', 'other'].includes(params.category)) setCategory(params.category as Submission['category']);
  }, [params.category]);

  function prepare() {
    setError('');
    if (title.trim().length < 3) return setError('Give your errand a title of at least 3 characters.');
    if (pickup.trim().length < 3 || dropoff.trim().length < 3) return setError('Enter both pickup and delivery addresses.');
    const amount = budget.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) < 0 || Number(amount) > 10000) return setError('Enter a item budget from GH₵0 to GH₵10,000, with up to two decimal places.');
    setReview({ title: title.trim(), description: description.trim(), category, pickup: pickup.trim(), dropoff: dropoff.trim(), budgetPesewas: Math.round(Number(amount) * 100), budgetPurpose: 'items', urgency, requestId: requestId.current });
  }
  async function submit() {
    if (!review || locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { setSaved(await create(review)); }
    catch (err) { setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not save your errand. Check your connection and try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  function reset() {
    setTitle(''); setDescription(''); setPickup(''); setDropoff(preferences?.deliveryAddress ?? ''); setBudget(''); setUrgency('normal');
    addressEdited.current = false;
    setSaved(null); setReview(null); setError(''); requestId.current = reference();
  }

  if (saved) return <CustomerPage><Text style={ui.eyebrow}>ALL SAVED</Text><Text style={ui.title}>Your errand is posted.</Text><View style={ui.card}><Text style={ui.h2}>{review?.title}</Text><Text style={ui.body}>You can find this request in My errands, even after signing out and back in.</Text><Text style={ui.small}>No runner has been assigned and no payment has been taken.</Text></View><CustomerButton onPress={() => { reset(); router.navigate('/errands'); }}>View my errands →</CustomerButton><CustomerButton onPress={reset}>Post another errand</CustomerButton></CustomerPage>;

  if (review) return <CustomerPage><Text style={ui.eyebrow}>ONE LAST LOOK</Text><Text style={ui.title}>Review your errand</Text><View style={ui.card}>
    <Text style={ui.h2}>{review.title}</Text><Text style={ui.body}>{services?.find((s) => s.id === review.category)?.name}</Text>
    {review.description ? <Text style={ui.body}>{review.description}</Text> : null}
    <Text style={ui.h3}>Pickup</Text><Text style={ui.body}>{review.pickup}</Text><Text style={ui.h3}>Delivery</Text><Text style={ui.body}>{review.dropoff}</Text>
    <View style={ui.between}><Text style={ui.h3}>Item budget</Text><Text style={ui.h2}>GH₵{(review.budgetPesewas / 100).toFixed(2)}</Text></View>
    <Text style={ui.body}>When: {urgencies.find((u) => u.id === review.urgency)?.label}</Text>
  </View><Text style={ui.small}>This is your item budget. Runners quote their service fee separately, and you approve a quote before anyone starts. Payments are arranged directly with your runner.</Text><FormError message={error} />
    {!isWebSocketConnected && <Text accessibilityLiveRegion="polite" style={ui.body}>{busy ? 'Reconnecting… your submission will continue when online. Please keep this screen open.' : 'Waiting for a connection before posting.'}</Text>}
    <CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void submit()}>{busy ? 'Saving your errand…' : 'Confirm & post errand'}</CustomerButton>
    <CustomerButton disabled={busy} onPress={() => { setReview(null); setError(''); }}>Edit details</CustomerButton>
  </CustomerPage>;

  return <CustomerPage><Text style={ui.eyebrow}>LET’S TAKE IT OFF YOUR LIST</Text><Text style={ui.title}>Post an errand</Text><Text style={ui.body}>Tell us what you need and where it should go.</Text>
    <Text style={ui.h3}>Choose a service</Text>
    {services === undefined ? <ServiceLoading slow={slow} /> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{services.map((service) => <Pressable key={service.id} accessibilityRole="button" accessibilityState={{ selected: category === service.id }} onPress={() => setCategory(service.id as Submission['category'])} style={[ui.badge, { padding: 13, backgroundColor: category === service.id ? palette.green : '#FFFFFF', borderWidth: 1, borderColor: palette.line }]}><Text style={[ui.h3, { color: category === service.id ? '#FFFFFF' : palette.ink }]}>{service.icon} {service.name}</Text></Pressable>)}</View>}
    <CustomerField label="What do you need?" value={title} onChangeText={setTitle} maxLength={100} placeholder="Pick up my groceries" />
    <CustomerField label="Details (optional)" value={description} onChangeText={setDescription} maxLength={2000} multiline placeholder="Your list, instructions, or useful details" />
    <CustomerField label="Pickup address" value={pickup} onChangeText={setPickup} maxLength={300} placeholder="Shop, street, neighbourhood and landmark" />
    <CustomerField label="Delivery address" value={dropoff} onChangeText={(value) => { addressEdited.current = true; setDropoff(value); }} maxLength={300} placeholder="Where should your items arrive?" hint={preferences?.deliveryAddress ? 'Your saved address is available. You can use a different address for this errand.' : undefined} />
    <CustomerField label="Item budget (GH₵)" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" maxLength={8} placeholder="50.00" hint="For purchases only, excluding the runner’s fee. Enter 0 if no items need buying." />
    <Text style={ui.h3}>When do you need it?</Text><View style={ui.row}>{urgencies.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: urgency === item.id }} onPress={() => setUrgency(item.id)} style={[ui.badge, { flex: 1, padding: 14, backgroundColor: urgency === item.id ? palette.green : palette.pale }]}><Text style={[ui.h3, { textAlign: 'center', color: urgency === item.id ? '#FFFFFF' : palette.ink }]}>{item.label}</Text></Pressable>)}</View>
    <FormError message={error} /><CustomerButton disabled={!services} onPress={prepare}>Review errand →</CustomerButton>
  </CustomerPage>;
}
