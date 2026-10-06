import { haversineKm } from './shareGeo';

export type RunnerAddress = { city: string; street: string; lat: number; lng: number; capturedAt: number; sessionId: string };
export function cleanAddressPart(value?: string | null): string {
  return (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
export function addressText(city: string, street: string): string | null {
  return [...new Set([cleanAddressPart(city), cleanAddressPart(street)].filter(Boolean))].join(', ') || null;
}
// Never display a previous street after significant movement or a new session.
export function currentAddressLabel(runner: {
  status: string; lat: number; lng: number; capturedAt: number;
  locationSessionId?: string; address?: RunnerAddress;
}): string | null {
  const address = runner.address;
  if (runner.status !== 'online' || !address || address.sessionId !== runner.locationSessionId ||
    runner.capturedAt - address.capturedAt > 180_000 || haversineKm(runner, address) > 0.1) return null;
  return addressText(address.city, address.street);
}
