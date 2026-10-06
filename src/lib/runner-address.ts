import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { createAddressPublisher, type AddressPoint, type AddressUpdate } from './runner-address-data';
import { lookupBrowserAddress } from './runner-address-browser';

const publishAddress = createAddressPublisher(point => Platform.OS === 'web' ? lookupBrowserAddress(point) : Location.reverseGeocodeAsync(point));
export async function updateRunnerAddress(point: AddressPoint, sessionId: string, publish: (update: AddressUpdate) => Promise<boolean>) {
  // Bound task waiting; an unfinished native lookup still holds the
  // publisher's lock so a slow geocoder cannot spawn overlapping requests.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([publishAddress(point, sessionId, publish), new Promise<void>(resolve => { timer = setTimeout(resolve, 10_000); })]);
  } finally { clearTimeout(timer); }
}
