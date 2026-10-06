import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { leafletDocument, pickedMapPoint, serializeMapData, type LeafletProps } from '@/lib/leaflet-document';

export default function LeafletMap({ data, onPick, height = 364 }: LeafletProps) {
  const channel = useId();
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [revision, retry] = useState(0);
  const html = useMemo(() => leafletDocument(channel), [channel, revision]);
  const source = useMemo(() => ({ html, baseUrl: 'https://melange.invalid/' }), [html]);
  function update() { ref.current?.injectJavaScript(`window.updateMelangeMap && window.updateMelangeMap(${serializeMapData(data)});true;`); }
  useEffect(() => { if (ready) update(); }, [data, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return <View style={{ height, borderRadius: 18, overflow: 'hidden' }}><WebView key={revision} ref={ref} source={source}
    originWhitelist={['*']} javaScriptEnabled domStorageEnabled scrollEnabled={false} geolocationEnabled={false}
    applicationNameForUserAgent="Melange/1.0 (errand-map-prototype)"
    setSupportMultipleWindows={false} mixedContentMode="never" style={{ flex: 1, backgroundColor: '#EAF0E7' }}
    onShouldStartLoadWithRequest={request => {
      if (request.url === 'about:blank' || request.url.startsWith('https://melange.invalid/')) return true;
      if (request.url === 'https://www.openstreetmap.org/copyright') void Linking.openURL(request.url).catch(() => undefined);
      return false;
    }}
    onMessage={event => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        if (message?.channel !== channel) return;
        if (message.type === 'ready') { setReady(true); update(); }
        else if (message.type === 'retry') { setReady(false); retry(value => value + 1); }
        else { const point = pickedMapPoint(message, channel); if (point) onPick?.(point); }
      } catch { /* Ignore malformed messages; never execute document messages as code. */ }
    }} /></View>;
}
