import { addressParts, type AddressPoint } from './runner-address-data';

const ROAD_TYPES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian', 'track', 'path', 'footway', 'cycleway', 'steps']);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown) => typeof value === 'string' ? value : '';

// Photon supports browser requests. Use it only for public availability; the
// caller handles throttling, stationary caching and stale-session rejection.
export async function lookupBrowserAddress(point: AddressPoint) {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) return [];
  const url = new URL(process.env.EXPO_PUBLIC_GEOCODER_URL || 'https://photon.komoot.io/reverse');
  url.searchParams.set('lat', String(point.latitude));
  url.searchParams.set('lon', String(point.longitude));
  url.searchParams.set('radius', '0.1');
  url.searchParams.set('limit', '3');
  url.searchParams.set('lang', 'en');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Address service unavailable');
    const data = record(await response.json());
    if (!Array.isArray(data?.features)) return [];
    const addresses = data.features.flatMap((feature: unknown) => {
      const properties = record(record(feature)?.properties);
      if (!properties) return [];
      const isRoad = properties.type === 'street' || (properties.osm_key === 'highway' && ROAD_TYPES.has(text(properties.osm_value)));
      const parts = addressParts({
        city: text(properties.city) || text(properties.town) || text(properties.village),
        district: text(properties.district) || text(properties.locality),
        subregion: text(properties.county),
        street: text(properties.street) || (isRoad ? text(properties.name) : ''),
      });
      return parts.city || parts.street ? [parts] : [];
    });
    // Prefer a nearby street result, otherwise display just the available area.
    const address = addresses.find(value => value.street) ?? addresses[0];
    return address ? [address] : [];
  } finally { clearTimeout(timer); }
}
