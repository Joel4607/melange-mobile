import * as Location from 'expo-location';
import { freshLocationFeed } from './fresh-location-feed';

export function watchFreshPosition(onReading: (reading: Location.LocationObject) => void, onError: () => void) {
  // Expo web otherwise defaults getCurrentPosition to maximumAge: Infinity.
  const options = { accuracy: Location.Accuracy.High, maximumAge: 0, timeout: 12000, distanceInterval: 0, timeInterval: 5000 };
  return freshLocationFeed({
    watch: (receive, fail) => Location.watchPositionAsync(options, receive, fail),
    current: () => Location.getCurrentPositionAsync(options),
    onReading, onError,
  });
}
