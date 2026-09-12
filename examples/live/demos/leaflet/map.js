/*
 * The Orihon half of the side-by-side.
 *
 * Same scene as leaflet.js: a raster basemap, a route, an area, depots with
 * popups and a GeoJSON collection styled by data. Read the two files against
 * each other — the shapes line up, the vocabulary is what changed.
 */

import { createMap } from "orihon/easy";
import { circleMarker } from "orihon";
import { popupContent } from "orihon/popup-content";

export const basemapFor = (dark) => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
    dark ? "Dark" : "Light"
  }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  attribution: "Tiles © Esri",
  maxNativeZoom: 16
});

export function createScene({ container, dark, data }) {
  // Named lat/lng, and the basemap is a map option instead of a second call.
  const map = createMap(container, {
    center: { lat: 52.515, lng: 13.39 },
    zoom: 12,
    basemap: basemapFor(dark)
  });

  map.addMarker({
    position: { lat: 52.5219, lng: 13.4132 },
    appearance: { shape: "pin", color: "#c1501f" },
    // Leaflet parses an HTML string here; Orihon escapes it. Structured popups
    // are built from blocks instead — see the note beside this file.
    popup: popupContent({ title: "Alexanderplatz" })
  });

  map.addPolyline({
    points: data.route.map(([lng, lat]) => ({ lat, lng })),
    style: { stroke: "#c1501f", strokeWidth: 4, arrow: "end" },
    tooltip: "Service route"
  });

  map.addPolygon({
    rings: data.area.map(([lng, lat]) => ({ lat, lng })),
    style: { fill: "#2d7285", fillOpacity: 0.2, stroke: "#2d7285", strokeWidth: 2 },
    popup: "Delivery area"
  });

  const stops = map.addGeoJSON({
    data: data.stops,
    // `pointToLayer` decides what a point becomes, size and paint included.
    pointToLayer: (feature, position) =>
      circleMarker(position, {
        radiusPixels: 4 + feature.properties.load / 12,
        fill: feature.properties.load > 60 ? "#c1501f" : "#0b463c",
        fillOpacity: 0.85,
        stroke: dark ? "#08120f" : "#fbf4ed",
        strokeWidth: 1.5
      }),
    popup: (feature) => popupContent({
      title: feature.properties.name,
      children: [{ type: "popupText", props: { text: `load ${feature.properties.load}`, tone: "lead" } }]
    })
  });

  map.fitBounds(stops.getBounds(), { padding: 40 });
  return { map };
}
