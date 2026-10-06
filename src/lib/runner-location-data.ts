import type { LocationObject } from 'expo-location';

export function freshPoint(reading: LocationObject) {
  const { latitude, longitude, accuracy } = reading.coords;
  if (!Number.isFinite(reading.timestamp) || reading.timestamp < Date.now() - 30_000 || reading.timestamp > Date.now() + 10_000 || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null;
  return { latitude, longitude, capturedAt: reading.timestamp, ...(accuracy !== null && Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}) };
}

// This reads expiry only; the backend still verifies the token signature.
export function tokenExpiresAt(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload));
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : 0;
  } catch { return 0; }
}
