import { CurrentSharedRun } from '@/components/errand-share';
import { useConvexConnectionState, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useRouter } from 'expo-router';
import { RunnerAvailabilityControls } from '@/components/runner-location-sharing';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../../../../convex/_generated/api';
import { CustomerButton, CustomerPage, palette, ui } from '@/components/customer-ui';
import { DashboardAction, DashboardHeader, SectionHeading, dashboardStyle as ds } from '@/components/dashboard-ui';

type Dashboard = NonNullable<FunctionReturnType<typeof api.runners.dashboard>>;
type Assignment = Dashboard['active'][number];
function statusLabel(errand: Assignment) {
  return errand.confirmedAt !== null ? 'Completed' : errand.status === 'delivered' ? 'Awaiting buyer confirmation' : errand.status === 'picked_up' ? 'On the way' : 'Ready for pickup';
}

export default function RunnerDashboard() {
  const router = useRouter();
  const access = useQuery(api.runners.access, {});
  const dashboard = useQuery(api.runners.dashboard, {});
  const trust = useQuery(api.trust.mine, {});
  const { isWebSocketConnected } = useConvexConnectionState();
  return <CustomerPage>
    <DashboardHeader role="Runner workspace" name={access?.name} onAccount={() => router.push('/runner/settings')} />
    <View style={{ gap: 5 }}><Text style={ui.body}>Hello, {access?.name.split(/\s+/)[0] || 'runner'}.</Text><Text style={ds.title}>{dashboard?.active.length ? 'Your next stop awaits.' : 'Make your next move.'}</Text></View>
    {!isWebSocketConnected && <Text accessibilityLiveRegion="polite" style={ui.body}>Reconnecting… showing the last synced information.</Text>}
    {dashboard === undefined ? <View style={ds.section}><ActivityIndicator color={palette.green} /><Text style={ui.body}>Loading your dashboard…</Text></View> : dashboard === null ? <View style={ds.section}><Text style={ui.h3}>Loading your runner account</Text><Text style={ui.body}>Return to Settings and reopen your runner workspace if this continues.</Text></View> : <>
      <RunnerAvailabilityControls compact />
      <CurrentSharedRun />
      {dashboard.active.length > 0 ? <View style={ds.section}>
        <SectionHeading title="Your active errands" action="My jobs" onPress={() => router.push('/runner/history')} />
        {dashboard.active.map(errand => <ActiveRoute key={errand.id} errand={errand} />)}
        {dashboard.hasMoreActive && <Text style={ui.small}>Showing up to 10 errands at each active stage. Contact the administrator to review remaining assignments.</Text>}
      </View> : <Pressable accessibilityRole="button" onPress={() => router.push('/runner/available')} style={({ pressed }) => [styles.find, pressed && { opacity: 0.8 }]}>
        <Text style={styles.kicker}>YOUR NEXT OPPORTUNITY</Text><Text style={styles.findTitle}>A helping hand.{'\n'}Just around the corner.</Text><Text style={styles.findBody}>Explore requests and compatible shared runs.</Text><View style={styles.findFooter}><Text style={styles.findLink}>Find an errand</Text><Text accessible={false} style={styles.findLink}>↗</Text></View>
      </Pressable>}
      <View style={ds.actions}>
        <DashboardAction title="Pricing & quotes" subtitle="Set your service fees" symbol="≋" onPress={() => router.push('/runner/pricing')} />
        <DashboardAction title="Earnings history" subtitle="Your job records" symbol="↗" onPress={() => router.push('/runner/earnings')} />
      </View>
      {dashboard.active.length > 0 && <Pressable accessibilityRole="button" onPress={() => router.push('/runner/available')} style={ds.listRow}><View style={{ flex: 1 }}><Text style={ui.h3}>Explore available errands</Text><Text style={ui.small}>Ordinary requests and shared opportunities</Text></View><Text accessible={false} style={ds.arrow}>→</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Open your trust record in Settings" onPress={() => router.push('/runner/settings')} style={styles.trust}>
        <View style={styles.score}><Text style={styles.scoreValue}>{trust ? trust.score : '…'}</Text><Text style={styles.scoreMax}>/ 100</Text></View>
        <View style={{ flex: 1, gap: 4 }}><Text style={ui.h3}>Your trust record</Text><Text style={ui.small}>{trust ? trust.history === 'new' ? 'New runner · neutral starting score' : `${trust.history === 'limited' ? 'Limited' : 'Established'} history · ${trust.ratingCount ? `${trust.averageRating}/5 buyer rating` : 'No reviews yet'}` : 'Loading your record…'}</Text><Text style={ds.linkText}>See how it works →</Text></View>
      </Pressable>
      <View style={ds.section}>
        <SectionHeading title="Recent deliveries" action="All jobs" onPress={() => router.push('/runner/history')} />
        {dashboard.recentDeliveries.length === 0 ? <Text style={ui.body}>Your finished runs will appear here. Buyers confirm completion after delivery.</Text> : dashboard.recentDeliveries.map(errand => <Pressable key={errand.id} accessibilityRole="button" accessibilityLabel={`Open ${errand.title}`} onPress={() => router.push({ pathname: '/runner/errand', params: { id: errand.id } })} style={({ pressed }) => [ds.listRow, pressed && { opacity: 0.65 }]}>
          <View accessible={false} style={ds.rowIcon}><Text style={ds.arrow}>{errand.confirmedAt !== null ? '✓' : '◷'}</Text></View><View style={{ flex: 1, gap: 3 }}><Text numberOfLines={2} style={ui.h3}>{errand.title}</Text><Text style={ui.small}>{statusLabel(errand)}</Text>{errand.deliveredAt !== null && <Text style={ui.small}>{new Date(errand.deliveredAt).toLocaleDateString()}</Text>}</View><Text accessible={false} style={ds.arrow}>›</Text>
        </Pressable>)}
      </View>
      {dashboard.recentReviews.length > 0 && <View style={ds.section}><SectionHeading title="Latest buyer feedback" />{dashboard.recentReviews.map(review => <View key={review.id} style={styles.review}><View style={[ui.between, { flexWrap: 'wrap' }]}><Text accessibilityLabel={`${review.rating} out of 5 stars`} style={styles.stars}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</Text><Text style={ui.small}>{new Date(review.createdAt).toLocaleDateString()}</Text></View><Text style={ui.body}>{review.comment || 'The buyer left a rating without a comment.'}</Text></View>)}</View>}
      <Pressable accessibilityRole="button" onPress={() => router.push('/runner/profile')} style={ds.listRow}><View style={{ flex: 1 }}><Text style={ui.h3}>Put a face to your service.</Text><Text style={ui.small}>Update your photo, introduction and working area.</Text></View><Text accessible={false} style={ds.arrow}>→</Text></Pressable>
    </>}
  </CustomerPage>;
}

function ActiveRoute({ errand }: { errand: Assignment }) {
  const router = useRouter();
  return <View style={styles.route}>
    <Text style={ui.eyebrow}>{statusLabel(errand)}</Text><Text style={ui.h2}>{errand.title}</Text>
    <View style={styles.stops}>
      <View accessible={false} style={styles.routeLine} />
      <View style={styles.stop}><View accessible={false} style={styles.pickupDot} /><View style={{ flex: 1, gap: 3 }}><Text style={ui.small}>PICKUP</Text><Text style={ui.h3}>{errand.pickup}</Text></View></View>
      <View style={styles.stop}><View accessible={false} style={styles.dropoffDot} /><View style={{ flex: 1, gap: 3 }}><Text style={ui.small}>DELIVER TO</Text><Text style={ui.h3}>{errand.dropoff}</Text></View></View>
    </View>
    <Text style={ui.small}>Errand budget · GH₵ {(errand.budgetPesewas / 100).toFixed(2)}</Text>
    <CustomerButton onPress={() => router.push({ pathname: '/runner/errand', params: { id: errand.id } })}>Continue errand →</CustomerButton>
    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/runner/chat', params: { id: errand.id } })} style={[ds.link, { alignItems: 'center' }]}><Text style={ds.linkText}>Message buyer</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  find: { backgroundColor: palette.green, borderRadius: 22, padding: 22, gap: 12 },
  kicker: { color: '#EAC492', fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  findTitle: { fontSize: 27, lineHeight: 34, letterSpacing: -0.6, fontWeight: '700', color: '#FFFCF5' },
  findBody: { color: '#D2DFD4', fontSize: 13, lineHeight: 21 },
  findFooter: { borderTopWidth: 1, borderTopColor: '#47695A', paddingTop: 16, marginTop: 3, flexDirection: 'row', justifyContent: 'space-between' },
  findLink: { fontSize: 16, color: '#F3CA97', fontWeight: '700' },
  route: { borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: '#FFFFFF', padding: 20, gap: 12 },
  stops: { gap: 25, marginVertical: 8 },
  stop: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  routeLine: { position: 'absolute', top: 14, bottom: 20, left: 5, width: 2, backgroundColor: '#D6DFD5' },
  pickupDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: palette.green, borderWidth: 3, borderColor: '#D6DFD5', marginTop: 5 },
  dropoffDot: { width: 12, height: 12, borderRadius: 2, backgroundColor: palette.orange, marginTop: 5 },
  trust: { flexDirection: 'row', gap: 16, alignItems: 'center', paddingVertical: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.line },
  score: { width: 72, height: 72, borderRadius: 36, backgroundColor: palette.pale, justifyContent: 'center', alignItems: 'center' },
  scoreValue: { color: palette.green, fontSize: 27, fontWeight: '800', letterSpacing: -1 },
  scoreMax: { color: palette.muted, fontSize: 10 },
  review: { gap: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: palette.line },
  stars: { color: palette.orange, fontSize: 18, letterSpacing: 2 },
});
