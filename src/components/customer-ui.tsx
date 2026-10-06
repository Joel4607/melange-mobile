import { useConvexConnectionState, useQuery } from 'convex/react';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../convex/_generated/api';
import { usePullToRefresh } from './app-refresh';

export const palette = { background: '#F8F6F0', ink: '#213E36', green: '#234E40', muted: '#6D7972', pale: '#EAF0E7', orange: '#B95629', line: '#E4E7DE' };

export function useServices() {
  const services = useQuery(api.catalogue.list, {});
  const connection = useConvexConnectionState();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (services !== undefined) { setSlow(false); return; }
    const timer = setTimeout(() => setSlow(true), 12000);
    return () => clearTimeout(timer);
  }, [services]);
  return { services, connected: connection.isWebSocketConnected, slow };
}
export function CustomerPage({ children }: PropsWithChildren) {
  const refresh = usePullToRefresh();
  return <SafeAreaView edges={['top', 'left', 'right']} style={ui.screen}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[ui.page, { flexGrow: 1 }]} showsVerticalScrollIndicator={false} alwaysBounceVertical refreshControl={refresh.enabled ? <RefreshControl refreshing={refresh.refreshing} onRefresh={() => { void refresh.onRefresh(); }} tintColor={palette.green} colors={[palette.green]} progressBackgroundColor={palette.background} accessibilityLabel="Refresh this page" /> : undefined}>{!!refresh.error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: '#A33423', fontSize: 14, lineHeight: 22 }}>{refresh.error}</Text>}{children}</ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export function CustomerButton({ children, onPress, disabled = false }: PropsWithChildren<{ onPress: () => void; disabled?: boolean }>) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [ui.button, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}><Text style={ui.buttonText}>{children}</Text></Pressable>;
}
export function CustomerField({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return <View style={{ gap: 7 }}><Text style={ui.h3}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={palette.muted} {...props} style={[ui.input, props.multiline && { minHeight: 110, textAlignVertical: 'top' }, props.style]} />{hint && <Text style={ui.small}>{hint}</Text>}</View>;
}
export function FormError({ message }: { message: string }) {
  return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: '#A33423', fontSize: 14, lineHeight: 22 }}>{message}</Text> : null;
}
export function ServiceLoading({ slow }: { slow: boolean }) {
  return <View style={ui.card} accessibilityLiveRegion="polite"><View style={ui.row}><ActivityIndicator color={palette.green} /><Text style={ui.h3}>{slow ? 'Taking a little longer…' : 'Loading our services…'}</Text></View><Text style={ui.body}>{slow ? 'Check your internet connection. We’ll reconnect automatically.' : 'Getting the latest service list.'}</Text></View>;
}
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  page: { padding: 22, paddingBottom: 110, gap: 23, width: '100%', maxWidth: 600, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: palette.ink, fontSize: 31, lineHeight: 38, letterSpacing: -1, fontWeight: '800' },
  h2: { color: palette.ink, fontSize: 21, lineHeight: 28, fontWeight: '700' },
  h3: { color: palette.ink, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  body: { color: palette.muted, fontSize: 14, lineHeight: 23 },
  small: { color: palette.muted, fontSize: 12, lineHeight: 19 },
  eyebrow: { color: palette.orange, fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  card: { padding: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: palette.line, borderRadius: 22, gap: 12 },
  badge: { backgroundColor: palette.pale, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20 },
  badgeText: { color: palette.green, fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  button: { backgroundColor: '#F3CA97', padding: 16, borderRadius: 15, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: palette.ink, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  icon: { height: 48, width: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  input: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: palette.line, borderRadius: 14, padding: 15, minHeight: 52, color: palette.ink, fontSize: 16 },
});
