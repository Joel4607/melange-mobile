import { useConvexConnectionState, useMutation } from 'convex/react';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import type { GeoPoint } from '../../convex/lib/shareGeo';
import { PinPicker } from './destination-pin-picker';
import { shareError } from './errand-share';
import { CustomerButton, FormError, ui } from './customer-ui';

export function DestinationEditor({ errand }: { errand: Doc<'errands'> }) {
  const save = useMutation(api.errands.saveDestinations);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [pickup, setPickup] = useState<GeoPoint | undefined>(errand.sharePickup);
  const [dropoff, setDropoff] = useState<GeoPoint | undefined>(errand.shareDropoff);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (errand.status !== 'posted' || errand.runnerId || errand.trackingMode || ['waiting', 'paired'].includes(errand.shareState ?? '')) return null;
  async function submit() {
    if (busy || !pickup || !dropoff) return;
    setBusy(true); setError('');
    try { await save({ id: errand._id, expectedRevision: errand.revision ?? 0, pickup, dropoff }); setOpen(false); }
    catch (e) { setError(shareError(e)); } finally { setBusy(false); }
  }
  return <View style={ui.card}><Text style={ui.h2}>Pickup and delivery pins</Text>
    <Text style={ui.body}>{errand.sharePickup && errand.shareDropoff ? 'Your destination pins are saved.' : 'Add map pins to help your runner find the addresses.'} These stay fixed; your live location is not shared.</Text>
    <CustomerButton disabled={busy} onPress={() => setOpen(!open)}>{open ? 'Close pin editor' : 'Choose map pins'}</CustomerButton>
    {open && <><PinPicker label="Pickup" address={errand.pickup} point={pickup} onChange={setPickup} /><PinPicker label="Delivery" address={errand.dropoff} point={dropoff} onChange={setDropoff} />
      <Text style={ui.small}>Confirm both pins match your written addresses. Saving updates the request; existing quotes must be refreshed. Location permission is optional—you can place pins on the map.</Text>
      <CustomerButton disabled={busy || !pickup || !dropoff || !isWebSocketConnected} onPress={() => void submit()}>{busy ? 'Saving…' : 'Confirm destination pins'}</CustomerButton></>}
    <FormError message={error} />
  </View>;
}
