import * as Location from 'expo-location';
import { useState } from 'react';
import { Text, View } from 'react-native';
import type { GeoPoint } from '../../convex/lib/shareGeo';
import { CustomerButton, CustomerField, FormError, ui } from './customer-ui';
import ShareMap from './share-map';
function shareError(e: unknown) { return e instanceof Error ? e.message : 'Could not find location. Choose a pin manually.'; }
export function PinPicker({ label, address, point, onChange }: { label: string; address: string; point?: GeoPoint; onChange: (p: GeoPoint) => void }) {
  const [lat, setLat] = useState(point ? String(point.lat) : ''); const [lng, setLng] = useState(point ? String(point.lng) : ''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  function pick(p: GeoPoint) { onChange(p); setLat(String(p.lat)); setLng(String(p.lng)); setError(''); }
  async function locate() {
    setBusy(true); setError('');
    try {
      if (!(await Location.requestForegroundPermissionsAsync()).granted) throw new Error('Allow location access or tap the map instead.');
      const options = { accuracy: Location.Accuracy.High, maximumAge: 0, timeout: 12000 };
      const p = await Location.getCurrentPositionAsync(options); pick({ lat: p.coords.latitude, lng: p.coords.longitude });
    } catch (e) { setError(shareError(e)); } finally { setBusy(false); }
  }
  function coordinates() {
    const p = { lat: Number(lat), lng: Number(lng) };
    if (!lat.trim() || !lng.trim() || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) { setError('Enter a latitude from −90 to 90 and longitude from −180 to 180.'); return; }
    pick(p);
  }
  return <View style={{ gap: 10 }}><Text style={ui.h3}>{label}: {address}</Text><Text style={ui.small}>Tap the exact location on the map. Check that this pin matches the written address.</Text>
    <ShareMap points={point ? [{ ...point, label }] : []} onPick={pick} />
    <CustomerButton disabled={busy} onPress={() => void locate()}>{busy ? 'Finding location…' : 'Use my current location'}</CustomerButton>
    <CustomerField label={`${label} latitude`} value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" />
    <CustomerField label={`${label} longitude`} value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" />
    <CustomerButton onPress={coordinates}>Use these coordinates</CustomerButton><FormError message={error} />
    <Text style={ui.small}>{point ? `Selected: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}` : 'No pin selected yet.'}</Text>
  </View>;
}
