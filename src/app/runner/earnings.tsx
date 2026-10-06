import { usePaginatedQuery } from 'convex/react';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { CustomerButton, CustomerPage, ui } from '@/components/customer-ui';
import { money } from '@/components/errand-pricing';

export default function JobEarnings() {
  const router = useRouter(); const { results, status, loadMore } = usePaginatedQuery(api.pricing.earnings, {}, { initialNumItems: 10 });
  return <CustomerPage><CustomerButton onPress={() => router.replace('/runner/pricing')}>← My pricing</CustomerButton><Text style={ui.eyebrow}>DIRECT PAYMENTS</Text><Text style={ui.title}>Job earnings history</Text><Text style={ui.body}>Agreed service fees and payments you confirmed receiving. Item reimbursements are excluded. These records are not verified by a payment provider.</Text>
    {status === 'LoadingFirstPage' ? <Text style={ui.body}>Loading records…</Text> : results.length === 0 && <View style={ui.card}><Text style={ui.h2}>No fee agreements yet</Text><Text style={ui.body}>Jobs appear after a buyer approves your quote. Older jobs without an agreed fee are not counted.</Text></View>}
    {results.map(job => <View key={job.id} style={ui.card}><Text style={ui.h2}>{job.title}</Text><Text style={ui.title}>{money(job.agreed.serviceFeePesewas)}</Text><Text style={ui.body}>Job: {job.completed ? 'completed' : job.status.replace('_', ' ')}</Text><Text style={ui.h3}>{job.payment?.receivedAt ? 'You confirmed receipt' : job.payment ? 'Buyer reports payment sent' : 'Payment not reported'}</Text><Text style={ui.small}>{job.payment?.receivedAt ? `Confirmed ${new Date(job.payment.receivedAt).toLocaleString()}` : `Fee agreed ${new Date(job.agreed.agreedAt).toLocaleString()}`}</Text><CustomerButton onPress={() => router.push({ pathname: '/runner/errand', params: { id: job.id, from: 'history' } })}>View job & payment record</CustomerButton></View>)}
    {(status === 'CanLoadMore' || status === 'LoadingMore') && <CustomerButton disabled={status === 'LoadingMore'} onPress={() => loadMore(10)}>More records</CustomerButton>}
  </CustomerPage>;
}
