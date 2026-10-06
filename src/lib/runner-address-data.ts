import { cleanAddressPart } from '../../convex/lib/runnerAddress';
import { haversineKm } from '../../convex/lib/shareGeo';

export type AddressPoint = { latitude: number; longitude: number; capturedAt: number };
export type AddressUpdate = { lat: number; lng: number; capturedAt: number; sessionId: string; city: string; street: string };
type GeocodedAddress = { city?: string | null; district?: string | null; subregion?: string | null; street?: string | null };

export function addressParts(address?: GeocodedAddress) {
  return { city: cleanAddressPart(address?.city || address?.district || address?.subregion), street: cleanAddressPart(address?.street) };
}

// One lookup at a time, at most every 30 seconds while moving. Stationary
// runners refresh every two minutes; failed lookups retry on later GPS fixes.
export function createAddressPublisher(lookup: (point: AddressPoint) => Promise<GeocodedAddress[]>, now = Date.now) {
  let pending = false;
  let attempt: { sessionId: string; time: number } | undefined;
  let success: { sessionId: string; time: number; lat: number; lng: number } | undefined;
  return async (point: AddressPoint, sessionId: string, publish: (update: AddressUpdate) => Promise<boolean>) => {
    const time = now();
    if (pending || (attempt?.sessionId === sessionId && time - attempt.time < 30_000)) return;
    const coordinate = { lat: point.latitude, lng: point.longitude };
    if (success?.sessionId === sessionId && time - success.time < 120_000 && haversineKm(success, coordinate) < 0.04) return;
    pending = true; attempt = { sessionId, time };
    try {
      const parts = addressParts((await lookup(point))[0]);
      if (!parts.city && !parts.street) return;
      if (now() - point.capturedAt > 30_000) return;
      if (await publish({ ...coordinate, ...parts, capturedAt: point.capturedAt, sessionId })) success = { ...coordinate, sessionId, time: now() };
    } catch { /* Optional address lookup must never interrupt GPS sharing. */ }
    finally { pending = false; }
  };
}
