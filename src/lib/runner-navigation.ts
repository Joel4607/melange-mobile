export type TravelMode = 'walking' | 'bicycling' | 'two-wheeler' | 'driving';

export function travelModeFor(transport?: string): TravelMode {
  if (transport === 'walking') return 'walking';
  if (transport === 'bicycle') return 'bicycling';
  if (transport === 'motorbike') return 'two-wheeler';
  return 'driving';
}

export function nextRunnerStop(status: string): 'pickup' | 'dropoff' | null {
  return status === 'accepted' ? 'pickup' : status === 'picked_up' ? 'dropoff' : null;
}

// Addresses remain text supplied by the buyer. Google Maps resolves them and
// handles current location; do not substitute invented coordinates or an ETA.
export function directionsUrl(destination: string, mode: TravelMode, origin?: string) {
  if (!destination.trim() || (origin !== undefined && !origin.trim())) throw new Error('An address is missing. Ask the buyer to confirm it in chat.');
  const params = new URLSearchParams({ api: '1', destination: destination.trim(), travelmode: mode });
  if (origin !== undefined) params.set('origin', origin.trim());
  const url = `https://www.google.com/maps/dir/?${params.toString()}`;
  if (url.length > 2048) throw new Error('This address is too long for Maps. Ask the buyer for a shorter address or landmark.');
  return url;
}
