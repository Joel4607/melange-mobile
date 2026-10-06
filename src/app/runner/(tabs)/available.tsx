import { CurrentSharedRun, SharedOpportunities } from '@/components/errand-share';
import { useConvexConnectionState, usePaginatedQuery, useQuery } from 'convex/react';
import type { FunctionArgs } from 'convex/server';
import { useRouter, type ErrorBoundaryProps } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api } from '../../../../convex/_generated/api';
import { CustomerButton, CustomerField, CustomerPage, FormError, palette, ui } from '@/components/customer-ui';
import { runnerServiceOptions } from '@/lib/runner-profile-options';
import { parseBudgetFilter } from '@/lib/runner-discovery';

type Filters = Omit<FunctionArgs<typeof api.runnerJobs.availableErrands>, 'paginationOpts'>;
const urgencyOptions = [{ id: undefined, label: 'Any timing' }, { id: 'express', label: 'Express' }, { id: 'normal', label: 'Normal' }, { id: 'low', label: 'Flexible' }] as const;

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[ui.badge, { minHeight: 44, justifyContent: 'center', backgroundColor: selected ? palette.green : palette.pale }]}><Text style={[ui.badgeText, selected && { color: '#FFFFFF' }]}>{label}</Text></Pressable>;
}

export default function AvailableErrands() {
  const router = useRouter();
  const [draft, setDraft] = useState<Filters>({}); const [filters, setFilters] = useState<Filters>({});
  const [minimum, setMinimum] = useState(''); const [maximum, setMaximum] = useState('');
  const [error, setError] = useState(''); const [expanded, setExpanded] = useState(false);
  const { results, status, loadMore } = usePaginatedQuery(api.runnerJobs.availableErrands, filters, { initialNumItems: 25 });
  const active = useQuery(api.runnerJobs.capacity, {}); const profile = useQuery(api.runners.profile, {});
  const { isWebSocketConnected } = useConvexConnectionState();
  // A text search can return an empty batch while more records remain. Continue
  // until a match or exhaustion instead of reporting a false empty state.
  useEffect(() => {
    if (!results.length && status === 'CanLoadMore' && isWebSocketConnected) loadMore(25);
  }, [results.length, status, loadMore, isWebSocketConnected]);
  function apply() {
    try {
      const minBudget = parseBudgetFilter(minimum); const maxBudget = parseBudgetFilter(maximum);
      if (minBudget !== undefined && maxBudget !== undefined && minBudget > maxBudget) throw new Error('Minimum budget cannot exceed maximum budget.');
      setFilters({ ...draft, search: draft.search?.trim(), area: draft.area?.trim(), minBudget, maxBudget }); setError(''); setExpanded(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Check your filters.'); }
  }
  function reset() { setFilters({}); setDraft({}); setMinimum(''); setMaximum(''); setError(''); }
  const summary = [
    filters.search && `Search: ${filters.search}`, filters.area && `Area: ${filters.area}`,
    filters.category && runnerServiceOptions.find(s => s.id === filters.category)?.label,
    filters.preferredServices && 'My services', filters.urgency && urgencyOptions.find(u => u.id === filters.urgency)?.label,
    filters.minBudget !== undefined && `From GH₵${(filters.minBudget / 100).toFixed(2)}`,
    filters.maxBudget !== undefined && `Up to GH₵${(filters.maxBudget / 100).toFixed(2)}`,
    filters.order === 'oldest' ? 'Oldest first' : 'Newest first',
  ].filter(Boolean).join(' · ');
  const searching = status === 'LoadingFirstPage' || (!results.length && status !== 'Exhausted');
  return <CustomerPage><CurrentSharedRun /><SharedOpportunities />
    <View style={{ gap: 6 }}><Text style={ui.eyebrow}>FIND YOUR NEXT RUN</Text><Text style={ui.title}>Available errands</Text><Text style={ui.body}>Find a request that suits you, then quote your service fee. The buyer approves before you are assigned.</Text></View>
    {!isWebSocketConnected && <Text accessibilityLiveRegion="polite" style={ui.body}>Reconnecting… availability may have changed. Connect to submit a quote.</Text>}
    {active && <View style={[ui.card, { backgroundColor: palette.pale }]}><Text style={ui.h3}>You already have an active errand</Text><Text style={ui.body}>{active.title}</Text><Text style={ui.small}>Finish it before quoting for another.</Text><CustomerButton onPress={() => router.push({ pathname: '/runner/errand', params: { id: active.id } })}>Open active errand</CustomerButton></View>}
    <View style={ui.card}>
      <CustomerField label="Search errands" value={draft.search ?? ''} onChangeText={search => setDraft(d => ({ ...d, search }))} placeholder="Title, item or landmark" maxLength={100} returnKeyType="search" onSubmitEditing={apply} />
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.h3}>{expanded ? '− Hide filters' : '+ Service, area, timing & budget'}</Text></Pressable>
      {expanded && <>
        <Text style={ui.h3}>Service</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[{ id: undefined, label: 'All services' }, ...runnerServiceOptions].map(option => <Chip key={option.id ?? 'all'} label={option.label} selected={!draft.preferredServices && draft.category === option.id} onPress={() => setDraft(d => ({ ...d, category: option.id, preferredServices: false }))} />)}
          {profile && <Chip label="My services" selected={!!draft.preferredServices} onPress={() => setDraft(d => ({ ...d, category: undefined, preferredServices: true }))} />}
        </View>
        <CustomerField label="Pickup or delivery area" value={draft.area ?? ''} onChangeText={area => setDraft(d => ({ ...d, area }))} placeholder="e.g. Osu" hint="Matches the written addresses, not distance from you." maxLength={100} />
        {profile && <CustomerButton onPress={() => setDraft(d => ({ ...d, area: profile.area }))}>Use my working area: {profile.area}</CustomerButton>}
        <Text style={ui.h3}>Timing</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{urgencyOptions.map(option => <Chip key={option.id ?? 'any'} label={option.label} selected={draft.urgency === option.id} onPress={() => setDraft(d => ({ ...d, urgency: option.id }))} />)}</View>
        <Text style={ui.h3}>Buyer’s budget range</Text><Text style={ui.small}>Purchase/proposed budget only. Your service fee is quoted separately.</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><CustomerField label="Minimum GH₵" value={minimum} onChangeText={setMinimum} keyboardType="decimal-pad" placeholder="Any" maxLength={12} /></View><View style={{ flex: 1 }}><CustomerField label="Maximum GH₵" value={maximum} onChangeText={setMaximum} keyboardType="decimal-pad" placeholder="Any" maxLength={12} /></View></View>
        <Text style={ui.h3}>Order</Text><View style={ui.row}><Chip label="Newest first" selected={draft.order !== 'oldest'} onPress={() => setDraft(d => ({ ...d, order: 'newest' }))} /><Chip label="Oldest first" selected={draft.order === 'oldest'} onPress={() => setDraft(d => ({ ...d, order: 'oldest' }))} /></View>
      </>}
      <FormError message={error} /><CustomerButton onPress={apply}>Find errands</CustomerButton>
      <Pressable accessibilityRole="button" onPress={reset} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.h3}>Clear all filters</Text></Pressable>
    </View>
    <View style={{ gap: 6 }}><Text style={ui.h3}>{searching ? 'Finding matches…' : `${results.length} ${status === 'Exhausted' ? 'matching' : 'loaded'} errand${results.length === 1 ? '' : 's'}`}</Text><Text style={ui.small}>{summary}</Text></View>
    {searching ? <View style={ui.card}><ActivityIndicator color={palette.green} /><Text style={ui.body}>{isWebSocketConnected ? 'Looking through available requests…' : 'Waiting for your connection…'}</Text></View> : results.length === 0 ? <View style={ui.card}><Text style={ui.h2}>No matching errands yet.</Text><Text style={ui.body}>Try a broader area, another service or a different budget. New requests appear automatically.</Text><CustomerButton onPress={reset}>Show all errands</CustomerButton></View> : results.map(errand => <Pressable key={errand.id} accessibilityRole="button" accessibilityLabel={`View ${errand.title}`} onPress={() => router.push({ pathname: '/runner/errand', params: { id: errand.id } })} style={ui.card}>
      <View style={ui.between}><Text style={ui.eyebrow}>{runnerServiceOptions.find(option => option.id === errand.category)?.label}</Text><Text style={ui.badgeText}>{errand.urgency === 'express' ? 'EXPRESS' : errand.urgency === 'low' ? 'FLEXIBLE' : 'NORMAL'}</Text></View>
      <Text style={ui.h2}>{errand.title}</Text><Text style={ui.body}>Pickup: {errand.pickup}</Text><Text style={ui.body}>Deliver to: {errand.dropoff}</Text>
      <View style={ui.between}><Text style={ui.h3}>GH₵ {(errand.budgetPesewas / 100).toFixed(2)}</Text><Text style={ui.h3}>View details →</Text></View><Text style={ui.small}>{errand.budgetPurpose === 'items' ? 'Item budget' : 'Proposed budget'} · {new Date(errand.createdAt).toLocaleString()}</Text>
    </Pressable>)}
    {!!results.length && (status === 'CanLoadMore' || status === 'LoadingMore') && <CustomerButton disabled={status === 'LoadingMore' || !isWebSocketConnected} onPress={() => loadMore(25)}>{status === 'LoadingMore' ? 'Searching…' : 'Find more matching errands'}</CustomerButton>}
  </CustomerPage>;
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <CustomerPage><Text style={ui.title}>Could not load errands</Text><Text style={ui.body}>Check your connection and try again.</Text><CustomerButton onPress={() => void retry()}>Try again</CustomerButton></CustomerPage>;
}
