/*
 * Heat field and contour lines from the same scalar grid.
 *
 * `heatLayer` takes points with weights, builds a field, and can draw it as a
 * heatmap, as labelled isolines, or both. The heavy part runs on a worker, and
 * the backend is chosen at run time — WebGPU or WASM when the machine has them,
 * plain JS otherwise — without the calling code changing.
 */

import { createMap } from "orihon/easy";
import { heatLayer } from "orihon/advanced";

export const basemapFor = (dark) => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
    dark ? "Dark" : "Light"
  }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  attribution: "Tiles © Esri",
  maxNativeZoom: 16
});

const GRADIENT = {
  0.0: "rgba(11, 70, 60, 0)",
  0.25: "#2d7285",
  0.5: "#74b6ab",
  0.7: "#d39d1a",
  0.9: "#d05d2d",
  1.0: "#8c2d10"
};

export function createScene({ container, dark, points }) {
  const map = createMap(container, {
    center: { lat: 50.6, lng: 10.4 },
    zoom: 5,
    basemap: basemapFor(dark)
  });

  const heat = heatLayer(points, {
    // "both" paints the field and marches the contours over the same grid.
    mode: "both",
    backend: "auto",
    evaluation: "zoom",

    // "mean" divides by the kernel mass, so the field comes back in the units
    // of the readings themselves. "sum" (the default) would make a dense
    // cluster of clean stations read hotter than one dirty station.
    fieldModel: "mean",
    radius: 30,
    step: "auto",
    labels: true,
    gradient: GRADIENT,
    opacity: 0.78,
    isolineWidth: 1.2,
    isolineOpacity: 0.65,

    // Hover and click hit-test the contours and the zones between them.
    interactive: true,
    hoverHighlight: true,
    selectOnClick: true
  }).addTo(map);

  heat.bindTooltip((feature) =>
    feature.kind === "line"
      ? `contour ${feature.value.toFixed(1)} µg/m³`
      : `zone ${feature.value.toFixed(1)} µg/m³`
  );

  return { map, heat };
}

/* ---------------------------------------------------------------- dataset - */

const SOURCES = [
  [52.52, 13.40, 92], [51.34, 12.37, 74], [51.05, 13.74, 66], [53.55, 9.99, 58],
  [50.94, 6.96, 88], [51.51, 7.47, 96], [50.11, 8.68, 71], [48.78, 9.18, 63],
  [48.14, 11.58, 69], [49.45, 11.08, 55], [50.08, 14.44, 84], [48.21, 16.37, 77],
  [52.23, 21.01, 94], [50.06, 19.94, 99], [51.11, 17.04, 81], [47.50, 19.04, 79],
  [45.46, 9.19, 97], [47.37, 8.54, 44], [48.86, 2.35, 72], [50.85, 4.35, 68],
  [52.37, 4.90, 57], [51.51, -0.13, 61], [53.48, -2.24, 59], [55.68, 12.57, 41]
];

/**
 * `[lat, lng, weight]` tuples — no object per reading. Real inputs look like
 * this: a station location and a measured value.
 */
export function makeReadings(count, seed = 11) {
  const random = mulberry32(seed);
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    const [lat, lng, level] = SOURCES[(random() * SOURCES.length) | 0];
    const spread = 0.3 + random() * 1.4;
    points[i] = [
      lat + (random() - 0.5) * spread,
      lng + (random() - 0.5) * spread * 1.7,
      Math.max(4, level * (0.55 + random() * 0.75))
    ];
  }
  return points;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
