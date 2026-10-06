import { useConvexConnectionState, useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { CustomerButton, CustomerField, CustomerPage, FormError, palette, ui, useServices } from './customer-ui';

type Props = { errand: Doc<'errands'>; onClose: () => void; onSaved: () => void; onBusyChange: (busy: boolean) => void };
export function ErrandEditor({ errand, onClose, onSaved, onBusyChange }: Props) {
  const update = useMutation(api.errands.update);
  const { services } = useServices();
  const { isWebSocketConnected } = useConvexConnectionState();
  const [revision] = useState(errand.revision ?? 0);
  const [draft, setDraft] = useState({ title: errand.title, description: errand.description, category: errand.category, pickup: errand.pickup, dropoff: errand.dropoff, budget: (errand.budgetPesewas / 100).toFixed(2), urgency: errand.urgency });
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const stale = revision !== (errand.revision ?? 0) || errand.status !== 'posted' || !!errand.runnerId;
  function prepare() {
    setError('');
    if (draft.title.trim().length < 3 || draft.pickup.trim().length < 3 || draft.dropoff.trim().length < 3) return setError('Enter a title and both addresses, each at least 3 characters.');
    if (!/^\d+(\.\d{1,2})?$/.test(draft.budget.trim()) || Number(draft.budget) < (errand.budgetPurpose === 'items' ? 0 : 1) || Number(draft.budget) > 10000) return setError('Enter a valid budget up to GH₵10,000 with up to two decimal places.');
    setReview(true);
  }
  async function save() {
    if (locked.current) return;
    locked.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      await update({ id: errand._id, expectedRevision: revision, budgetPurpose: errand.budgetPurpose, title: draft.title, description: draft.description, category: draft.category, pickup: draft.pickup, dropoff: draft.dropoff, urgency: draft.urgency, budgetPesewas: Math.round(Number(draft.budget) * 100) });
      onSaved();
    } catch (err) { setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not save your changes. Please try again.'); }
    finally { locked.current = false; setBusy(false); onBusyChange(false); }
  }
  const choices = [{ id: 'low', label: 'Whenever' }, { id: 'normal', label: 'Today' }, { id: 'express', label: 'ASAP' }] as const;
  return <CustomerPage><Text style={ui.eyebrow}>{review ? 'ONE LAST LOOK' : 'MAKE A CHANGE'}</Text><Text style={ui.title}>{review ? 'Review your changes' : 'Edit errand'}</Text>
    {stale && !busy && <FormError message="This request changed while you were editing. Close this form and reopen it to see the latest details." />}
    {review ? <View style={ui.card}>
      <Text style={ui.h2}>{draft.title.trim()}</Text><Text style={ui.body}>{services?.find((service) => service.id === draft.category)?.name ?? draft.category}</Text>
      <Text style={ui.h3}>Pickup</Text><Text style={ui.body}>{draft.pickup.trim()}</Text><Text style={ui.h3}>Delivery</Text><Text style={ui.body}>{draft.dropoff.trim()}</Text>
      <Text style={ui.h3}>Instructions</Text><Text style={ui.body}>{draft.description.trim() || 'No extra instructions.'}</Text>
      <Text style={ui.h2}>GH₵{Number(draft.budget).toFixed(2)}</Text><Text style={ui.body}>When: {choices.find((item) => item.id === draft.urgency)?.label}</Text>
    </View> : <>
      <CustomerField label="What do you need?" value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} maxLength={100} />
      <Text style={ui.h3}>Service</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{services?.map((service) => <Pressable key={service.id} accessibilityRole="button" accessibilityState={{ selected: draft.category === service.id }} onPress={() => setDraft({ ...draft, category: service.id as typeof draft.category })} style={[ui.badge, { padding: 13, backgroundColor: draft.category === service.id ? palette.green : palette.pale }]}><Text style={[ui.h3, { color: draft.category === service.id ? '#FFFFFF' : palette.ink }]}>{service.name}</Text></Pressable>)}</View>
      <CustomerField label="Details (optional)" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} multiline maxLength={2000} />
      <CustomerField label="Pickup address" value={draft.pickup} onChangeText={(pickup) => setDraft({ ...draft, pickup })} maxLength={300} />
      <CustomerField label="Delivery address" value={draft.dropoff} onChangeText={(dropoff) => setDraft({ ...draft, dropoff })} maxLength={300} hint="Editing this errand does not change the default address in Settings." />
      <CustomerField label={errand.budgetPurpose === 'items' ? 'Item budget (GH₵)' : 'Original proposed budget (GH₵)'} value={draft.budget} onChangeText={(budget) => setDraft({ ...draft, budget })} keyboardType="decimal-pad" maxLength={8} />
      <Text style={ui.h3}>When do you need it?</Text><View style={ui.row}>{choices.map((item) => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: draft.urgency === item.id }} onPress={() => setDraft({ ...draft, urgency: item.id })} style={[ui.badge, { flex: 1, padding: 13, backgroundColor: draft.urgency === item.id ? palette.green : palette.pale }]}><Text style={[ui.h3, { textAlign: 'center', color: draft.urgency === item.id ? '#FFFFFF' : palette.ink }]}>{item.label}</Text></Pressable>)}</View>
    </>}
    <FormError message={error} />
    {!isWebSocketConnected && <Text style={ui.body}>{busy ? 'Reconnecting… your save will finish when the connection returns.' : 'You can edit offline. Reconnect to save your changes.'}</Text>}
    {review ? <><CustomerButton disabled={busy || stale || !isWebSocketConnected} onPress={() => void save()}>{busy ? 'Saving changes…' : 'Confirm & save changes'}</CustomerButton><CustomerButton disabled={busy} onPress={() => setReview(false)}>Back to editing</CustomerButton></> : <CustomerButton disabled={stale} onPress={prepare}>Review changes →</CustomerButton>}
    <CustomerButton disabled={busy} onPress={onClose}>Discard edits & close</CustomerButton>
  </CustomerPage>;
}
