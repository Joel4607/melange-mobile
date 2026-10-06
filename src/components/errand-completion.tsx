import { useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { CustomerButton, CustomerField, FormError, palette, ui } from './customer-ui';

const ratingLabels = ['Choose a rating', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
function errorMessage(error: unknown, fallback: string) {
  return error instanceof ConvexError && typeof error.data === 'string' ? error.data : fallback;
}

export function ErrandCompletion({ errand }: { errand: Doc<'errands'> }) {
  const details = useQuery(api.reviews.forErrand, { id: errand._id });
  const options = useQuery(api.errands.trackingOptions);
  const { isWebSocketConnected } = useConvexConnectionState();
  const confirm = useMutation(api.errands.confirmCompletion);
  const submit = useMutation(api.reviews.submit);
  const router = useRouter();
  const [confirmationRevision, setConfirmationRevision] = useState<number | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const demo = errand.completion?.isDemo ?? errand.trackingMode === 'demo';
  const demoDisabled = demo && !options?.demoEnabled;

  async function confirmDelivery() {
    if (locked.current || confirmationRevision === null) return;
    locked.current = true; setBusy(true); setError('');
    try { await confirm({ id: errand._id, expectedRevision: confirmationRevision }); setConfirmationRevision(null); }
    catch (err) { setError(errorMessage(err, 'Could not confirm completion. Please try again.')); setConfirmationRevision(null); }
    finally { locked.current = false; setBusy(false); }
  }
  async function saveReview() {
    if (locked.current || !rating) return;
    locked.current = true; setBusy(true); setError('');
    try { await submit({ id: errand._id, rating, comment }); }
    catch (err) { setError(errorMessage(err, 'Could not save your review. Your draft is still here. Please retry.')); }
    finally { locked.current = false; setBusy(false); }
  }

  if (!errand.completion) return <View style={[ui.card, styles.highlight]}>
    <Text style={ui.eyebrow}>{demo ? 'DEMO · CONFIRM DELIVERY' : 'CONFIRM DELIVERY'}</Text>
    <Text style={ui.h2}>Have you received everything?</Text>
    <Text style={ui.body}>{demo ? 'The simulated delivery is ready. Try the customer confirmation step to finish this demo errand.' : 'Your runner has marked this errand as delivered. Check that your items arrived before confirming.'}</Text>
    <FormError message={error} />
    {demoDisabled && <Text style={ui.small}>Demo completion is currently unavailable.</Text>}
    {!isWebSocketConnected && <Text style={ui.small}>{busy ? 'Reconnecting… waiting to finish confirmation.' : 'Connect to confirm delivery.'}</Text>}
    {confirmationRevision === null ? <CustomerButton disabled={busy || !isWebSocketConnected || demoDisabled} onPress={() => { setError(''); setConfirmationRevision(errand.revision ?? 0); }}>Confirm delivery</CustomerButton> : <>
      <Text style={ui.h3}>{demo ? 'Complete this simulated errand?' : 'Confirm that you received the delivery?'}</Text>
      <Text style={ui.small}>This completes the errand and makes chat read-only. You can leave a review now or later.</Text>
      <CustomerButton disabled={busy || !isWebSocketConnected || demoDisabled} onPress={() => void confirmDelivery()}>{busy ? 'Confirming…' : demo ? 'Yes, complete demo errand' : 'Yes, I received everything'}</CustomerButton>
      <CustomerButton disabled={busy} onPress={() => setConfirmationRevision(null)}>Not yet</CustomerButton>
    </>}
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.push({ pathname: '/errands/chat', params: { id: errand._id } })} style={{ paddingVertical: 10 }}><Text style={[ui.h3, { textAlign: 'center' }]}>Need to check something? Open chat</Text></Pressable>
  </View>;

  return <View style={[ui.card, styles.highlight]}>
    <View style={ui.between}><Text style={ui.h2}>✓ Errand completed</Text>{demo && <View style={ui.badge}><Text style={ui.badgeText}>DEMO</Text></View>}</View>
    <Text style={ui.small}>Confirmed {new Date(errand.completion.confirmedAt).toLocaleString()}</Text>
    {demo && <Text style={ui.body}>This is a practice review. It does not affect a real runner’s rating.</Text>}
    {details === undefined ? <ActivityIndicator color={palette.green} /> : details.review ? <>
      <Text style={ui.h3}>Your review for {details.runnerName}</Text>
      <Text accessibilityLabel={`${details.review.rating} out of 5 stars`} style={styles.savedStars}>{'★'.repeat(details.review.rating)}{'☆'.repeat(5 - details.review.rating)}</Text>
      <Text style={ui.body}>{ratingLabels[details.review.rating]}</Text>
      {!!details.review.comment && <Text selectable style={ui.body}>{details.review.comment}</Text>}
      <Text style={ui.small}>Review saved {new Date(details.review._creationTime).toLocaleDateString()}. Thank you for your feedback.</Text>
    </> : later ? <>
      <Text style={ui.h3}>You can review this errand later.</Text><Text style={ui.body}>Return to this errand whenever you’re ready to leave feedback.</Text>
      <CustomerButton onPress={() => setLater(false)}>Write a review</CustomerButton>
    </> : <>
      <Text style={ui.h2}>How did {details.runnerName} do?</Text>
      <Text style={ui.body}>Choose 1–5 stars and optionally share what went well or could improve.</Text>
      <View style={styles.stars}>{[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`${value} ${value === 1 ? 'star' : 'stars'}: ${ratingLabels[value]}`} accessibilityState={{ checked: rating === value, disabled: busy || !details.canWrite }} disabled={busy || !details.canWrite} onPress={() => { setRating(value); setError(''); }} style={styles.star}><Text style={{ fontSize: 34, color: value <= rating ? palette.orange : '#BBC5BE' }}>{value <= rating ? '★' : '☆'}</Text></Pressable>)}</View>
      <Text accessibilityLiveRegion="polite" style={ui.h3}>{ratingLabels[rating]}</Text>
      <CustomerField label="Your feedback (optional)" placeholder="Tell us about your experience…" value={comment} onChangeText={setComment} maxLength={1000} multiline editable={!busy && details.canWrite} />
      <Text style={ui.small}>{comment.length}/1000 · One review per errand. Check it before submitting.</Text>
      <FormError message={error} />
      {!details.canWrite && <Text style={ui.small}>Reviews are currently unavailable for this errand.</Text>}
      {!isWebSocketConnected && <Text style={ui.small}>{busy ? 'Reconnecting… waiting to save your review.' : 'Reconnect to submit. Your draft stays here.'}</Text>}
      <CustomerButton disabled={busy || !rating || !isWebSocketConnected || !details.canWrite} onPress={() => void saveReview()}>{busy ? 'Saving review…' : 'Submit review'}</CustomerButton>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setLater(true); setError(''); }} style={{ paddingVertical: 10 }}><Text style={[ui.h3, { textAlign: 'center' }]}>I’ll review later</Text></Pressable>
    </>}
  </View>;
}
const styles = StyleSheet.create({
  highlight: { borderColor: '#CBD8C9', backgroundColor: '#FCFDF9' },
  stars: { flexDirection: 'row', justifyContent: 'space-between', maxWidth: 300 },
  star: { minHeight: 48, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  savedStars: { fontSize: 28, letterSpacing: 4, color: palette.orange },
});
