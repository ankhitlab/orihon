/*
 * One source of truth, several views.
 *
 * `FeatureSource` holds the fleet. A GeoJSON layer draws it, a collision-aware
 * text layer labels it, and the page's own status board subscribes to the same
 * stream. Moving a vehicle is `source.update(id, patch)` — no layer is told
 * about anything, and no view owns the data.
 */

import { createMap } from "orihon/easy";
import { featureSource } from "orihon/source";
import { geoJSON, textLayer, circleMarker } from "orihon";

const STATUS = {
  running: "#2d7285",
  loading: "#b6820a",
  delayed: "#c1501f"
};

export const basemapFor = (dark) => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
    dark ? "Dark" : "Light"
  }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  attribution: "Tiles © Esri",
  maxNativeZoom: 16
});

export function createScene({ container, dark }) {
  const map = createMap(container, {
    center: { lat: 50.2, lng: 9.0 },
    zoom: 5,
    basemap: basemapFor(dark)
  });

  const source = featureSource();

  const dots = geoJSON(source, {
    renderer: "canvas",
    // Colour comes from the feature's own status, so a vehicle that changes
    // state in the source changes colour on the next render.
    pointToLayer: (feature, position) =>
      circleMarker(position, {
        radiusPixels: 5,
        fill: STATUS[feature.properties.status],
        fillOpacity: 0.95,
        stroke: dark ? "#08120f" : "#fbf4ed",
        strokeWidth: 1.5
      }),
    popup: (feature) =>
      `${feature.properties.callsign} · ${feature.properties.status} · ` +
      `${Math.round(feature.properties.speed)} km/h`
  }).addTo(map);

  // Second consumer of the same source. Labels declutter themselves.
  const labels = textLayer(source, {
    text: (feature) => feature.properties.callsign,
    minZoom: 6,
    collision: true,
    offset: [0, -12],
    fill: dark ? "#e6f1ea" : "#12312b",
    halo: dark ? "#08120f" : "#fbf4ed",
    haloWidth: 3,
    priority: (feature) => (feature.properties.status === "delayed" ? 2 : 1)
  }).addTo(map);

  return { map, source, dots, labels };
}

/* ------------------------------------------------------------- simulation - */

const LEGS = [
  [52.52, 13.41, 48.14, 11.58], [53.55, 9.99, 50.94, 6.96], [48.86, 2.35, 45.76, 4.84],
  [51.51, -0.13, 53.48, -2.24], [52.37, 4.9, 50.85, 4.35], [50.11, 8.68, 48.78, 9.18],
  [41.39, 2.17, 40.42, -3.7], [45.46, 9.19, 41.9, 12.5], [48.21, 16.37, 50.08, 14.44],
  [52.23, 21.01, 50.06, 19.94], [55.68, 12.57, 59.33, 18.07], [47.37, 8.54, 48.14, 11.58],
  [50.85, 4.35, 48.86, 2.35], [53.35, -6.26, 51.51, -0.13], [59.91, 10.75, 55.68, 12.57]
];

/** Fleet as GeoJSON point features. `id` is what the source keys on. */
export function makeFleet(size) {
  const fleet = [];
  for (let i = 0; i < size; i++) {
    const leg = LEGS[i % LEGS.length];
    fleet.push({
      type: "Feature",
      id: `v-${i}`,
      properties: {
        callsign: `OR${String(100 + i).padStart(4, "0")}`,
        status: "running",
        speed: 60 + (i % 7) * 14,
        t: (i * 0.137) % 1,
        dir: i % 2 ? 1 : -1,
        leg: i % LEGS.length
      },
      geometry: { type: "Point", coordinates: [leg[1], leg[0]] }
    });
  }
  return fleet;
}

/**
 * Advance every vehicle one step. All of it lands in a single versioned
 * `batch`, so subscribers re-render once instead of once per vehicle.
 */
export function advance(source, stepScale) {
  source.batch(() => {
    for (const feature of source.getFeatures()) {
      const p = feature.properties;
      const leg = LEGS[p.leg];
      let t = p.t + p.dir * (p.speed / 90_000) * stepScale;
      let dir = p.dir;
      let status = p.status;

      if (t > 1 || t < 0) {
        t = Math.min(Math.max(t, 0), 1);
        dir = -dir;
        status = "loading";
      } else if (status === "loading" && Math.random() > 0.9) {
        status = "running";
      } else if (status === "running" && Math.random() > 0.9995) {
        status = "delayed";
      } else if (status === "delayed" && Math.random() > 0.99) {
        status = "running";
      }

      source.update(feature.id, {
        properties: { ...p, t, dir, status },
        geometry: {
          type: "Point",
          coordinates: [
            leg[1] + (leg[3] - leg[1]) * t,
            leg[0] + (leg[2] - leg[0]) * t
          ]
        }
      });
    }
  });
}
