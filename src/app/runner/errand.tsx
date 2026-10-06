import { PickupApproval } from '@/components/pickup-approval';
import { useConvexConnectionState, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { CustomerButton, CustomerPage, palette, ui } from '@/components/customer-ui';
import { runnerServiceOptions } from '@/lib/runner-profile-options';
import { RunnerProgress } from '@/components/runner-progress';
import { RunnerLocationControls } from '@/components/runner-location-sharing';
import { RunnerQuote, DirectPayment } from '@/components/errand-pricing';
import { DeliveryProof } from '@/components/delivery-proof';
import { RunnerNavigation } from '@/components/runner-navigation';
import { DeliveryMeetingMap } from '@/components/delivery-meeting-map';

export default function RunnerErrandDetails() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const errandId = typeof id === 'string' ? id : '';
  return <RunnerErrandDetailsContent key={errandId} id={errandId} fromHistory={from === 'history'} />;
}

function RunnerErrandDetailsContent({ id, fromHistory }: { id: string; fromHistory: boolean }) {
  const router = useRouter();
  const errand = useQuery(api.runnerJobs.get, { id });
  const { isWebSocketConnected } = useConvexConnectionState();
  const back = <CustomerButton onPress={() => { if (fromHistory && router.canGoBack()) router.back(); else router.replace(fromHistory ? '/runner/history' : '/runner/available'); }}>{fromHistory ? '← My jobs' : '← Available errands'}</CustomerButton>;
  if (errand === undefined) return <CustomerPage>{back}<ActivityIndicator color={palette.green} /><Text style={ui.body}>Loading errand details…</Text></CustomerPage>;
  if (!errand) return <CustomerPage>{back}<Text style={ui.title}>Errand unavailable</Text><Text style={ui.body}>It may have been accepted by another runner, cancelled, or removed from available requests.</Text><CustomerButton onPress={() => router.replace('/runner')}>Runner dashboard</CustomerButton></CustomerPage>;
  const status = errand.completed ? 'Completed' : errand.status === 'accepted' ? 'Ready for pickup' : errand.status === 'picked_up' ? 'On the way' : errand.status === 'delivered' ? 'Awaiting buyer confirmation' : errand.status === 'cancelled' ? 'Cancelled' : 'Available';
  return <CustomerPage>
    {back}<Text style={ui.eyebrow}>{runnerServiceOptions.find(option => option.id === errand.category)?.label}</Text><Text style={ui.title}>{errand.title}</Text>
    <View style={{ alignItems: 'flex-start' }}><View style={ui.badge}><Text accessibilityLiveRegion="polite" style={ui.badgeText}>{status}</Text></View></View>
    {!isWebSocketConnected && <Text accessibilityLiveRegion="polite" style={ui.body}>Showing the last synced details. Reconnect before sending a quote.</Text>}
    <View style={ui.card}><Text style={ui.eyebrow}>PICKUP</Text><Text style={ui.body}>{errand.pickup}</Text><Text style={ui.eyebrow}>DELIVER TO</Text><Text style={ui.body}>{errand.dropoff}</Text></View>
    {errand.shareGroupId && <CustomerButton onPress={() => router.push({ pathname: '/runner/share', params: { id: errand.shareGroupId } })}>Open shared route & next stop</CustomerButton>}
    {!errand.shareGroupId && ['posted', 'accepted', 'picked_up'].includes(errand.status) && <RunnerNavigation id={errand.assignedToMe ? errand.id : undefined} pickup={errand.pickup} dropoff={errand.dropoff} status={errand.status} />}
    {errand.assignedToMe && ['accepted', 'picked_up'].includes(errand.status) && <DeliveryMeetingMap id={errand.id} />}
    <View style={ui.card}><Text style={ui.h2}>Instructions</Text><Text style={ui.body}>{errand.description || 'No additional instructions. You can ask the buyer in chat after they approve your quote.'}</Text></View>
    <View style={ui.card}><Text style={ui.eyebrow}>{errand.budgetPurpose === 'items' ? 'ITEM BUDGET' : 'BUYER’S PROPOSED BUDGET'}</Text><Text style={ui.title}>GH₵ {(errand.budgetPesewas / 100).toFixed(2)}</Text><Text style={ui.body}>Timing: {errand.urgency === 'express' ? 'Express' : errand.urgency === 'low' ? 'Flexible' : 'Normal'}</Text><Text style={ui.small}>This estimate is separate from your service fee. Discuss purchase costs and any reimbursements with the buyer. Melange does not collect payments.</Text></View>
    {errand.assignedToMe && <DirectPayment id={errand.id} runner />}
    {errand.assignedToMe && (errand.status === 'picked_up' || errand.status === 'delivered') && <DeliveryProof key={errand.id} id={errand.id} editable={errand.status === 'picked_up'} />}
    {errand.record && <View style={ui.card}>
      <Text style={ui.h2}>Job timeline</Text>
      {([{ label: 'Accepted', time: errand.record.acceptedAt }, { label: 'Picked up', time: errand.record.pickedUpAt }, { label: 'Delivered', time: errand.record.deliveredAt }, { label: 'Buyer confirmed', time: errand.record.confirmedAt }]).map(step => <View key={step.label} style={{ gap: 4 }}><Text style={ui.h3}>{step.label}</Text><Text style={ui.small}>{step.time !== null ? new Date(step.time).toLocaleString() : 'No time recorded'}</Text></View>)}
    </View>}
    {errand.record && errand.completed && <View style={ui.card}>
      <Text style={ui.h2}>Buyer review</Text>
      {errand.record.review ? <><Text accessibilityLabel={`${errand.record.review.rating} out of 5 stars`} style={[ui.h2, { color: palette.orange }]}>{'★'.repeat(errand.record.review.rating)}{'☆'.repeat(5 - errand.record.review.rating)}</Text><Text style={ui.body}>{errand.record.review.comment || 'The buyer left a rating without a comment.'}</Text><Text style={ui.small}>{new Date(errand.record.review.createdAt).toLocaleString()}</Text></> : <Text style={ui.body}>The buyer has not left a review yet.</Text>}
    </View>}
    {errand.assignedToMe && (errand.status === 'accepted' || errand.status === 'picked_up') && <>
      {errand.trackingRequired && errand.status === 'accepted' && <PickupApproval id={errand.id} revision={errand.revision} runner />}
      {errand.canProgress ? <RunnerProgress key={`${errand.id}:${errand.status}`} id={errand.id} status={errand.status} revision={errand.revision} trackingRequired={errand.trackingRequired} /> : <Text style={ui.body}>Another stop comes first. Open the shared route to continue in order.</Text>}
      {!errand.shareGroupId && <RunnerLocationControls errandId={errand.id} />}
    </>}
    {errand.assignedToMe ? <View style={[ui.card, { backgroundColor: palette.pale }]}><Text style={ui.h2}>{errand.completed ? 'Run completed.' : 'This is your errand.'}</Text><Text style={ui.body}>The buyer can see the assignment and contact you in your private conversation.</Text><CustomerButton onPress={() => router.push({ pathname: '/runner/chat', params: { id: errand.id } })}>{errand.completed || errand.status === 'cancelled' ? 'View conversation' : 'Message buyer'}</CustomerButton><CustomerButton onPress={() => router.replace('/runner')}>Open dashboard</CustomerButton>{errand.status === 'delivered' && !errand.completed && <Text style={ui.small}>Delivery reported. The buyer can now confirm receipt and leave a review.</Text>}</View> : <RunnerQuote errand={errand} />}
  </CustomerPage>;
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const router = useRouter();
  return <CustomerPage><Text style={ui.title}>Could not open this errand</Text><Text style={ui.body}>Check your connection and try again.</Text><CustomerButton onPress={() => void retry()}>Try again</CustomerButton><CustomerButton onPress={() => router.replace('/runner/available')}>Find errands</CustomerButton></CustomerPage>;
}
