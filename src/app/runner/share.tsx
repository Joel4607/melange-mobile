import { PickupApproval } from '@/components/pickup-approval';
import { useMutation, useQuery, useConvexConnectionState } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { CustomerButton, CustomerField, CustomerPage, FormError, ui } from '@/components/customer-ui';
import { RunnerLocationControls } from '@/components/runner-location-sharing';
import { shareError } from '@/components/errand-share';
import ShareMap from '@/components/share-map';
import { directionsUrl, travelModeFor } from '@/lib/runner-navigation';
import { DeliveryMeetingMap } from '@/components/delivery-meeting-map';

export default function SharedRun() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SharedRunContent key={id} id={id as Id<'shareGroups'>} />;
}
function SharedRunContent({ id }: { id: Id<'shareGroups'> }) {
  const data = useQuery(api.share.runner, { id }); const profile = useQuery(api.runners.profile, {});
  const quote = useMutation(api.share.quote); const router = useRouter();
  const withdraw = useMutation(api.share.withdraw);
  const [fees, setFees] = useState(['', '']); const [note, setNote] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const { isWebSocketConnected } = useConvexConnectionState();
  async function send() {
    if (!data || busy) return; setBusy(true); setError('');
    try {
      if (fees.some(f => !/^\d+(\.\d{1,2})?$/.test(f.trim()))) throw new Error('Enter both service fees, with at most two decimal places.');
      await quote({ groupId: id, fees: fees.map(f => Math.round(Number(f) * 100)), note, expectedVersion: data.offer?.version ?? 0 });
    } catch (e) { setError(shareError(e)); } finally { setBusy(false); }
  }
  const back = <CustomerButton onPress={() => router.replace('/runner')}>← Runner dashboard</CustomerButton>;
  if (!data) return <CustomerPage>{back}<Text style={ui.title}>{data === undefined ? 'Loading shared route…' : 'Shared run unavailable'}</Text></CustomerPage>;
  const { group, errands, offer } = data; const next = group.route[group.nextStop];
  return <CustomerPage>{back}<Text style={ui.eyebrow}>ERRAND SHARE</Text><Text style={ui.title}>Two errands. One route.</Text><Text style={ui.h3}>{group.status.toUpperCase()} · {group.nextStop}/4 stops completed</Text>
    <ShareMap points={group.route.map((s, i) => ({ ...s.point, label: `${i + 1}. ${s.kind} · ${errands.find(e => e.id === s.errandId)?.title}` }))} />
    <Text style={ui.small}>Lines connect confirmed pins; they are not road directions. Estimated route: {group.sharedKm.toFixed(2)} km, saving {group.savedKm.toFixed(2)} km against separate direct trips. Open Maps for actual navigation.</Text>
    {group.status === 'reserved' && <View style={ui.card}><Text style={ui.h2}>One buyer approved</Text><Text style={ui.body}>Do not start yet. The other buyer must approve by {new Date(group.expiresAt).toLocaleTimeString()}. Your fees are locked during this reservation.</Text></View>}
    {group.route.map((s, i) => { const e = errands.find(e => e.id === s.errandId)!; return <View key={`${s.errandId}:${s.kind}`} style={ui.card}><Text style={ui.h3}>{i < group.nextStop ? '✓' : i + 1}. {s.kind === 'pickup' ? 'Pick up' : 'Deliver'} · {e.title}{i === group.nextStop && group.status === 'active' ? ' · NEXT' : ''}</Text><Text style={ui.body}>{s.kind === 'pickup' ? e.pickup : e.dropoff}</Text>
      {group.status === 'active' && i === group.nextStop && <><CustomerButton onPress={() => void Linking.openURL(directionsUrl(`${s.point.lat},${s.point.lng}`, travelModeFor(profile?.transport))).catch(e => setError(shareError(e)))}>Navigate to this stop</CustomerButton><CustomerButton onPress={() => router.push({ pathname: '/runner/errand', params: { id: e.id } })}>{s.kind === 'pickup' ? 'Open errand for collection' : 'Open errand & add handover photo'}</CustomerButton></>}
    </View>; })}
    {group.status === 'active' && next?.kind === 'pickup' && <SharedPickup id={next.errandId} />}
    {group.status === 'active' && next && <RunnerLocationControls errandId={group.errandIds[0]} shared />}
    {group.status === 'active' && next && <DeliveryMeetingMap key={next.errandId} id={next.errandId} />}
    {errands.map((e, i) => <View key={e.id} style={ui.card}><Text style={ui.h2}>{e.title}</Text><Text style={ui.body}>{e.description || 'No extra instructions.'}</Text><Text style={ui.small}>{e.category} · Item/proposed budget GH₵{(e.budgetPesewas / 100).toFixed(2)} · {e.status.replace('_', ' ')}</Text>
      {offer && <Text style={ui.h3}>Your fee: GH₵{(offer.fees[i] / 100).toFixed(2)}</Text>}
      {['active', 'delivered'].includes(group.status) && <CustomerButton onPress={() => router.push({ pathname: '/runner/errand', params: { id: e.id } })}>Open this buyer’s errand</CustomerButton>}
    </View>)}
    {group.status === 'open' && <View style={ui.card}><Text style={ui.h2}>{offer ? 'Update your shared offer' : 'Quote for both errands'}</Text><Text style={ui.body}>Both buyers must approve their individual fee before assignment. Payments are arranged separately with each buyer.</Text>{errands.map((e, i) => <CustomerField key={e.id} label={`${e.title} · fee (GH₵)`} value={fees[i]} onChangeText={text => setFees(old => old.map((f, j) => i === j ? text : f))} keyboardType="decimal-pad" />)}<CustomerField label="Price explanation for both buyers" value={note} onChangeText={setNote} maxLength={500} multiline /><CustomerButton disabled={busy || !data.canQuote || !isWebSocketConnected} onPress={() => void send()}>{busy ? 'Saving…' : 'Send both fees'}</CustomerButton>{offer && <Text style={ui.small}>Your offer is saved. Waiting for buyer approvals.</Text>}{!data.canQuote && <Text style={ui.small}>Finish your current run or reservation before sending an offer.</Text>}</View>}
    {offer && ['open', 'reserved'].includes(group.status) && <CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => { setBusy(true); setError(''); void withdraw({ offerId: offer._id, expectedVersion: offer.version }).catch(e => setError(shareError(e))).finally(() => setBusy(false)); }}>Withdraw my shared offer</CustomerButton>}
    {group.status === 'delivered' && <Text style={ui.body}>Both deliveries are reported. Each buyer confirms completion and reviews you independently.</Text>}<FormError message={error} />
  </CustomerPage>;
}

function SharedPickup({ id }: { id: Id<'errands'> }) {
  const errand = useQuery(api.runnerJobs.get, { id });
  return errand?.assignedToMe && errand.trackingRequired && errand.status === 'accepted' ? <PickupApproval id={id} revision={errand.revision} runner /> : null;
}
