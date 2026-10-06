import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, ui } from './customer-ui';

export function DashboardHeader({ role, name, onAccount }: { role: string; name?: string; onAccount: () => void }) {
  const initials = name?.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'ME';
  return <View style={ui.between}>
    <View><Text style={dashboardStyle.brand}>melange<Text style={{ color: palette.orange }}>.</Text></Text><Text style={dashboardStyle.role}>{role}</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Open account settings" onPress={onAccount} style={({ pressed }) => [dashboardStyle.avatar, pressed && { opacity: 0.65 }]}><Text style={ui.h3}>{initials}</Text></Pressable>
  </View>;
}

export function SectionHeading({ title, action, onPress }: { title: string; action?: string; onPress?: () => void }) {
  return <View style={[ui.between, { flexWrap: 'wrap' }]}><Text style={ui.h2}>{title}</Text>{action && onPress && <Pressable accessibilityRole="button" onPress={onPress} style={dashboardStyle.link}><Text style={dashboardStyle.linkText}>{action} →</Text></Pressable>}</View>;
}

export function DashboardAction({ title, subtitle, symbol, onPress }: { title: string; subtitle: string; symbol: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [dashboardStyle.action, pressed && { opacity: 0.65 }]}>
    <Text accessible={false} style={dashboardStyle.actionSymbol}>{symbol}</Text><Text style={ui.h3}>{title}</Text><Text style={ui.small}>{subtitle}</Text>
  </Pressable>;
}

export const dashboardStyle = StyleSheet.create({
  brand: { fontSize: 28, fontWeight: '800', letterSpacing: -1.5, color: palette.green },
  role: { color: palette.muted, fontSize: 10, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase', marginTop: 2 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#EAD5BA', alignItems: 'center', justifyContent: 'center' },
  section: { gap: 12 },
  title: { color: palette.ink, fontSize: 33, lineHeight: 39, letterSpacing: -1.2, fontWeight: '800' },
  link: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: palette.green, fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, backgroundColor: palette.pale, borderRadius: 16, padding: 14, gap: 5 },
  actionSymbol: { color: palette.green, fontSize: 24, marginBottom: 5 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: palette.line, minHeight: 66 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.pale, alignItems: 'center', justifyContent: 'center' },
  arrow: { fontSize: 21, color: palette.green },
  divider: { height: 1, backgroundColor: palette.line },
});
