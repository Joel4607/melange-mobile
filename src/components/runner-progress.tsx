import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { CustomerButton, FormError, ui } from './customer-ui';
import { usePickupApproval } from './pickup-approval';

export function RunnerProgress({ id, status, revision, trackingRequired = false }: { id: Id<'errands'>; status: 'accepted' | 'picked_up'; revision: number; trackingRequired?: boolean }) {
  const advance = useMutation(api.runnerJobs.advance);
  const proof = useQuery(api.deliveryProofs.get, { id });
  const approval = usePickupApproval(id, trackingRequired && status === 'accepted');
  const tracking = useQuery(api.tracking.current, trackingRequired ? { id } : 'skip');
  const { isWebSocketConnected } = useConvexConnectionState();
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const pickup = status === 'accepted';
  const pickupBlocked = pickup && trackingRequired && (tracking == null || tracking.blockPickup || approval.data == null || !approval.canConfirm);
  const deliveryBlocked = !pickup && trackingRequired && (tracking == null || tracking.blockDelivery);
  async function save() {
    if (locked.current || confirmedRevision === null || !isWebSocketConnected || pickupBlocked || deliveryBlocked || (!pickup && !proof)) return;
    locked.current = true; setBusy(true); setError('');
    try { await advance({ id, expectedRevision: confirmedRevision, nextStatus: pickup ? 'picked_up' : 'delivered' }); }
    catch (err) { setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not save the update. Try again.'); setConfirmedRevision(null); }
    finally { locked.current = false; setBusy(false); }
  }
  return <View style={ui.card}><Text style={ui.eyebrow}>NEXT STEP</Text><Text style={ui.h2}>{pickup ? 'Collect the items.' : 'Hand over the delivery.'}</Text><Text style={ui.body}>{pickup ? 'Check the items and instructions at the pickup point. Mark pickup only after you have collected them.' : 'Mark delivered only after handing the items to the buyer or their agreed recipient. The buyer then confirms completion and can leave a review.'}</Text>
    <FormError message={error} />
    {pickup && approval.data && !approval.canConfirm && <Text accessibilityLiveRegion="polite" style={ui.small}>{approval.data.blockedReason || (approval.expired || approval.data.status === 'expired' ? 'Approval expired. Request collection approval again.' : 'Request collection approval above and wait for the buyer before confirming receipt.')}</Text>}
    {!pickup && !proof && <Text style={ui.small}>Save a handover photo above before confirming delivery.</Text>}
    {deliveryBlocked && <Text accessibilityLiveRegion="polite" style={ui.small}>{tracking ? 'Restore location before confirming delivery. Chat, directions and the handover photo remain available.' : 'Waiting for server tracking status before confirming delivery.'}</Text>}
    {confirmedRevision === null ? <CustomerButton disabled={!isWebSocketConnected || busy || pickupBlocked || deliveryBlocked || (!pickup && !proof)} onPress={() => setConfirmedRevision(revision)}>{pickup ? approval.data ? 'Items received' : 'Mark picked up' : 'Mark delivered'}</CustomerButton> : <><Text style={ui.h3}>{pickup ? 'Have you collected the items?' : 'Have you handed over the items?'}</Text><CustomerButton disabled={!isWebSocketConnected || busy || pickupBlocked || deliveryBlocked || (!pickup && !proof) || confirmedRevision !== revision} onPress={() => void save()}>{busy ? 'Saving…' : pickup ? approval.data ? 'Yes, items received' : 'Yes, confirm pickup' : 'Yes, confirm delivery'}</CustomerButton><CustomerButton disabled={busy} onPress={() => setConfirmedRevision(null)}>Not yet</CustomerButton>{confirmedRevision !== revision && <Text style={ui.small}>The errand changed. Tap Not yet and review the latest details.</Text>}</>}
    {!isWebSocketConnected && <Text style={ui.small}>{busy ? 'Reconnecting… your update will finish when connected.' : 'Reconnect to update this errand.'}</Text>}
  </View>;
}
