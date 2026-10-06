import { useMutation, useQuery, useConvexConnectionState } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import type { GeoPoint } from '../../convex/lib/shareGeo';
import { CustomerButton, CustomerField, FormError, ui } from './customer-ui';
import { TrustSummary } from './runner-trust';
import { PinPicker } from './destination-pin-picker';

export function shareError(e: unknown) { return e instanceof ConvexError ? String(e.data) : e instanceof Error ? e.message : 'Could not save. Please try again.'; }
export function BuyerShare({ errand }: { errand: Doc<'errands'> }) {
  const data = useQuery(api.share.buyer, { id: errand._id });
  const join = useMutation(api.share.join); const leave = useMutation(api.share.leave); const approve = useMutation(api.share.approve);
  const [pickup, setPickup] = useState<GeoPoint | undefined>(errand.sharePickup); const [dropoff, setDropoff] = useState<GeoPoint | undefined>(errand.shareDropoff);
  const [open, setOpen] = useState(false); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const { isWebSocketConnected } = useConvexConnectionState();
  async function act(fn: () => Promise<unknown>) { if (busy) return; setBusy(true); setError(''); try { await fn(); setConfirm(''); setOpen(false); } catch (e) { setError(shareError(e)); } finally { setBusy(false); } }
  if (errand.trackingMode || errand.status === 'cancelled' || (!errand.shareGroupId && (errand.urgency === 'express' || errand.status !== 'posted'))) return null;
  const disabled = busy || !isWebSocketConnected; const grouped = data?.group;
  return <View style={ui.card}><Text style={ui.eyebrow}>TWO ERRANDS · ONE RUNNER</Text><Text style={ui.h2}>Errand Share</Text>
    {!data ? <Text style={ui.body}>Loading shared route…</Text> : grouped ? <>
      <Text style={ui.h3}>{grouped.status === 'active' ? 'Your shared run is underway' : grouped.status === 'delivered' ? 'Both deliveries reported' : grouped.status === 'reserved' ? 'Waiting for both buyer approvals' : 'Compatible errand found'}</Text>
      <Text style={ui.body}>Estimated combined distance saving: {grouped.savedKm.toFixed(2)} km. This compares straight-line routes; actual road distances may differ.</Text>
      <Text style={ui.body}>{grouped.approvals}/2 fees approved · {grouped.stopsDone}/4 route stops completed</Text>
      {['open', 'reserved'].includes(grouped.status) && <Text style={ui.small}>Approval window ends {new Date(grouped.expiresAt).toLocaleTimeString()}. Your errand returns to ordinary matching if both buyers do not approve in time.</Text>}
      {grouped.approved && grouped.status === 'reserved' && <Text style={ui.body}>You approved your fee. The runner starts only after the other buyer approves their own fee.</Text>}
      {data.offers.length > 0 && <Text style={ui.small}>Available offers are ranked by trust, highest first, among up to 20 latest offers. Choose any available offer; both buyers must approve their own fee before a runner is assigned. Item costs and direct payment arrangements remain separate.</Text>}
      {data.offers.map(o => <View key={`${o.id}:${o.version}`} style={ui.card}><Text style={ui.h3}>{o.name} · GH₵{(o.fee / 100).toFixed(2)}</Text><Text style={ui.body}>{o.note}</Text><TrustSummary trust={o.trust} />
        {o.canApprove && (confirm === `${o.id}:${o.version}` ? <><Text style={ui.body}>Approve GH₵{(o.fee / 100).toFixed(2)} for your errand? No payment is taken in the app.</Text><CustomerButton disabled={disabled} onPress={() => void act(() => approve({ id: errand._id, offerId: o.id, expectedVersion: o.version }))}>Confirm my fee</CustomerButton><CustomerButton onPress={() => setConfirm('')}>Go back</CustomerButton></> : <CustomerButton disabled={disabled} onPress={() => setConfirm(`${o.id}:${o.version}`)}>Review this fee</CustomerButton>)}
      </View>)}
      {grouped.status === 'open' && !data.offers.length && <Text style={ui.body}>Waiting for a runner to quote for the shared route.</Text>}
    </> : data.state === 'waiting' ? <><Text style={ui.h3}>Looking for a compatible errand</Text><Text style={ui.body}>Nearby pickup and delivery locations must save distance without a large detour. Matching ends {new Date(data.windowEndsAt!).toLocaleTimeString()}.</Text></> : <>
      <Text style={ui.body}>Share a compatible route with another buyer. Each buyer keeps their own fee, chat, delivery photo and review.</Text>
      <Text style={ui.small}>{data.state === 'released' ? 'Your errand is available for ordinary matching. You can try sharing again.' : 'Confirm your pickup and delivery pins to look for a partner. Normal errands wait up to 10 minutes; flexible errands up to 30 minutes.'}</Text>
      <CustomerButton disabled={disabled} onPress={() => setOpen(!open)}>{open ? 'Close map pins' : 'Set pins for a shared route'}</CustomerButton>
      {open && <><PinPicker label="Pickup" address={errand.pickup} point={pickup} onChange={setPickup} /><PinPicker label="Delivery" address={errand.dropoff} point={dropoff} onChange={setDropoff} /><Text style={ui.small}>Confirm both pins match your addresses. Ordinary quoting pauses while we look for a shared route.</Text><CustomerButton disabled={disabled || !pickup || !dropoff} onPress={() => void act(() => join({ id: errand._id, expectedRevision: errand.revision ?? 0, pickup: pickup!, dropoff: dropoff! }))}>Confirm pins & find a partner</CustomerButton></>}
    </>}
    {data && (data.state === 'waiting' || (grouped && ['open', 'reserved'].includes(grouped.status))) && <CustomerButton disabled={disabled} onPress={() => void act(() => leave({ id: errand._id }))}>Use ordinary matching instead</CustomerButton>}
    <FormError message={error} />
  </View>;
}
export function CurrentSharedRun() {
  const group = useQuery(api.share.current, {}); const router = useRouter();
  return group ? <View style={ui.card}><Text style={ui.h2}>{group.status === 'reserved' ? 'Shared offer reserved' : 'Your shared route'}</Text><Text style={ui.body}>{group.status === 'reserved' ? 'Waiting for the second buyer. This reservation holds your availability until the approval window ends.' : 'Follow all four stops in order and complete each delivery separately.'}</Text><CustomerButton onPress={() => router.push({ pathname: '/runner/share', params: { id: group.id } })}>Open shared run →</CustomerButton></View> : null;
}
export function SharedOpportunities() {
  const groups = useQuery(api.share.available, {}); const router = useRouter();
  return <View style={{ gap: 12 }}><Text style={ui.h2}>Shared opportunities</Text><Text style={ui.small}>Compatible pairs for your services. Up to 30 latest shared routes; the filters below apply to ordinary errands.</Text>
    {!groups ? <Text style={ui.body}>Loading shared routes…</Text> : !groups.length ? <Text style={ui.body}>No shared routes available right now.</Text> : groups.map(g => <View key={g.id} style={ui.card}><Text style={ui.h3}>{g.titles.join(' + ')}</Text>{g.areas.map((a, i) => <Text key={i} style={ui.body}>{a}</Text>)}<Text style={ui.small}>Estimated distance saved: {g.savedKm.toFixed(2)} km</Text><CustomerButton onPress={() => router.push({ pathname: '/runner/share', params: { id: g.id } })}>View shared route</CustomerButton></View>)}
  </View>;
}
