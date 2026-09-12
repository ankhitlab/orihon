/*
 * The Leaflet half of the side-by-side, for reference.
 *
 * Leaflet 1.9.4, loaded straight from unpkg. Nothing here is criticism of it —
 * it is the map everybody already knows, which is exactly why it is the useful
 * thing to read Orihon against.
 */

import * as L from "https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js";

// Leaflet derives its default marker image path from the script tag, which the
// ESM build does not have. Pointing it at the package's images/ is the usual fix.
L.Icon.Default.imagePath = "https://unpkg.com/leaflet@1.9.4/dist/images/";

export function createScene({ container, dark, data }) {
  // Positional [lat, lng], and the basemap is a second call.
  const map = L.map(container).setView([52.515, 13.39], 12);

  L.tileLayer(
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
      dark ? "Dark" : "Light"
    }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    { attribution: "Tiles © Esri", maxNativeZoom: 16, maxZoom: 19 }
  ).addTo(map);

  L.marker([52.5219, 13.4132]).addTo(map).bindPopup("<b>Alexanderplatz</b>");

  L.polyline(
    data.route.map(([lng, lat]) => [lat, lng]),
    { color: "#c1501f", weight: 4 }
  )
    .addTo(map)
    .bindTooltip("Service route");

  L.polygon(
    data.area.map(([lng, lat]) => [lat, lng]),
    { color: "#2d7285", weight: 2, fillColor: "#2d7285", fillOpacity: 0.2 }
  )
    .addTo(map)
    .bindPopup("Delivery area");

  const stops = L.geoJSON(data.stops, {
    pointToLayer: (feature, latlng) =>
      L.circleMarker(latlng, { radius: 4 + feature.properties.load / 12 }),
    style: (feature) => ({
      fillColor: feature.properties.load > 60 ? "#c1501f" : "#0b463c",
      fillOpacity: 0.85,
      color: dark ? "#08120f" : "#fbf4ed",
      weight: 1.5
    }),
    onEachFeature: (feature, layer) =>
      layer.bindPopup(`<b>${feature.properties.name}</b><br>load ${feature.properties.load}`)
  }).addTo(map);

  map.fitBounds(stops.getBounds(), { padding: [40, 40] });
  return { map };
}
