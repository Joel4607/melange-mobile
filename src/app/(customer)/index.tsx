import { useRouter } from 'expo-router';
import { useConvexAuth, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CustomerPage, palette, ServiceLoading, ui, useServices } from '@/components/customer-ui';
import { DashboardHeader, SectionHeading, dashboardStyle as ds } from '@/components/dashboard-ui';
import NearbyRunners from '@/components/nearby-runners';

export default function HomeScreen() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.customers.me, isAuthenticated ? {} : 'skip');
  const recent = useQuery(api.errands.mine, isAuthenticated && me ? { paginationOpts: { numItems: 3, cursor: null } } : 'skip');
  const { services, connected, slow } = useServices();
  return <CustomerPage>
    <DashboardHeader role="Your everyday errands" name={me?.name} onAccount={() => router.navigate('/account')} />
    <View style={{ gap: 5 }}><Text style={ui.body}>Hello{me ? `, ${me.name.split(' ')[0]}` : ''}.</Text><Text style={ds.title}>A little help.{'\n'}A lot more day.</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Post a new errand" onPress={() => router.navigate('/post')} style={({ pressed }) => [styles.request, pressed && { opacity: 0.85 }]}>
      <View style={styles.requestTop}><View style={{ flex: 1, gap: 7 }}><Text style={styles.kicker}>LET’S GET IT DONE</Text><Text style={styles.requestTitle}>What needs doing?</Text><Text style={styles.requestBody}>Tell us the task. Find a helping hand.</Text></View><View accessible={false} style={styles.plus}><Text style={{ fontSize: 32, color: palette.green }}>+</Text></View></View>
      <View style={styles.requestBottom}><Text style={styles.requestLink}>Post an errand</Text><Text accessible={false} style={{ color: '#F3CA97', fontSize: 22 }}>↗</Text></View>
    </Pressable>
    <View style={ds.section}>
      <SectionHeading title="What do you need?" action="All services" onPress={() => router.navigate('/explore')} />
      {services === undefined ? <ServiceLoading slow={slow} /> : <View style={styles.grid}>{services.map(service => <Pressable key={service.id} accessibilityRole="button" accessibilityLabel={`Explore ${service.name}`} onPress={() => router.navigate({ pathname: '/explore', params: { category: service.id } })} style={({ pressed }) => [styles.service, pressed && { opacity: 0.65 }]}><View style={[styles.serviceIcon, { backgroundColor: service.color }]}><Text accessible={false} style={{ fontSize: 28 }}>{service.icon}</Text></View><Text style={styles.serviceName}>{service.name}</Text></Pressable>)}</View>}
    </View>
    {isAuthenticated && <View style={ds.section}>
      <SectionHeading title="Recent activity" action="All errands" onPress={() => router.navigate('/errands')} />
      {recent === undefined ? <ActivityIndicator color={palette.green} accessibilityLabel="Loading recent errands" /> : recent.page.length === 0 ? <Text style={ui.body}>Your errands will appear here. Post a task to get started.</Text> : recent.page.map(errand => <Pressable key={errand._id} accessibilityRole="button" accessibilityLabel={`Open ${errand.title}`} onPress={() => router.push({ pathname: '/errands/[id]', params: { id: errand._id } })} style={({ pressed }) => [ds.listRow, pressed && { opacity: 0.65 }]}>
        <View accessible={false} style={ds.rowIcon}><Text style={ds.arrow}>{errand.completion ? '✓' : '↗'}</Text></View>
        <View style={{ flex: 1, gap: 4 }}><Text style={ui.h3} numberOfLines={2}>{errand.title}</Text><Text style={ui.small}>{errand.trackingMode === 'demo' ? 'Demo · ' : ''}{errand.completion ? 'Completed' : errand.status === 'delivered' ? 'Delivered · confirm receipt' : errand.status.replace('_', ' ')}</Text><Text style={ui.small} numberOfLines={1}>{errand.dropoff}</Text></View><Text accessible={false} style={ds.arrow}>›</Text>
      </Pressable>)}
    </View>}
    <View style={ds.divider} />
    <NearbyRunners compact />
    <View style={styles.explainer}><Text style={ui.eyebrow}>YOUR CHOICE, EVERY STEP</Text><Text style={ui.h2}>A runner you can compare.</Text><Text style={ui.body}>Review runner trust records and quotes before choosing. Follow the delivery, then confirm it when it arrives.</Text><Pressable accessibilityRole="button" onPress={() => router.navigate(isAuthenticated ? '/errands' : '/post')} style={ds.link}><Text style={ds.linkText}>{isAuthenticated ? 'Manage your errands' : 'Start your first errand'} →</Text></Pressable></View>
    {!isAuthenticated && <Pressable accessibilityRole="button" onPress={() => router.push('/runner')} style={ds.listRow}><View style={{ flex: 1 }}><Text style={ui.h3}>Want to lend a hand?</Text><Text style={ui.small}>Sign up or sign in as a runner.</Text></View><Text accessible={false} style={ds.arrow}>→</Text></Pressable>}
    {!connected && <Text accessibilityLiveRegion="polite" style={ui.small}>Reconnecting… showing the last information received.</Text>}
  </CustomerPage>;
}

const styles = StyleSheet.create({
  request: { backgroundColor: palette.green, borderRadius: 22, overflow: 'hidden' },
  requestTop: { padding: 22, flexDirection: 'row', alignItems: 'center', gap: 14 },
  kicker: { color: '#EAC492', fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  requestTitle: { color: '#FFFCF5', fontSize: 25, lineHeight: 31, fontWeight: '700', letterSpacing: -0.6 },
  requestBody: { color: '#D2DFD4', fontSize: 13, lineHeight: 20 },
  plus: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F3CA97', alignItems: 'center', justifyContent: 'center' },
  requestBottom: { borderTopWidth: 1, borderTopColor: '#47695A', paddingHorizontal: 22, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestLink: { color: '#F3CA97', fontSize: 15, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 20 },
  service: { width: '31%', alignItems: 'center', gap: 9 },
  serviceIcon: { width: 68, height: 62, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  serviceName: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: palette.ink, textAlign: 'center' },
  explainer: { paddingVertical: 18, borderTopWidth: 1, borderTopColor: palette.line, gap: 8 },
});
