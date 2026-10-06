import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { leafletDocument, pickedMapPoint, type LeafletProps } from '@/lib/leaflet-document';

export default function LeafletMap({ data, onPick, height = 364 }: LeafletProps) {
  const channel = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const [revision, retry] = useState(0);
  const [ready, setReady] = useState(false);
  const latest = useRef({ data, onPick }); latest.current = { data, onPick };
  const html = useMemo(() => leafletDocument(channel), [channel, revision]); // A retry remounts the document, not GPS updates.
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
      if (event.data.type === 'ready') {
        setReady(true);
        frame.current?.contentWindow?.postMessage({ type: 'update', channel, data: latest.current.data }, window.location.origin);
      } else if (event.data.type === 'retry') { setReady(false); retry(value => value + 1); }
      else { const point = pickedMapPoint(event.data, channel); if (point) latest.current.onPick?.(point); }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel]);
  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: 'update', channel, data }, window.location.origin);
  }, [channel, data, ready]);
  return <iframe key={revision} ref={frame} title={data.pick ? 'Choose a location on the map' : 'Runner and buyer map'} srcDoc={html}
    sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="strict-origin-when-cross-origin"
    style={{ width: '100%', height, border: 0, borderRadius: 18, display: 'block' }} />;
}
