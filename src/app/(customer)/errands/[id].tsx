import { PickupApproval } from '@/components/pickup-approval';
import { useConvexConnectionState, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { api } from '../../../../convex/_generated/api';
import type { Doc } from '../../../../convex/_generated/dataModel';
import { RequireCustomer } from '@/components/customer-auth';
import { CustomerButton, CustomerField, CustomerPage, FormError, palette, ui, useServices } from '@/components/customer-ui';
import { ErrandEditor } from '@/components/errand-editor';
import { ErrandTracking } from '@/components/errand-tracking';
import { ErrandCompletion } from '@/components/errand-completion';
import { BuyerQuotes, DirectPayment } from '@/components/errand-pricing';
import { DeliveryProof } from '@/components/delivery-proof';
import { DestinationEditor } from '@/components/destination-editor';
import { BuyerShare } from '@/components/errand-share';
import { AssignedRunnerTrust } from '@/components/runner-trust';

export default function ErrandDetailsScreen() { return <RequireCustomer><Details /></RequireCustomer>; }
function Details() {
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const errand = useQuery(api.errands.get, { id: typeof params.id === 'string' ? params.id : '' });
  const { services } = useServices();
  const { isWebSocketConnected } = useConvexConnectionState();
  const [panel, setPanel] = useState<'edit' | 'cancel' | null>(null);
  const [notice, setNotice] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  function back() { if (router.canGoBack()) router.back(); else router.replace('/errands'); }
  if (errand === undefined) return <CustomerPage><CustomerButton onPress={back}>← My errands</CustomerButton><ActivityIndicator color={palette.green} /><Text style={ui.body}>Loading your errand…</Text></CustomerPage>;
  if (!errand) return <CustomerPage><Text style={ui.title}>Errand not found.</Text><Text style={ui.body}>This request is unavailable or doesn’t belong to your account.</Text><CustomerButton onPress={back}>← My errands</CustomerButton></CustomerPage>;
  const canManage = errand.status === 'posted' && !errand.runnerId;
  return <>
    <CustomerPage>
      <Pressable accessibilityRole="button" onPress={back} style={{ paddingVertical: 10 }}><Text style={ui.h3}>← My errands</Text></Pressable>
      <View style={ui.between}><Text style={ui.eyebrow}>YOUR ERRAND</Text><View style={[ui.badge, errand.status === 'cancelled' && { backgroundColor: '#F8EAE3' }]}><Text style={ui.badgeText}>{errand.trackingMode === 'demo' ? 'DEMO · ' : ''}{errand.completion ? 'COMPLETED' : errand.status.replace('_', ' ').toUpperCase()}</Text></View></View>
      <Text style={ui.title}>{errand.title}</Text>
      <Text style={ui.body}>{services?.find((service) => service.id === errand.category)?.name ?? errand.category}</Text>
      {notice ? <Text accessibilityLiveRegion="polite" style={[ui.body, { color: palette.green }]}>{notice}</Text> : null}
      {!isWebSocketConnected && <Text style={ui.small}>Reconnecting… showing the last loaded details.</Text>}
      {errand.runnerId && errand.status === 'delivered' && <DeliveryProof key={`proof:${errand._id}`} id={errand._id} />}
      {errand.status === 'delivered' && <ErrandCompletion key={`completion:${errand._id}`} errand={errand} />}
      <DestinationEditor key={`pins:${errand._id}:${errand.revision ?? 0}`} errand={errand} />
      <BuyerShare key={`share:${errand._id}:${errand.revision ?? 0}`} errand={errand} />
      {canManage && !errand.trackingMode && errand.shareState !== 'waiting' && errand.shareState !== 'paired' && <BuyerQuotes key={`quotes:${errand._id}`} id={errand._id} revision={errand.revision ?? 0} />}
      {errand.runnerId && <DirectPayment key={`payment:${errand._id}`} id={errand._id} />}
      {errand.runnerId && !errand.trackingMode && <AssignedRunnerTrust id={errand._id} />}
      {errand.trackingObligationId && errand.runnerId && errand.status === 'accepted' && !errand.trackingMode && <PickupApproval key={`pickup:${errand._id}`} id={errand._id} revision={errand.revision ?? 0} />}
      <ErrandTracking key={`tracking:${errand._id}`} errand={errand} />
      <View style={ui.card}><Text style={ui.h2}>Messages</Text><Text style={ui.body}>{errand.trackingMode === 'demo' && !errand.runnerId ? 'Try text and image messages in a clearly labelled demo conversation.' : errand.runnerId ? 'Share instructions, item photos or pickup details with your runner.' : 'Your private chat opens after you approve a runner’s quote.'}</Text>{(errand.runnerId || errand.trackingMode === 'demo') && <CustomerButton onPress={() => router.push({ pathname: '/errands/chat', params: { id: errand._id } })}>{errand.trackingMode === 'demo' && !errand.runnerId ? 'Open demo chat' : 'Open chat'}</CustomerButton>}</View>
      <View style={ui.card}><Text style={ui.h3}>Pickup</Text><Text style={ui.body}>{errand.pickup}</Text><Text style={ui.h3}>Delivery</Text><Text style={ui.body}>{errand.dropoff}</Text></View>
      <View style={ui.card}><View style={ui.between}><Text style={ui.h3}>{errand.budgetPurpose === 'items' ? 'Item budget' : 'Original proposed budget'}</Text><Text style={ui.h2}>GH₵{(errand.budgetPesewas / 100).toFixed(2)}</Text></View><Text style={ui.body}>When: {errand.urgency === 'express' ? 'ASAP' : errand.urgency === 'normal' ? 'Today' : 'Whenever'}</Text><Text style={ui.h3}>Instructions</Text><Text style={ui.body}>{errand.description || 'No extra instructions.'}</Text></View>
      {errand.status === 'cancelled' ? <View style={ui.card}><Text style={ui.h3}>This errand was cancelled.</Text><Text style={ui.body}>{errand.cancellationReason || 'You cancelled this request.'}</Text><Text style={ui.small}>It stays in your history. You can post a new errand whenever you need to.</Text></View> : <Text style={ui.small}>{canManage ? 'No runner assigned. You can edit or cancel this request.' : 'Editing and cancellation are unavailable once a request has been accepted.'} Payments are arranged directly with your runner; Melange does not collect them.</Text>}
      {canManage && <View style={{ gap: 12 }}><CustomerButton disabled={!isWebSocketConnected} onPress={() => { setNotice(''); setPanel('edit'); }}>Edit errand</CustomerButton><Pressable accessibilityRole="button" disabled={!isWebSocketConnected} onPress={() => { setNotice(''); setPanel('cancel'); }} style={{ padding: 17, borderRadius: 15, backgroundColor: '#F8EAE3', opacity: isWebSocketConnected ? 1 : 0.5 }}><Text style={[ui.buttonText, { color: '#A64430' }]}>Cancel errand</Text></Pressable></View>}
      <Text style={ui.h2}>Activity</Text><Activity errand={errand} />
    </CustomerPage>
    <Modal visible={panel !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!modalBusy) setPanel(null); }}>
      {panel === 'edit' && <ErrandEditor errand={errand} onBusyChange={setModalBusy} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); setNotice('Your errand has been updated.'); }} />}
      {panel === 'cancel' && <Cancellation errand={errand} onBusyChange={setModalBusy} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); setNotice('Your errand has been cancelled.'); }} />}
    </Modal>
  </>;
}
function Activity({ errand }: { errand: Doc<'errands'> }) {
  const { results, status, loadMore } = usePaginatedQuery(api.errands.history, { id: errand._id }, { initialNumItems: 10 });
  return <View style={{ gap: 12 }}>
    {status === 'LoadingFirstPage' && <ActivityIndicator color={palette.green} />}
    {results.map((event) => <View style={ui.card} key={event._id}><View style={ui.between}><Text style={ui.h3}>{event.isDemo ? 'Demo · ' : ''}{{ edited: 'Errand edited', cancelled: 'Errand cancelled', accepted: 'Accepted', picked_up: 'Picked up', delivered: 'Delivered', completed: 'Completion confirmed', reviewed: 'Review submitted' }[event.kind]}</Text><Text style={ui.small}>{new Date(event._creationTime).toLocaleDateString()}</Text></View><Text style={ui.body}>{event.summary}</Text><Text style={ui.small}>{new Date(event._creationTime).toLocaleTimeString()}</Text></View>)}
    {(status === 'CanLoadMore' || status === 'LoadingMore') && <CustomerButton disabled={status === 'LoadingMore'} onPress={() => loadMore(10)}>{status === 'LoadingMore' ? 'Loading…' : 'Earlier activity'}</CustomerButton>}
    {status === 'Exhausted' && <View style={ui.card}><Text style={ui.h3}>Errand posted</Text><Text style={ui.body}>Your request was saved.</Text><Text style={ui.small}>{new Date(errand._creationTime).toLocaleString()}</Text></View>}
  </View>;
}
function Cancellation({ errand, onClose, onSaved, onBusyChange }: { errand: Doc<'errands'>; onClose: () => void; onSaved: () => void; onBusyChange: (busy: boolean) => void }) {
  const cancel = useMutation(api.errands.cancel);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [revision] = useState(errand.revision ?? 0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  async function confirm() {
    if (locked.current) return;
    locked.current = true; setBusy(true); onBusyChange(true); setError('');
    try { await cancel({ id: errand._id, expectedRevision: revision, reason }); onSaved(); }
    catch (err) { setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not cancel your errand. Please try again.'); }
    finally { locked.current = false; setBusy(false); onBusyChange(false); }
  }
  return <CustomerPage><Text style={ui.eyebrow}>CANCEL REQUEST</Text><Text style={ui.title}>Cancel this errand?</Text><Text style={ui.h2}>{errand.title}</Text><Text style={ui.body}>The request will be marked as cancelled and kept in your history. You won’t be able to edit or reopen it.</Text><CustomerField label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={500} multiline editable={!busy} placeholder="I no longer need this errand" /><FormError message={error} />{!isWebSocketConnected && <Text style={ui.body}>Reconnecting… {busy ? 'waiting to finish your cancellation.' : 'connect before confirming.'}</Text>}<CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void confirm()}>{busy ? 'Cancelling…' : 'Yes, cancel errand'}</CustomerButton><CustomerButton disabled={busy} onPress={onClose}>Keep errand</CustomerButton></CustomerPage>;
}
