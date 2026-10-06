import type { MapCoordinate, MapSurfaceProps } from './runner-geojson';
import { demoRoute } from './map-demo';

export type MapPin = MapCoordinate & { id: string; label: string; kind: 'runner' | 'buyer' | 'stop'; stale?: boolean };
export type LeafletData = {
  center: MapCoordinate; pins: MapPin[]; line?: MapCoordinate[];
  fit: boolean; pick: boolean; button: string;
};
export type LeafletProps = { data: LeafletData; onPick?: (point: { lat: number; lng: number }) => void; height?: number };
export function trackingMapData({ center, runners, customer, customerLabel = 'You · buyer', fitToMarkers = false, demo = false, stale = false, destinations = [] }: MapSurfaceProps): LeafletData {
  const pins: MapPin[] = runners.features.map(f => ({ id: String(f.id), label: f.properties.name, latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0], kind: 'runner', stale }));
  if (customer) pins.push({ ...customer, id: 'buyer', label: customerLabel, kind: 'buyer' });
  for (const stop of destinations) pins.push({ ...stop, id: `destination:${stop.id}`, kind: 'stop' });
  return { center, pins, line: demo ? demoRoute : undefined, fit: fitToMarkers, pick: false,
    button: fitToMarkers && pins.length > 1 ? 'Show route' : 'Recenter map' };
}
export function serializeMapData(value: unknown) {
  // Safe both inside an inline script and when passed to native injection.
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export function pickedMapPoint(raw: unknown, channel: string) {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  return data.channel === channel && data.type === 'pick' && typeof data.lat === 'number' && Number.isFinite(data.lat) && Math.abs(data.lat) <= 90
    && typeof data.lng === 'number' && Number.isFinite(data.lng) && Math.abs(data.lng) <= 180 ? { lat: data.lat, lng: data.lng } : null;
}

// One map implementation for browsers and the Android Expo Go WebView. GPS
// stays in the authenticated parent; this document never requests location.
export function leafletDocument(channel: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
<style>html,body{height:100%;margin:0;font:14px system-ui,sans-serif;color:#213e36;background:#eaf0e7}#map{position:absolute;inset:0 0 54px}#fit{position:absolute;bottom:0;height:46px;left:0;width:100%;border:0;border-radius:12px;background:#f3ca97;color:#213e36;font:700 14px system-ui;cursor:pointer}#notice{position:absolute;z-index:1000;top:10px;left:50px;right:10px;padding:10px;border-radius:8px;background:white;box-shadow:0 2px 8px #0002}#notice[hidden]{display:none}.person{border:0;background:none}.person svg{overflow:visible;filter:drop-shadow(0 2px 2px #0006)}.leaflet-container{background:#eaf0e7}.leaflet-control-attribution{font-size:10px}</style>
</head><body><div id="map" aria-label="Delivery map"></div><div id="notice" role="status">Loading map…</div><button id="fit" type="button">Recenter map</button>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script>
(function(){
  const channel=${serializeMapData(channel)};
  const notice=document.getElementById('notice'), button=document.getElementById('fit');
  function send(message){message.channel=channel;if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(message));else window.parent.postMessage(message,'*');}
  function warn(message){notice.textContent=message;notice.hidden=false;}
  if(!window.L){warn('Map could not load. Check your internet connection and tap Retry map.');button.textContent='Retry map';button.onclick=function(){send({type:'retry'});};return;}
  const map=L.map('map',{zoomControl:true,scrollWheelZoom:false}).setView([5.56,-0.19],14);
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'}).addTo(map);
  let data=null,follow=true,tileFailure=false,first=true;
  let tileTimer=setTimeout(function(){warn('Map tiles are taking longer to load. Check your connection.');},12000);
  tiles.on('tileerror',function(){tileFailure=true;warn('Some map tiles could not load. Check your connection and tap Retry map.');button.textContent='Retry map';});
  tiles.on('tileload',function(){clearTimeout(tileTimer);if(!tileFailure)notice.hidden=true;});
  const markers=new Map();let line=null;
  function icon(pin){
    const buyer=pin.kind==='buyer',color=buyer?'#208aef':'#b95629';
    return L.divIcon({className:'person',html:'<svg width="38" height="46" viewBox="0 0 38 46"><circle cx="19" cy="19" r="17" fill="'+color+'" stroke="white" stroke-width="2"/><circle cx="19" cy="19" r="6" fill="white"/><path d="M13 35L19 45L25 35" fill="'+color+'"/></svg>',iconSize:[38,46],iconAnchor:[19,45],popupAnchor:[0,-40]});
  }
  function coordinate(p){return [p.latitude,p.longitude];}
  function fit(){
    if(!data)return;map.invalidateSize({pan:false});
    const points=data.fit?data.pins.map(coordinate):[coordinate(data.center)];
    if(points.length>1)map.fitBounds(L.latLngBounds(points),{padding:[45,50],maxZoom:17,animate:false});
    else map.setView(points[0]||coordinate(data.center),15,{animate:false});
  }
  window.updateMelangeMap=function(next){
    data=next;button.textContent=tileFailure?'Retry map':data.button;
    const ids=new Set();data.pins.forEach(function(pin){
      ids.add(pin.id);let marker=markers.get(pin.id);
      const caption=document.createElement('span');caption.textContent=pin.label+(pin.stale?' · last known position':'');
      if(!marker){marker=pin.kind==='runner'?L.circleMarker(coordinate(pin),{radius:9,color:'#ffffff',weight:3,fillColor:'#234e40',fillOpacity:1}).addTo(map):L.marker(coordinate(pin),{icon:icon(pin),title:pin.label,zIndexOffset:400}).addTo(map);markers.set(pin.id,marker);}
      marker.setLatLng(coordinate(pin));
      if(pin.kind==='runner')marker.setStyle({opacity:pin.stale?0.6:1,fillOpacity:pin.stale?0.6:1});else marker.setOpacity(1);
      marker.bindPopup(caption);
    });
    markers.forEach(function(marker,id){if(!ids.has(id)){map.removeLayer(marker);markers.delete(id);}});
    if(line){map.removeLayer(line);line=null;}
    if(data.line&&data.line.length>1)line=L.polyline(data.line.map(coordinate),{color:'#234e40',weight:4,dashArray:'7 5'}).addTo(map);
    if(first||follow){fit();first=false;}
  };
  map.on('dragstart zoomstart',function(e){if(e.originalEvent||e.type==='dragstart')follow=false;});
  map.on('click',function(e){if(data&&data.pick)send({type:'pick',lat:e.latlng.lat,lng:((e.latlng.lng+540)%360)-180});});
  button.onclick=function(){follow=true;if(tileFailure){tileFailure=false;notice.hidden=true;tiles.redraw();}fit();button.textContent=data?data.button:'Recenter map';};
  window.addEventListener('message',function(event){if(event.source!==window.parent)return;const m=event.data;if(m&&m.channel===channel&&m.type==='update')window.updateMelangeMap(m.data);});
  if(window.ResizeObserver)new ResizeObserver(function(){map.invalidateSize({pan:false});if(follow)fit();}).observe(document.getElementById('map'));
  send({type:'ready'});
})();
</script></body></html>`;
}
