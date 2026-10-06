// Omit the unused Mapbox native SDK from the token-free demonstration APK.
module.exports = {
  dependencies: process.env.EXPO_PUBLIC_MAP_RENDERER === 'leaflet'
    ? { '@rnmapbox/maps': { platforms: { android: null, ios: null } } }
    : {},
};
