import { useConvexConnectionState, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { directionsUrl, travelModeFor } from '@/lib/runner-navigation';
import { navigationDestination } from '@/lib/errand-destinations';
import { ErrandDestinationMap } from './errand-destination-map';
import { CustomerButton, FormError, ui } from './customer-ui';

// Saved destinations and explicitly shared buyer GPS remain separate markers.
export function DeliveryMeetingMap({ id }: { id: Id<'errands'> }) {
  const destinations = useQuery(api.errands.destinations, { id });
  const runner = useQuery(api.locations.current, { id });
  const buyerLocation = useQuery(api.buyerLocationShares.current, { id });
  const profile = useQuery(api.runners.profile, {});
  const errand = useQuery(api.runnerJobs.get, { id });
  const tracking = useQuery(api.tracking.current, errand?.trackingRequired ? { id } : 'skip');
  const { isWebSocketConnected } = useConvexConnectionState();
  const [error, setError] = useState(''), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const point = runner?.source === 'runner_gps' ? runner.point : undefined;
  const stale = (!!errand?.trackingRequired && tracking?.condition !== 'current') || !isWebSocketConnected || !runner?.sharing || !point || Math.min(runner.receivedAt, point.capturedAt) + 30000 <= now;
  if (!destinations) return <Text style={ui.small}>{destinations === undefined ? 'Loading destinations…' : 'Destinations unavailable.'}</Text>;
  const pickupNext = destinations.status === 'accepted';
  const pin = pickupNext ? destinations.pickupPoint : destinations.dropoffPoint;
  const address = pickupNext ? destinations.pickup : destinations.dropoff;
  async function navigate(toBuyer = false) {
    setError('');
    const target = toBuyer && buyerLocation ? `${buyerLocation.point.latitude},${buyerLocation.point.longitude}` : navigationDestination(address, pin);
    try { await Linking.openURL(directionsUrl(target, travelModeFor(profile?.transport))); }
    catch { setError('Could not open Maps. Try again or confirm the address in chat.'); }
  }
  return <View style={ui.card}><Text style={ui.h2}>Runner and destinations</Text>
    <ErrandDestinationMap runner={point} customer={buyerLocation?.point} customerLabel="Buyer · shared live GPS" pickup={destinations.pickupPoint} dropoff={destinations.dropoffPoint} stale={stale} condition={errand?.trackingRequired ? tracking?.condition ?? 'awaiting_location' : undefined} />
    <Text style={ui.small}>{buyerLocation ? 'Blue pin: this buyer’s shared live location. Saved destination pins stay orange.' : 'This buyer has not shared a current live location. Follow the saved delivery pin or written address.'}</Text>
    <Text style={ui.small}>{point ? stale ? 'Your marker shows your last known position.' : 'Your GPS position is current.' : errand?.trackingRequired ? 'Waiting for a fresh GPS position. Sharing starts automatically; use Restore location below if access is interrupted.' : 'Waiting for your first GPS position. Start location sharing below.'}</Text>
    <Text style={ui.body}>{pickupNext ? 'Pickup' : 'Delivery'}: {address}</Text>
    <CustomerButton disabled={profile === undefined} onPress={() => void navigate()}>Directions to {pickupNext ? 'pickup' : 'delivery'}</CustomerButton>
    {!pickupNext && buyerLocation && <CustomerButton disabled={profile === undefined} onPress={() => void navigate(true)}>Directions to buyer’s live position</CustomerButton>}
    <Text style={ui.small}>{pin ? 'Directions use the saved destination pin.' : 'No pin saved—directions use the written address.'} Confirm the destination before travelling. Opening another app can pause foreground sharing in Expo Go.</Text>
    <FormError message={error} />
  </View>;
}
