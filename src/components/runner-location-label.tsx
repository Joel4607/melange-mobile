import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { palette, ui } from './customer-ui';

export function LocationLabel({ label }: { label?: string | null }) {
  return <View style={styles.row}>
    <View accessible={false} style={styles.icon}><View style={styles.pin}><View style={styles.dot} /></View></View>
    <View style={{ flex: 1 }}><Text style={label ? ui.h3 : ui.small}>{label || 'Street name unavailable · location is on the map'}</Text>{!!label && <Text style={ui.small}>Approximate current location</Text>}{Platform.OS === 'web' && !!label && <Text accessibilityRole="link" onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright'); }} style={ui.small}>© OpenStreetMap contributors</Text>}</View>
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, backgroundColor: palette.pale, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  pin: { width: 15, height: 15, borderWidth: 2, borderColor: palette.green, borderRadius: 9, borderBottomRightRadius: 1, transform: [{ rotate: '45deg' }], marginTop: -4, justifyContent: 'center', alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: palette.green },
});
