import { useConvexConnectionState, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import type { FunctionReturnType } from 'convex/server';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { CustomerButton, CustomerField, FormError, ui } from './customer-ui';
import { RunnerAvatar } from './runner-photo';
import { TrustSummary } from './runner-trust';
import { rankBuyerQuotes } from '../../convex/lib/trustScore';

export const money = (pesewas: number) => `GH₵${(pesewas / 100).toFixed(2)}`;
export function parseFee(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()) || Number(value) < 1 || Number(value) > 10000) throw new Error('Enter GH₵1–10,000 with up to two decimal places.');
  return Math.round(Number(value) * 100);
}
export function usePriceAction() {
  const { isWebSocketConnected: connected } = useConvexConnectionState();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const locked = useRef(false);
  async function run(action: () => Promise<unknown>) {
    if (locked.current || !connected) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (err) { setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : err instanceof Error ? err.message : 'Could not save. Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return { busy, error, disabled: busy || !connected, run };
}
type RunnerJob = NonNullable<FunctionReturnType<typeof api.runnerJobs.get>>;
export function RunnerQuote({ errand }: { errand: RunnerJob }) {
  const quote = useQuery(api.pricing.myQuote, { id: errand.id });
  const rates = useQuery(api.pricing.mine, {});
  if (quote === undefined || rates === undefined) return <Text style={ui.body}>Loading your pricing…</Text>;
  return <QuoteForm key={`${errand.id}:${errand.revision}:${quote?.version ?? 0}`} errand={errand} quote={quote} startingFee={rates.find(r => r.category === errand.category)?.startingFeePesewas} />;
}
function QuoteForm({ errand, quote, startingFee }: { errand: RunnerJob; quote: FunctionReturnType<typeof api.pricing.myQuote>; startingFee?: number }) {
  const router = useRouter(); const action = usePriceAction();
  const submit = useMutation(api.pricing.submitQuote); const close = useMutation(api.pricing.closeQuote);
  const [amount, setAmount] = useState(((quote?.serviceFeePesewas ?? startingFee ?? 0) / 100).toFixed(2));
  const [note, setNote] = useState(quote?.note ?? '');
  const [review, setReview] = useState(false);
  return <View style={ui.card}>
    <Text style={ui.h2}>Your service fee</Text><Text style={ui.body}>The buyer must approve your fee before you are assigned. Item purchases and reimbursements are separate; arrange them in chat after approval.</Text>
    {quote && <Text accessibilityLiveRegion="polite" style={ui.h3}>{quote.status === 'pending' ? quote.errandRevision === errand.revision ? `Awaiting buyer approval · ${money(quote.serviceFeePesewas)}` : 'The buyer edited this request. Review it and submit a new quote.' : `Previous quote: ${quote.status}`}</Text>}
    {startingFee === undefined ? <><Text style={ui.body}>Set a starting price for this service before quoting.</Text><CustomerButton onPress={() => router.push('/runner/pricing')}>Open My pricing</CustomerButton></> : <>
      <Text style={ui.small}>Your published starting fee: {money(startingFee)}. The final fee may differ for this job.</Text>
      <CustomerField label="Service fee (GH₵)" value={amount} onChangeText={value => { setAmount(value); setReview(false); }} editable={!action.busy} keyboardType="decimal-pad" maxLength={8} />
      <CustomerField label="Price explanation (optional)" value={note} onChangeText={value => { setNote(value); setReview(false); }} editable={!action.busy} multiline maxLength={500} placeholder="For example, the longer delivery distance" />
      {review && <Text style={ui.h3}>Submit a service fee of GH₵{Number(amount).toFixed(2)}? This does not assign the errand or collect payment.</Text>}
      <CustomerButton disabled={action.disabled || !errand.canAccept} onPress={() => void action.run(async () => {
        const serviceFeePesewas = parseFee(amount);
        if (!review) { setReview(true); return; }
        await submit({ id: errand.id, expectedRevision: errand.revision, expectedVersion: quote?.version ?? 0, serviceFeePesewas, note }); setReview(false);
      })}>{action.busy ? 'Saving…' : review ? 'Confirm & send quote' : 'Review quote'}</CustomerButton>
    </>}
    {!errand.canAccept && <Text style={ui.body}>{errand.blockedReason}</Text>}
    {quote?.status === 'pending' && <CustomerButton disabled={action.disabled} onPress={() => void action.run(() => close({ quoteId: quote._id, expectedVersion: quote.version }))}>Withdraw quote</CustomerButton>}
    <FormError message={action.error} />
  </View>;
}
export function BuyerQuotes({ id, revision }: { id: Id<'errands'>; revision: number }) {
  const { results, status, loadMore } = usePaginatedQuery(api.pricing.forBuyer, { id }, { initialNumItems: 20 });
  // Load bounded pages before ranking, so an older, better-scoring quote is
  // not hidden behind newer quotes. No quote is selected by this effect.
  useEffect(() => { if (status === 'CanLoadMore') loadMore(20); }, [status, loadMore]);
  const ranked = useMemo(() => rankBuyerQuotes(results), [results]);
  const eligible = ranked.filter(quote => quote.canApprove);
  const unavailable = ranked.filter(quote => !quote.canApprove);
  const ready = status === 'Exhausted';
  return <View style={{ gap: 12 }}><Text style={ui.h2}>Choose your runner</Text><Text style={ui.body}>Available quotes are ranked by trust, highest first. You can choose any available runner. Your selection is confirmed only when you approve their fee.</Text>
    <Text style={ui.small}>Equal scores are ordered by the number of different buyers served, then a stable order. Price does not change the trust ranking. Pay the runner directly using your agreed method.</Text>
    {!ready ? <Text style={ui.body}>Loading all quotes to compare trust…</Text> : <>
      {results.length === 0 ? <Text style={ui.body}>No quotes yet. Your request is available to runners.</Text> : eligible.length === 0 && <Text style={ui.body}>No runners are available to choose from these quotes right now.</Text>}
      {eligible.map((quote, index) => <BuyerQuoteCard key={`${quote._id}:${quote.version}:${revision}`} quote={quote} revision={revision} rank={index + 1} />)}
      {unavailable.length > 0 && <Text style={ui.h3}>Previous or unavailable quotes</Text>}
      {unavailable.map(quote => <BuyerQuoteCard key={`${quote._id}:${quote.version}:${revision}`} quote={quote} revision={revision} />)}
    </>}
  </View>;
}
function BuyerQuoteCard({ quote, revision, rank }: { quote: FunctionReturnType<typeof api.pricing.forBuyer>['page'][number]; revision: number; rank?: number }) {
  const action = usePriceAction(); const approve = useMutation(api.pricing.approveQuote); const close = useMutation(api.pricing.closeQuote);
  const [review, setReview] = useState(false);
  return <View style={ui.card}>{rank !== undefined && <Text style={ui.eyebrow}>TRUST RANK {rank}</Text>}<View style={ui.row}><RunnerAvatar url={quote.runnerPhotoUrl} name={quote.runnerName} size={48} /><Text style={[ui.h2, { flex: 1 }]}>{quote.runnerName}</Text></View>{!!quote.runnerBio && <Text style={ui.body}>{quote.runnerBio}</Text>}<Text style={ui.title}>{money(quote.serviceFeePesewas)}</Text><Text style={ui.small}>Final service fee · item costs excluded</Text>
    {quote.startingFeePesewas !== undefined && <Text style={ui.small}>Published starting price when quoted: {money(quote.startingFeePesewas)}</Text>}
    {!!quote.note && <Text style={ui.body}>{quote.note}</Text>}
    {quote.trust && <TrustSummary trust={quote.trust} />}
    {quote.canApprove ? <>
      {review && <Text style={ui.h3}>Agree to {money(quote.serviceFeePesewas)} and assign {quote.runnerName}? Item costs remain separate. No payment is collected by Melange.</Text>}
      <CustomerButton disabled={action.disabled} onPress={() => review ? void action.run(() => approve({ quoteId: quote._id, expectedVersion: quote.version, expectedRevision: revision })) : setReview(true)}>{action.busy ? 'Saving…' : review ? 'Confirm fee & assign runner' : 'Review & choose runner'}</CustomerButton>
      <CustomerButton disabled={action.disabled} onPress={() => review ? setReview(false) : void action.run(() => close({ quoteId: quote._id, expectedVersion: quote.version }))}>{review ? 'Keep comparing' : 'Decline quote'}</CustomerButton>
    </> : <Text style={ui.body}>{quote.reason}</Text>}<FormError message={action.error} />
  </View>;
}
export function DirectPayment({ id, runner = false }: { id: Id<'errands'>; runner?: boolean }) {
  const data = useQuery(api.pricing.payment, { id }); const action = usePriceAction();
  const sent = useMutation(api.pricing.markSent); const received = useMutation(api.pricing.confirmReceived);
  const [method, setMethod] = useState(''); const [confirm, setConfirm] = useState(false);
  if (data === undefined) return <Text style={ui.body}>Loading fee agreement…</Text>;
  if (!data) return null;
  return <View style={ui.card}><Text style={ui.h2}>Service fee & direct payment</Text>
    {data.agreed ? <><Text style={ui.title}>{money(data.agreed.serviceFeePesewas)}</Text><Text style={ui.small}>Agreed {new Date(data.agreed.agreedAt).toLocaleString()} · excludes item purchases</Text></> : <Text style={ui.body}>This older errand has no recorded fee agreement. Discuss the price and payment directly in chat.</Text>}
    <Text style={ui.body}>Arrange MoMo or another payment method in your private chat. Melange does not collect or verify payments. The records below are confirmations from you and your {runner ? 'buyer' : 'runner'}.</Text>
    {data.payment ? <><Text style={ui.h3}>{data.payment.receivedAt ? 'Runner confirmed receipt' : 'Buyer reports payment sent'}</Text><Text style={ui.body}>{data.payment.method} · buyer reported {new Date(data.payment.sentAt).toLocaleString()}</Text>{data.payment.receivedAt && <Text style={ui.small}>Receipt confirmed {new Date(data.payment.receivedAt).toLocaleString()}</Text>}</> : data.agreed && <Text style={ui.body}>No service-fee payment reported yet.</Text>}
    {data.canRecord && ((!runner && !data.payment) || (runner && data.payment && !data.payment.receivedAt)) && <>
      {!runner && <CustomerField label="Payment method" placeholder="For example, MTN MoMo" hint="Method only. Share payment account details in private chat." value={method} onChangeText={value => { setMethod(value); setConfirm(false); }} maxLength={80} editable={!action.busy} />}
      {confirm && <Text style={ui.h3}>{runner ? 'Confirm only after checking that the full service fee reached your account.' : 'Confirm only after sending the full agreed service fee to the runner.'}</Text>}
      <CustomerButton disabled={action.disabled || (!runner && !method.trim())} onPress={() => confirm ? void action.run(() => runner ? received({ id }) : sent({ id, method })) : setConfirm(true)}>{action.busy ? 'Saving…' : confirm ? runner ? 'Yes, I received the full fee' : 'Yes, I sent the full fee' : runner ? 'Confirm receipt' : 'Mark service fee sent'}</CustomerButton>
      {confirm && <CustomerButton disabled={action.busy} onPress={() => setConfirm(false)}>Cancel</CustomerButton>}
    </>}<FormError message={action.error} />
  </View>;
}
