import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { CustomerButton, CustomerField, CustomerPage, FormError, ui } from '@/components/customer-ui';
import { money, parseFee, usePriceAction } from '@/components/errand-pricing';
import { runnerServiceOptions } from '@/lib/runner-profile-options';

export default function MyPricing() {
  const router = useRouter(); const rates = useQuery(api.pricing.mine, {});
  return <CustomerPage><CustomerButton onPress={() => router.replace('/runner')}>← Dashboard</CustomerButton><Text style={ui.eyebrow}>YOUR SERVICES</Text><Text style={ui.title}>My pricing</Text><Text style={ui.body}>Set starting service fees. Submit a final quote for each errand; the buyer must approve it before you start. Item costs are separate.</Text>
    {rates === undefined ? <Text style={ui.body}>Loading prices…</Text> : <RatesEditor initial={rates} />}
    <CustomerButton onPress={() => router.push('/runner/earnings')}>Job earnings history</CustomerButton><MyQuotes />
  </CustomerPage>;
}
function RatesEditor({ initial }: { initial: FunctionReturnType<typeof api.pricing.mine> }) {
  const save = useMutation(api.pricing.saveRates); const action = usePriceAction(); const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>(Object.fromEntries(initial.map(r => [r.category, (r.startingFeePesewas / 100).toFixed(2)])));
  return <View style={ui.card}><Text style={ui.h2}>Starting prices (GH₵)</Text><Text style={ui.small}>Leave a service blank if you do not offer it. Changing a starting price will not change submitted quotes or agreed fees.</Text>
    {runnerServiceOptions.map(service => <CustomerField key={service.id} label={service.label} value={draft[service.id] ?? ''} onChangeText={value => { setNotice(''); setDraft({ ...draft, [service.id]: value }); }} keyboardType="decimal-pad" maxLength={8} editable={!action.busy} placeholder="Not offered" />)}
    <FormError message={action.error} />{!!notice && <Text accessibilityLiveRegion="polite" style={ui.body}>{notice}</Text>}
    <CustomerButton disabled={action.disabled} onPress={() => void action.run(async () => { await save({ rates: runnerServiceOptions.filter(s => draft[s.id]?.trim()).map(s => ({ category: s.id, startingFeePesewas: parseFee(draft[s.id]) })) }); setNotice('Starting prices saved.'); })}>{action.busy ? 'Saving…' : 'Save starting prices'}</CustomerButton>
  </View>;
}
function MyQuotes() {
  const router = useRouter(); const { results, status, loadMore } = usePaginatedQuery(api.pricing.myQuotes, {}, { initialNumItems: 10 });
  return <View style={{ gap: 12 }}><Text style={ui.h2}>My quotes</Text>{status === 'LoadingFirstPage' ? <Text style={ui.body}>Loading quotes…</Text> : results.length === 0 && <Text style={ui.body}>Quotes you send from Find errands appear here.</Text>}
    {results.map(q => <View style={ui.card} key={q._id}><Text style={ui.h3}>{q.title}</Text><Text style={ui.h2}>{money(q.serviceFeePesewas)}</Text><Text style={ui.body}>{q.availability}</Text>{q.availability !== 'No longer available' && <CustomerButton onPress={() => router.push({ pathname: '/runner/errand', params: { id: q.errandId } })}>View errand</CustomerButton>}</View>)}
    {(status === 'CanLoadMore' || status === 'LoadingMore') && <CustomerButton disabled={status === 'LoadingMore'} onPress={() => loadMore(10)}>More quotes</CustomerButton>}
  </View>;
}
