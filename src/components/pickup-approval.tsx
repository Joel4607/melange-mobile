import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { CustomerButton, FormError, ui } from './customer-ui';

export function usePickupApproval(id: Id<'errands'>, enabled = true) {
  const result = useQuery(api.pickup.current, enabled ? { id } : 'skip');
  const data = enabled ? result : null;
  const [expired, setExpired] = useState(false);
  const expiresAt = data?.status === 'approved' ? data.expiresAt : null;
  const serverNow = data?.serverNow;
  useEffect(() => {
    setExpired(false);
    if (expiresAt == null || serverNow == null) return;
    const remaining = expiresAt - serverNow;
    if (remaining <= 0) { setExpired(true); return; }
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [expiresAt, serverNow]);
  // Local expiry only disables presentation. Every mutation checks server time.
  return { data, expired, canConfirm: !!data?.canConfirm && !expired };
}

export function PickupApproval({ id, revision, runner = false }: { id: Id<'errands'>; revision: number; runner?: boolean }) {
  const { data, expired } = usePickupApproval(id);
  const request = useMutation(api.pickup.request);
  const approve = useMutation(api.pickup.approve);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [confirming, setConfirming] = useState<{ version: number; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  if (!data || data.status === 'consumed') return null;
  const status = expired ? 'expired' : data.status;
  const confirmationCurrent = confirming?.version === data.requestVersion && confirming.revision === revision;
  async function save() {
    if (locked.current || !isWebSocketConnected || !data) return;
    if (!runner && (!data.canApprove || !confirmationCurrent)) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (runner) await request({ id });
      else await approve({ id, expectedRevision: revision, expectedRequestVersion: data.requestVersion });
      setConfirming(null);
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not save collection approval. Reconnect and try again.');
      setConfirming(null);
    } finally { locked.current = false; setBusy(false); }
  }
  return <View style={ui.card}>
    <Text style={ui.eyebrow}>COLLECTION APPROVAL</Text>
    <Text accessibilityLiveRegion="polite" style={ui.h2}>{status === 'approved' ? 'Collection approved' : status === 'expired' ? 'Approval expired' : status === 'requested' ? runner ? 'Waiting for the buyer' : `${data.runnerName} is ready to collect` : 'Before collection'}</Text>
    <Text style={ui.body}>{runner ? 'Identify the order at the pickup point and request approval from this buyer. Confirm “Items received” only after the actual handover.' : `Authorize ${data.runnerName} to collect your items after confirming the arrangement with the pickup contact. The runner will then confirm receiving them.`}</Text>
    {status === 'approved' && data.expiresAt != null && <Text style={ui.small}>Use before {new Date(data.expiresAt).toLocaleTimeString()}. Approval lasts ten minutes and can be used once.</Text>}
    {status === 'expired' && <Text style={ui.small}>{runner ? 'Request a new approval before collecting.' : 'Your runner must send a new request for you to approve.'}</Text>}
    {status === 'requested' && runner && <Text style={ui.small}>You can use chat or call while waiting. Only this buyer can approve this collection.</Text>}
    {status === 'not_requested' && !runner && <Text style={ui.small}>Your runner will request approval at the collection point.</Text>}
    {runner && (data.canRequest || status === 'expired') && <CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void save()}>{busy ? 'Sending…' : status === 'expired' ? 'Request approval again' : 'Request collection approval'}</CustomerButton>}
    {!runner && data.canApprove && (confirmationCurrent ? <>
      <Text style={ui.h3}>Allow {data.runnerName} to collect these items?</Text>
      <CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void save()}>{busy ? 'Approving…' : 'Yes, approve collection'}</CustomerButton>
      <CustomerButton disabled={busy} onPress={() => setConfirming(null)}>Not yet</CustomerButton>
    </> : <CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => { setError(''); setConfirming({ version: data.requestVersion, revision }); }}>Approve collection</CustomerButton>)}
    {runner && data.blockedReason && <Text accessibilityLiveRegion="polite" style={ui.small}>{data.blockedReason}</Text>}
    <FormError message={error} />
    {!isWebSocketConnected && <Text style={ui.small}>Reconnect to request or approve collection.</Text>}
  </View>;
}
