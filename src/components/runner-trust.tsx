import { useQuery } from 'convex/react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { RunnerTrust } from '../../convex/lib/trustScore';
import { palette, ui } from './customer-ui';

const historyLabels = { new: 'New runner', limited: 'Limited history', established: 'Established history' };

export function TrustSummary({ trust, expanded = false }: { trust: RunnerTrust; expanded?: boolean }) {
  const [details, setDetails] = useState(expanded);
  return <View style={{ gap: 10 }}>
    <View style={[ui.between, { flexWrap: 'wrap' }]}><Text style={ui.h2}>Trust · {trust.score}/100</Text><View style={ui.badge}><Text style={ui.badgeText}>{historyLabels[trust.history]}</Text></View></View>
    <Text style={ui.small}>{trust.limitedToRecent ? 'Recent record: ' : ''}{trust.completedJobs} buyer-confirmed jobs · {trust.distinctBuyers} different buyers · {trust.ratingCount ? `${trust.averageRating}/5 from ${trust.ratingCount} reviews` : 'No reviews yet'}</Text>
    {trust.history === 'new' && <Text style={ui.body}>Starts at a neutral 50 while building a record. This is not a poor rating.</Text>}
    {trust.history === 'limited' && <Text style={ui.small}>A small history can change quickly as more jobs are completed.</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(!details)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={ui.h3}>{details ? '− Hide score explanation' : '+ How this score works'}</Text></Pressable>
    {details && <View style={{ gap: 9 }}>
      <Text style={ui.h3}>Completion evidence: {trust.completionScore}/100</Text><Text style={ui.small}>About 47% of the score. Buyer confirmations build evidence from a neutral starting point; this is not a completion-rate percentage.</Text>
      <Text style={ui.h3}>Buyer feedback: {trust.ratingScore}/100</Text><Text style={ui.small}>About 33%. Reviews count only after confirmed completion. Limited feedback is balanced with a neutral starting value.</Text>
      <Text style={ui.h3}>First reply: {trust.responseScore}/100</Text><Text style={ui.small}>20%. {trust.responseCount ? `${trust.repliedCount} of ${trust.responseCount} tracked buyer messages received a reply before completion.${trust.averageReplyMinutes !== null ? ` Average first reply: ${trust.averageReplyMinutes} min.` : ''}` : 'No tracked response history yet; uses a neutral value.'} A reply within 5 minutes earns full response credit, falling to zero at 60 minutes. Extra messages do not earn extra points.</Text>
      <Text style={ui.small}>Recent evidence counts more, with its weight halving after 30 days. Each buyer contributes at most three full jobs’ worth of evidence. {trust.limitedToRecent ? 'Only the 100 most recent confirmed jobs are included.' : 'Uses up to 100 most recent confirmed jobs.'}</Text>
      <Text style={ui.small}>Demo activity is excluded. Existing reviews and confirmations count; reply timing is collected for newly assigned jobs. Unattributed cancellations, disputes, identity checks and external payments are not scored.</Text>
      <Text style={ui.small}>This score helps compare recorded activity. It is not identity verification or a guarantee. {trust.asOf > 0 ? `Evidence evaluated ${new Date(trust.asOf).toLocaleDateString()}.` : ''}</Text>
    </View>}
  </View>;
}

export function OwnRunnerTrust() {
  const trust = useQuery(api.trust.mine, {});
  return <View style={ui.card}><Text style={ui.eyebrow}>YOUR RUNNER RECORD</Text>
    {trust ? <><TrustSummary trust={trust} /><Text style={ui.body}>Build your record by completing errands carefully and replying to buyers. Buyers can compare this score alongside your quote.</Text></> : <><ActivityIndicator color={palette.green} /><Text style={ui.body}>Loading your trust record…</Text></>}
  </View>;
}
export function AssignedRunnerTrust({ id }: { id: Id<'errands'> }) {
  const trust = useQuery(api.trust.forErrand, { id });
  if (!trust) return null;
  return <View style={ui.card}><Text style={ui.eyebrow}>YOUR RUNNER’S CURRENT RECORD</Text><TrustSummary trust={trust} /></View>;
}
export function TrustSuggestions({ id }: { id: Id<'errands'> }) {
  const data = useQuery(api.trust.recommendations, { id });
  if (!data || !data.candidates.length) return null;
  return <View style={[ui.card, { backgroundColor: palette.pale }]}>
    <Text style={ui.h2}>Trust-based suggestions</Text>
    <Text style={ui.body}>Ranked by recorded trust, then different buyers when scores tie. You can choose any available runner; ranking does not assign anyone.</Text>
    {data.candidates.map((candidate, index) => <View key={candidate.quoteId} style={{ gap: 4 }}><Text style={ui.h3}>{index + 1}. {candidate.name} · {candidate.trust.score}/100</Text><Text style={ui.small}>{historyLabels[candidate.trust.history]} · GH₵{(candidate.fee / 100).toFixed(2)} service fee</Text></View>)}
    <Text style={ui.small}>{data.capped ? 'Suggestions consider the 20 newest pending quotes only; use More quotes to compare the remaining runners.' : `Compared ${data.assessed} currently available runner${data.assessed === 1 ? '' : 's'}.`} New runners remain eligible. You make the final choice.</Text>
  </View>;
}
