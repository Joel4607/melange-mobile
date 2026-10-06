// Keep optional Mapbox support for custom builds; the APK preview uses Leaflet.
module.exports = ({ config }) => ({
  ...config,
  plugins: process.env.EXPO_PUBLIC_MAP_RENDERER === 'leaflet'
    ? config.plugins.filter(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) !== '@rnmapbox/maps')
    : config.plugins,
});
