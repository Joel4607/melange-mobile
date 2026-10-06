import { useConvexConnectionState, usePaginatedQuery } from 'convex/react';
import { useRouter, type ErrorBoundaryProps } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api } from '../../../../convex/_generated/api';
import { CustomerButton, CustomerPage, palette, ui } from '@/components/customer-ui';

const filters = [
  { id: 'all', label: 'All' }, { id: 'active', label: 'Active' },
  { id: 'awaiting', label: 'Awaiting confirmation' }, { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;
type Filter = typeof filters[number]['id'];
const empty: Record<Filter, string> = {
  all: 'Errands assigned after buyer approval will appear here.', active: 'You have no errands in progress.',
  awaiting: 'No deliveries are waiting for buyer confirmation.', completed: 'Buyer-confirmed deliveries will appear here.',
  cancelled: 'You have no cancelled assignments.',
};

export default function RunnerHistory() {
  const [filter, setFilter] = useState<Filter>('all');
  return <CustomerPage>
    <Text style={ui.eyebrow}>YOUR RUNNER RECORD</Text><Text style={ui.title}>My jobs</Text>
    <Text style={ui.body}>Follow your current errands and look back on past deliveries.</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {filters.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: filter === item.id }} onPress={() => setFilter(item.id)} style={[ui.badge, { minHeight: 44, justifyContent: 'center', backgroundColor: filter === item.id ? palette.green : palette.pale }]}><Text style={[ui.badgeText, filter === item.id && { color: '#FFFFFF' }]}>{item.label}</Text></Pressable>)}
    </View>
    <HistoryResults key={filter} filter={filter} />
  </CustomerPage>;
}

function HistoryResults({ filter }: { filter: Filter }) {
  const router = useRouter();
  const { isWebSocketConnected } = useConvexConnectionState();
  const { results, status, loadMore } = usePaginatedQuery(api.runnerJobs.history, { filter }, { initialNumItems: 10 });
  return <>
    <Text style={ui.small}>Most recently updated first</Text>
    {!isWebSocketConnected && <Text accessibilityLiveRegion="polite" style={ui.body}>Reconnecting… showing your last synced jobs.</Text>}
    {status === 'LoadingFirstPage' ? <ActivityIndicator color={palette.green} /> : results.length === 0 ? <View style={ui.card}><Text style={ui.h2}>Nothing here yet.</Text><Text style={ui.body}>{empty[filter]}</Text>{(filter === 'all' || filter === 'active') && <CustomerButton onPress={() => router.push('/runner/available')}>Find an errand</CustomerButton>}</View> : results.map(job => <Pressable key={job.id} accessibilityRole="button" accessibilityLabel={`View ${job.title}`} onPress={() => router.push({ pathname: '/runner/errand', params: { id: job.id, from: 'history' } })} style={ui.card}>
      <Text style={ui.badgeText}>{job.completed ? 'COMPLETED' : job.status === 'delivered' ? 'AWAITING BUYER CONFIRMATION' : job.status === 'accepted' ? 'READY FOR PICKUP' : job.status === 'picked_up' ? 'ON THE WAY' : job.status.toUpperCase()}</Text>
      <Text style={ui.h2}>{job.title}</Text><Text style={ui.body}>Pickup: {job.pickup}</Text><Text style={ui.body}>Delivery: {job.dropoff}</Text>
      <Text style={ui.small}>Updated {new Date(job.updatedAt).toLocaleString()}</Text><Text style={ui.small}>{job.budgetPurpose === 'items' ? 'Item budget' : 'Original proposed budget'}: GH₵ {(job.budgetPesewas / 100).toFixed(2)}</Text><Text style={ui.h3}>View details →</Text>
    </Pressable>)}
    {(status === 'CanLoadMore' || status === 'LoadingMore') && <CustomerButton disabled={!isWebSocketConnected || status === 'LoadingMore'} onPress={() => loadMore(10)}>{status === 'LoadingMore' ? 'Loading…' : 'Load more jobs'}</CustomerButton>}
  </>;
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <CustomerPage><Text style={ui.title}>Could not load your jobs</Text><Text style={ui.body}>Check your connection and try again.</Text><CustomerButton onPress={() => void retry()}>Try again</CustomerButton></CustomerPage>;
}
