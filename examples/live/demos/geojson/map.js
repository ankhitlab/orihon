/*
 * GeoJSON in, a styled map out.
 *
 * One FeatureCollection carries polygons, lines and points. A single style
 * function decides how every feature looks, `pointToLayer` decides what a point
 * becomes, and `popup` reads the feature's own properties. Restyling later is
 * `layer.setStyle(fn)` — no rebuild, no second copy of the data.
 */

import { createMap } from "orihon/easy";
import { geoJSON, circleMarker } from "orihon";
import { popupContent } from "orihon/popup-content";

/* Sequential ramp, dark end for the high values. */
const RAMP = ["#e6ddca", "#cdd9c4", "#a8ccb9", "#74b6ab", "#3f9598", "#1f6f7d", "#0b463c"];

export const basemapFor = (dark) => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
    dark ? "Dark" : "Light"
  }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  attribution: "Tiles © Esri",
  maxNativeZoom: 16
});

export function createScene({ container, dark, data }) {
  const map = createMap(container, {
    center: { lat: 52.51, lng: 13.4 },
    zoom: 11,
    basemap: basemapFor(dark)
  });

  const zones = geoJSON(data.zones, {
    // Hundreds of polygons: batch them on canvas instead of one SVG node each.
    renderer: "canvas",
    style: zoneStyle("demand", 0),
    // A popup string would be escaped, not parsed. Structured content is built
    // from blocks, which is also what keeps untrusted properties safe.
    popup: (feature) => {
      const p = feature.properties;
      return popupContent({
        title: p.name,
        children: [
          { type: "popupText", props: { text: `demand ${p.demand}`, tone: "lead" } },
          { type: "popupText", props: { text: `growth ${p.growth}% · delay ${p.delay} min`, tone: "caption" } }
        ]
      });
    }
  }).addTo(map);

  const corridors = geoJSON(data.corridors, {
    style: { stroke: "#c1501f", strokeWidth: 3, strokeOpacity: 0.9, lineCap: "round" },
    popup: (feature) => popupContent({
      title: feature.properties.name,
      children: [{ type: "popupText", props: { text: "Corridor", tone: "caption" } }]
    })
  }).addTo(map);

  const depots = geoJSON(data.depots, {
    // Points get their size and paint from `pointToLayer`; the polygons above
    // get theirs from a `style` function. Both read the same properties.
    pointToLayer: (feature, position) =>
      circleMarker(position, {
        radiusPixels: 5 + feature.properties.bays / 3,
        fill: "#b6820a",
        fillOpacity: 1,
        stroke: dark ? "#08120f" : "#fbf4ed",
        strokeWidth: 2
      }),
    popup: (feature) => popupContent({
      title: feature.properties.name,
      children: [{ type: "popupText", props: { text: `${feature.properties.bays} bays`, tone: "lead" } }]
    })
  }).addTo(map);

  map.fitBounds(zones.getBounds(), { padding: 40 });
  return { map, zones, corridors, depots };
}

/** Style is data, so changing the metric is one call away. */
export function zoneStyle(metric, threshold) {
  return (feature) => {
    const value = feature.properties[metric];
    const max = RANGES[metric];
    const hidden = value < threshold;
    return {
      fill: RAMP[Math.min(RAMP.length - 1, Math.floor((value / max) * RAMP.length))],
      fillOpacity: hidden ? 0 : 0.72,
      stroke: "#ffffff",
      strokeOpacity: hidden ? 0 : 0.35,
      strokeWidth: 1
    };
  };
}

export const RANGES = { demand: 100, growth: 40, delay: 25 };

/* ---------------------------------------------------------------- dataset - */

const BBOX = { south: 52.4, north: 52.63, west: 13.16, east: 13.63 };
const HEX = 0.0085;

/**
 * A hex grid over Berlin with three metrics per cell, plus corridors and
 * depots. Ordinary GeoJSON — the layer never sees where it came from.
 */
export function makeData() {
  const zones = { type: "FeatureCollection", features: [] };
  const stretch = 1 / Math.cos((52.5 * Math.PI) / 180);
  const rowStep = HEX * 1.5;
  const colStep = HEX * Math.sqrt(3) * stretch;

  let index = 0;
  for (let row = 0; (BBOX.south + row * rowStep) < BBOX.north; row++) {
    const lat = BBOX.south + row * rowStep;
    const offset = row % 2 ? colStep / 2 : 0;
    for (let col = 0; (BBOX.west + offset + col * colStep) < BBOX.east; col++) {
      const lng = BBOX.west + offset + col * colStep;
      const demand = field(lat, lng);
      zones.features.push({
        type: "Feature",
        id: `z-${index}`,
        properties: {
          name: `Zone ${String.fromCharCode(65 + (row % 26))}${col + 1}`,
          demand: Math.round(demand),
          growth: Math.round(6 + demand * 0.28 + 8 * Math.sin(lat * 61 + lng * 43)),
          delay: Math.round(2 + demand * 0.18 + 5 * Math.cos(lat * 37 - lng * 51))
        },
        geometry: { type: "Polygon", coordinates: [hexRing(lat, lng, stretch)] }
      });
      index++;
    }
  }

  const corridors = {
    type: "FeatureCollection",
    features: [
      ["A100 ring", [[13.28, 52.47], [13.27, 52.51], [13.31, 52.54], [13.38, 52.55]]],
      ["East axis", [[13.37, 52.52], [13.44, 52.52], [13.49, 52.51], [13.55, 52.50]]],
      ["South feed", [[13.39, 52.43], [13.40, 52.47], [13.40, 52.51]]],
      ["North feed", [[13.34, 52.62], [13.36, 52.58], [13.38, 52.54]]]
    ].map(([name, coordinates], i) => ({
      type: "Feature",
      id: `c-${i}`,
      properties: { name },
      geometry: { type: "LineString", coordinates }
    }))
  };

  const depots = {
    type: "FeatureCollection",
    features: [
      ["Nord", 13.36, 52.585, 18], ["Ost", 13.51, 52.505, 12],
      ["Süd", 13.40, 52.435, 24], ["West", 13.24, 52.505, 9],
      ["Mitte", 13.395, 52.522, 30]
    ].map(([name, lng, lat, bays], i) => ({
      type: "Feature",
      id: `d-${i}`,
      properties: { name: `${name} depot`, bays },
      geometry: { type: "Point", coordinates: [lng, lat] }
    }))
  };

  return { zones, corridors, depots };
}

function hexRing(lat, lng, stretch) {
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i + 30);
    ring.push([lng + HEX * Math.cos(angle) * stretch, lat + HEX * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Smooth synthetic demand surface: a few centres plus low-frequency ripple. */
function field(lat, lng) {
  const centres = [
    [52.52, 13.40, 62], [52.50, 13.33, 38], [52.54, 13.46, 30],
    [52.46, 13.44, 26], [52.57, 13.31, 22]
  ];
  let value = 8 + 6 * Math.sin(lat * 90) * Math.cos(lng * 70);
  for (const [clat, clng, weight] of centres) {
    const d2 = (lat - clat) ** 2 + ((lng - clng) * 0.61) ** 2;
    value += weight * Math.exp(-d2 / 0.0022);
  }
  return Math.max(0, Math.min(100, value));
}
