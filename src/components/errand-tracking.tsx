import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { CustomerButton, FormError, palette, ui } from './customer-ui';
import { LocationTracking } from './location-tracking';

const stages = [
  { status: 'posted', title: 'Posted', description: 'Your request is saved.' },
  { status: 'accepted', title: 'Accepted', description: 'The request has been accepted.' },
  { status: 'picked_up', title: 'Picked up', description: 'Pickup is complete.' },
  { status: 'delivered', title: 'Delivered', description: 'Delivery has been reported.' },
  { status: 'completed', title: 'Completed', description: 'You confirmed receipt of the delivery.' },
] as const;
const headlines = { posted: 'Waiting to get started', accepted: 'Getting ready for pickup', picked_up: 'On the way to delivery', delivered: 'Awaiting your confirmation', cancelled: 'Request cancelled' };
const actions = { posted: 'Start demo tracking', accepted: 'Simulate pickup', picked_up: 'Simulate delivery', delivered: '', cancelled: '' };

export function ErrandTracking({ errand }: { errand: Doc<'errands'> }) {
  const options = useQuery(api.errands.trackingOptions);
  const advance = useMutation(api.errands.advanceDemoTracking);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [confirmStart, setConfirmStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const activeIndex = errand.completion ? stages.length - 1 : stages.findIndex((stage) => stage.status === errand.status);
  const times = [errand._creationTime, errand.acceptedAt, errand.pickedUpAt, errand.deliveredAt, errand.completion?.confirmedAt];
  const demo = errand.trackingMode === 'demo';
  const canSimulate = options?.demoEnabled && !errand.runnerId && (errand.status === 'posted' || (demo && (errand.status === 'accepted' || errand.status === 'picked_up')));

  async function next() {
    if (locked.current) return;
    const nextStatus = errand.status === 'posted' ? 'accepted' : errand.status === 'accepted' ? 'picked_up' : errand.status === 'picked_up' ? 'delivered' : null;
    if (!nextStatus) return;
    locked.current = true; setBusy(true); setError('');
    try { await advance({ id: errand._id, expectedRevision: errand.revision ?? 0, nextStatus }); setConfirmStart(false); }
    catch (err) { setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not update tracking. Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }

  return <View style={{ gap: 16 }}>
    <View style={styles.summary}>
      <Text style={[ui.eyebrow, { color: '#EAC492' }]}>{demo ? 'DEMO TRACKING · SIMULATED' : 'ERRAND TRACKING'}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.headline}>{errand.completion ? 'Errand completed' : headlines[errand.status]}</Text>
      <Text style={styles.summaryText}>{demo ? 'This is a demonstration. No real runner, pickup or delivery is represented.' : errand.status === 'cancelled' ? 'Tracking has stopped for this request.' : 'Follow your request from posting to delivery.'}</Text>
      <Text style={styles.connection}>{isWebSocketConnected ? '● Connected · updates sync automatically' : '○ Offline · showing the last saved update'}</Text>
    </View>
    <View style={ui.card}>
      <Text style={ui.h2}>Progress</Text>
      {stages.map((stage, index) => {
        const done = errand.status === 'cancelled' ? index === 0 : index <= activeIndex;
        const current = index === activeIndex;
        return <View key={stage.status} style={styles.step}>
          <View style={styles.rail}><View style={[styles.dot, done && styles.doneDot]}><Text style={{ color: done ? '#FFFFFF' : palette.muted, fontWeight: '700' }}>{done ? '✓' : index + 1}</Text></View>{index < stages.length - 1 && <View style={[styles.line, index < activeIndex && { backgroundColor: palette.green }]} />}</View>
          <View style={{ flex: 1, gap: 3, paddingBottom: index < stages.length - 1 ? 20 : 0 }}>
            <View style={ui.between}><Text style={[ui.h3, !done && { color: palette.muted }]}>{stage.title}{demo && index > 0 && done ? ' · Demo' : ''}</Text>{current && <Text style={ui.badgeText}>CURRENT</Text>}</View>
            <Text style={ui.small}>{done ? stage.description : errand.status === 'cancelled' ? 'Not reached · request cancelled' : 'Not reached yet'}</Text>
            {done && times[index] !== undefined && <Text style={ui.small}>{new Date(times[index]!).toLocaleString()}</Text>}
          </View>
        </View>;
      })}
      <Text style={ui.small}>Status updates are saved as each stage is reached. Estimated arrival times are not available.</Text>
    </View>
    {canSimulate && <View style={[ui.card, { backgroundColor: '#FBF0DE', borderColor: '#EED8B5' }]}>
      <Text style={ui.eyebrow}>DEMO CONTROLS</Text>
      <Text style={ui.h3}>Walk through the delivery journey</Text>
      <Text style={ui.body}>Use these controls during your demonstration. Each simulated step is saved and clearly labelled in the activity history.</Text>
      {confirmStart && errand.status === 'posted' && <Text style={ui.body}>Starting the demo marks this request as accepted. Editing and cancellation will then be unavailable. Continue with this request?</Text>}
      <FormError message={error} />
      {!isWebSocketConnected && <Text style={ui.small}>{busy ? 'Reconnecting… waiting to finish this update.' : 'Connect to the internet to use demo controls.'}</Text>}
      <CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => { if (errand.status === 'posted' && !confirmStart) setConfirmStart(true); else void next(); }}>{busy ? 'Saving demo update…' : confirmStart && errand.status === 'posted' ? 'Yes, simulate acceptance' : actions[errand.status]}</CustomerButton>
      {confirmStart && errand.status === 'posted' && <CustomerButton disabled={busy} onPress={() => setConfirmStart(false)}>Keep as posted</CustomerButton>}
    </View>}
    <LocationTracking errand={errand} />
  </View>;
}

const styles = StyleSheet.create({
  summary: { backgroundColor: palette.green, borderRadius: 23, padding: 22, gap: 12 },
  headline: { fontSize: 25, lineHeight: 32, fontWeight: '700', color: '#FFFCF5' },
  summaryText: { color: '#D2DFD4', fontSize: 14, lineHeight: 22 },
  connection: { color: '#D2DFD4', fontSize: 11, lineHeight: 17 },
  step: { flexDirection: 'row', gap: 14 },
  rail: { width: 29, alignItems: 'center' },
  dot: { width: 29, height: 29, borderRadius: 15, backgroundColor: palette.pale, alignItems: 'center', justifyContent: 'center' },
  doneDot: { backgroundColor: palette.green },
  line: { width: 2, flex: 1, minHeight: 22, backgroundColor: palette.line, marginTop: 5 },
});
