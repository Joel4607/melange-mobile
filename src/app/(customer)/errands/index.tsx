import { useConvexConnectionState, usePaginatedQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api } from '../../../../convex/_generated/api';
import { RequireCustomer } from '@/components/customer-auth';
import { CustomerButton, CustomerPage, palette, ui } from '@/components/customer-ui';

export default function ErrandsScreen() { return <RequireCustomer><MyErrands /></RequireCustomer>; }
function MyErrands() {
  const router = useRouter();
  const { results, status, loadMore } = usePaginatedQuery(api.errands.mine, {}, { initialNumItems: 10 });
  const { isWebSocketConnected } = useConvexConnectionState();
  return <CustomerPage><Text style={ui.eyebrow}>YOUR TO-DO LIST, IN ONE PLACE</Text><Text style={ui.title}>My errands</Text><Text style={ui.body}>Your saved requests, newest first. Open one to view or manage it.</Text>
    {!isWebSocketConnected && <Text style={ui.small}>Reconnecting… any visible requests are the last loaded version.</Text>}
    {status === 'LoadingFirstPage' ? <ActivityIndicator color={palette.green} /> : results.length === 0 ? <View style={ui.card}><Text style={ui.h2}>A fresh start.</Text><Text style={ui.body}>Your first errand will appear here after you post it.</Text><CustomerButton onPress={() => router.navigate('/post')}>Post your first errand</CustomerButton></View> : results.map((errand) => <Pressable key={errand._id} accessibilityRole="button" accessibilityLabel={`View ${errand.title}`} onPress={() => router.push({ pathname: '/errands/[id]', params: { id: errand._id } })} style={ui.card}>
      <View style={ui.between}><View style={[ui.badge, errand.status === 'cancelled' && { backgroundColor: '#F8EAE3' }]}><Text style={[ui.badgeText, errand.status === 'cancelled' && { color: '#A64430' }]}>{errand.trackingMode === 'demo' ? 'DEMO · ' : ''}{errand.completion ? 'COMPLETED' : errand.status.replace('_', ' ').toUpperCase()}</Text></View><Text style={ui.small}>{new Date(errand._creationTime).toLocaleDateString()}</Text></View>
      <Text style={ui.h2}>{errand.title}</Text><Text style={ui.body} numberOfLines={1}>To: {errand.dropoff}</Text>
      {errand.reviewRating !== undefined && <Text style={ui.small}>★ {errand.reviewRating}/5 · Your review</Text>}
      <View style={ui.between}><Text style={ui.h3}>GH₵{(errand.budgetPesewas / 100).toFixed(2)}</Text><Text style={ui.small}>{errand.completion ? errand.reviewedAt !== undefined ? 'View review →' : 'Review runner →' : errand.status === 'delivered' ? 'Confirm delivery →' : errand.status === 'cancelled' ? 'View details →' : 'Track errand →'}</Text></View>
    </Pressable>)}
    {(status === 'CanLoadMore' || status === 'LoadingMore') && <CustomerButton disabled={status === 'LoadingMore'} onPress={() => loadMore(10)}>{status === 'LoadingMore' ? 'Loading…' : 'Load more errands'}</CustomerButton>}
  </CustomerPage>;
}
