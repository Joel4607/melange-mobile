import { NotificationSettings, usePushNotifications } from '@/components/push-notifications';
import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth, useConvexConnectionState, useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import Constants from 'expo-constants';

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../../convex/_generated/api';
import { CustomerAuth } from '@/components/customer-auth';
import { CustomerButton, CustomerField, CustomerPage, FormError, palette, ui } from '@/components/customer-ui';

type Panel = 'profile' | 'address' | 'help' | 'about' | 'signOut' | 'signIn';
const version = Constants.expoConfig?.version ?? '1.0.0';
const titles: Record<Panel, string> = { profile: 'Personal details', address: 'Delivery address', help: 'Help & guidance', about: 'About Melange', signOut: 'Sign out', signIn: 'Your account' };

export default function SettingsScreen() {
  const push = usePushNotifications();

  const { isAuthenticated, isLoading } = useConvexAuth();
  const me = useQuery(api.customers.me, isAuthenticated ? {} : 'skip');
  const preferences = useQuery(api.customers.preferences, isAuthenticated ? {} : 'skip');

  const { isWebSocketConnected } = useConvexConnectionState();
  const updateName = useMutation(api.customers.updateName);
  const updateAddress = useMutation(api.customers.updateDeliveryAddress);
  const { signOut } = useAuthActions();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  const loadingProfile = isLoading || (isAuthenticated && (!me || !preferences));

  useEffect(() => {
    if (panel === 'signIn' && isAuthenticated) setPanel(null);
    if (!isLoading && !isAuthenticated && (panel === 'profile' || panel === 'address' || panel === 'signOut')) {
      setPanel(null); setDraft(''); setError('');
    }
  }, [panel, isAuthenticated, isLoading]);

  function open(next: Panel) {
    setError(''); setNotice('');
    setDraft(next === 'profile' ? me?.name ?? '' : next === 'address' ? preferences?.deliveryAddress ?? '' : '');
    setPanel(next);
  }
  function close() { if (!locked.current) { setPanel(null); setError(''); setDraft(''); } }
  async function save() {
    if (locked.current || (panel !== 'profile' && panel !== 'address')) return;
    const value = draft.trim();
    if (panel === 'profile' && (value.length < 2 || value.length > 80)) return setError('Enter a name of 2–80 characters.');
    if (panel === 'address' && value.length > 0 && value.length < 3) return setError('Enter at least 3 characters, or leave the address empty.');
    const savingProfile = panel === 'profile';
    locked.current = true; setBusy(true); setError('');
    try {
      if (savingProfile) await updateName({ name: value });
      else await updateAddress({ deliveryAddress: value });
      setPanel(null); setDraft('');
      setNotice(savingProfile ? 'Your profile has been updated.' : value ? 'Default delivery address saved.' : 'Default delivery address removed.');
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not save your changes. Please try again.');
    } finally { locked.current = false; setBusy(false); }
  }
  async function logout() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await push?.disable(); await signOut(); setPanel(null); setNotice('You have signed out.'); }
    catch { setError('Could not sign out. Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }

  return <>
    <CustomerPage>
      <View style={{ gap: 6 }}><Text style={ui.eyebrow}>MAKE YOURSELF AT HOME</Text><Text style={ui.title}>Settings</Text><Text style={ui.body}>Your details, your preferences, your Melange.</Text></View>
      <View style={styles.profile}>
        <View style={styles.avatar}><Text style={styles.initials}>{me?.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'M'}</Text></View>
        <View style={{ flex: 1, gap: 4 }}><Text style={ui.h2}>{loadingProfile ? 'Loading your profile…' : me?.name ?? 'Welcome to Melange'}</Text><Text style={ui.small}>{me?.email ?? 'Sign in to make it yours.'}</Text><Text style={styles.customerLabel}>{isAuthenticated ? 'CUSTOMER ACCOUNT' : 'BROWSING AS A GUEST'}</Text></View>
      </View>
      {loadingProfile && <ActivityIndicator color={palette.green} />}
      {notice ? <View accessibilityLiveRegion="polite" style={styles.notice}><Text style={[ui.body, { color: palette.green }]}>{notice}</Text></View> : null}
      {!isAuthenticated && !isLoading && <CustomerButton onPress={() => open('signIn')}>Sign in or create an account</CustomerButton>}
      {isAuthenticated && <View style={styles.section}>
        <Text style={styles.sectionLabel}>ACCOUNT & PREFERENCES</Text>
        <View style={styles.group}>
          <SettingsRow icon="◎" title="Personal details" detail="Your name and sign-in email" disabled={loadingProfile} onPress={() => open('profile')} />
          <SettingsRow icon="⌖" title="Default delivery address" detail={preferences?.deliveryAddress || 'Save an address for quicker posting'} disabled={loadingProfile} onPress={() => open('address')} last />
        </View>
      </View>}
      {isAuthenticated && <NotificationSettings />}
      <View style={styles.section}><Text style={styles.sectionLabel}>HELP & INFORMATION</Text><View style={styles.group}>
        <SettingsRow icon="?" title="Help & guidance" detail="Answers to common questions" onPress={() => open('help')} />
        <SettingsRow icon="i" title="About Melange" detail="What you can do in this version" onPress={() => open('about')} last />
      </View></View>
      {isAuthenticated && <Pressable accessibilityRole="button" onPress={() => open('signOut')} style={styles.signOut}><Text style={styles.signOutText}>Sign out</Text><Text style={styles.signOutText}>↗</Text></Pressable>}
      <View style={{ alignItems: 'center', gap: 4 }}><Text style={styles.brand}>melange.</Text><Text style={ui.small}>A little help goes a long way.</Text><Text style={styles.version}>Version {version} · Melange prototype</Text></View>
    </CustomerPage>
    <Modal visible={panel !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView edges={['top', 'left', 'right']} style={ui.screen}>
        <View style={styles.modalHeader}><Text style={ui.h3}>{panel ? titles[panel] : ''}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close settings detail" disabled={busy} onPress={close} style={styles.close}><Text style={ui.h3}>Close</Text></Pressable></View>
        {panel === 'signIn' ? <CustomerAuth /> : <CustomerPage>
          {(panel === 'profile' || panel === 'address') && <>
            <Text style={ui.title}>{panel === 'profile' ? 'A name that feels like you.' : 'Where should we deliver?'}</Text>
            <Text style={ui.body}>{panel === 'profile' ? 'This is how we greet you in Melange.' : 'We’ll use this address to start new errand forms. You can change it for each request.'}</Text>
            <CustomerField label={panel === 'profile' ? 'Your name' : 'Default delivery address'} value={draft} onChangeText={setDraft} maxLength={panel === 'profile' ? 80 : 300} multiline={panel === 'address'} editable={!busy} autoComplete={panel === 'profile' ? 'name' : 'street-address'} placeholder={panel === 'address' ? 'House number, street, neighbourhood and landmark' : 'Your name'} />
            {panel === 'profile' ? <View style={ui.card}><Text style={ui.h3}>Sign-in email</Text><Text style={ui.body}>{me?.email}</Text><Text style={ui.small}>Your email is linked to your sign-in. Changing it and resetting your password are not available in this prototype.</Text></View> : <Text style={ui.small}>Leave this field empty and save to remove your default address. Existing errands keep their original delivery addresses.</Text>}
            <FormError message={error} />
            {!isWebSocketConnected && <Text style={ui.body}>{busy ? 'Reconnecting… your changes will save when the connection returns.' : 'Connect to the internet to save your changes.'}</Text>}
            <CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</CustomerButton>
            <CustomerButton disabled={busy} onPress={close}>Cancel</CustomerButton>
          </>}
          {panel === 'help' && <><Text style={ui.title}>A little guidance.</Text>{[
            ['How do I post an errand?', 'Open Post, choose a service, add your instructions, pickup and delivery addresses, and budget. Review the details, then confirm to save your request.'],
            ['Where are my saved errands?', 'Open Errands while signed in. Use the same account to see your requests again on another visit.'],
            ['Has a runner been assigned?', 'Open an errand to see its status and tracking map. Demo routes are labelled as simulations. When a runner accepts your request, its status updates automatically and your private chat opens.'],
            ['Will I be charged?', 'No payments are collected in this prototype. The budget is the amount you propose for your errand.'],
            ['Can I recover my password?', 'Password recovery is not available yet. Keep your prototype account password somewhere safe.'],
          ].map(([question, answer]) => <View key={question} style={ui.card}><Text style={ui.h3}>{question}</Text><Text style={ui.body}>{answer}</Text></View>)}</>}
          {panel === 'about' && <><Text style={styles.brand}>melange.</Text><Text style={ui.title}>More room for your day.</Text><Text style={ui.body}>Melange helps you organize everyday errands, from grocery runs to parcel pickups.</Text><View style={ui.card}><Text style={ui.h3}>Melange prototype · Version {version}</Text><Text style={ui.body}>Post and manage errands, follow tracking, send text and images, confirm completion and leave a review.</Text><Text style={ui.small}>Choose Buyer or Runner when creating your account to open the matching dashboard. Runners can find and accept requests. Payment collection is not available yet.</Text></View></>}
          {panel === 'signOut' && <><Text style={ui.title}>Signing out?</Text><Text style={ui.body}>Your saved errands and settings stay with your account. You’ll need your email and password to return. Any unfinished errand form on this device will be cleared.</Text><FormError message={error} /><CustomerButton disabled={busy} onPress={() => void logout()}>{busy ? 'Signing out…' : 'Yes, sign out'}</CustomerButton><CustomerButton disabled={busy} onPress={close}>Stay signed in</CustomerButton></>}
        </CustomerPage>}
      </SafeAreaView>
    </Modal>
  </>;
}

function SettingsRow({ icon, title, detail, onPress, disabled = false, last = false }: { icon: string; title: string; detail: string; onPress: () => void; disabled?: boolean; last?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.separator, { opacity: disabled ? 0.5 : pressed ? 0.65 : 1 }]}>
    <View style={styles.rowIcon}><Text style={styles.rowGlyph}>{icon}</Text></View><View style={{ flex: 1, gap: 3 }}><Text style={ui.h3}>{title}</Text><Text style={ui.small} numberOfLines={2}>{detail}</Text></View><Text style={styles.chevron}>›</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  profile: { backgroundColor: '#EEF0E5', borderRadius: 24, padding: 20, gap: 16, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  customerLabel: { color: palette.green, fontSize: 9, letterSpacing: 1.3, fontWeight: '700', marginTop: 5 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, color: palette.muted, marginLeft: 5 },
  group: { borderRadius: 21, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: palette.line, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 17, gap: 13, minHeight: 86 },
  separator: { borderBottomWidth: 1, borderBottomColor: palette.line },
  rowIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: palette.pale, alignItems: 'center', justifyContent: 'center' },
  rowGlyph: { fontSize: 23, color: palette.green, fontWeight: '600' },
  chevron: { fontSize: 27, color: palette.muted },
  signOut: { borderRadius: 16, padding: 18, backgroundColor: '#F8EAE3', flexDirection: 'row', justifyContent: 'space-between' },
  signOutText: { color: '#A64430', fontSize: 15, fontWeight: '700' },
  brand: { fontSize: 26, fontWeight: '800', letterSpacing: -1, color: palette.green },
  version: { color: palette.muted, fontSize: 10, marginTop: 5 },
  notice: { padding: 15, borderRadius: 14, backgroundColor: palette.pale },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.line },
  close: { padding: 13, minHeight: 44 },
});
