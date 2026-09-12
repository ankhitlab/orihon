/*
 * A million application objects on one map.
 *
 * ObjectManager owns the data. It picks a renderer for the singles (DOM below
 * `webglThreshold`, a GPU batch above it), moves cluster layout to a worker when
 * the set gets big, and imports cooperatively so the pointer never stalls.
 */

import { createMap } from "orihon/easy";
import { objectManager } from "orihon/object-manager";

const KIND = {
  depot: { fill: "#0b463c", size: 7 },
  hub: { fill: "#2d7285", size: 6 },
  stop: { fill: "#b6820a", size: 5 },
  alert: { fill: "#c1501f", size: 8 }
};

/** Any XYZ raster template works; this one needs no key and has a dark variant. */
export const basemapFor = (dark) => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
    dark ? "Dark" : "Light"
  }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  attribution: "Tiles © Esri",
  maxNativeZoom: 16
});

export function createScene({ container, dark }) {
  const map = createMap(container, {
    center: { lat: 50.4, lng: 9.6 },
    zoom: 5,
    basemap: basemapFor(dark)
  });

  const manager = objectManager({
    clusterize: true,

    // "auto": a GPU batch for the singles once the set crosses the threshold,
    // DOM markers below it. Asking for "webgl" explicitly would throw on a
    // machine without it instead of quietly changing renderer.
    clusterRenderer: "auto",
    webglThreshold: 25_000,

    // Cluster layout leaves the main thread on large sets, which is what keeps
    // panning and zooming responsive while a million points are indexed.
    layoutWorker: "auto",

    // One resolver decides the look of every object, by data.
    styleByCategory: false,
    style: (object) => KIND[object.properties.kind]
  }).addTo(map);

  // A string popup is escaped, not parsed: at a million objects that is also the
  // cheapest thing to render.
  manager.bindPopup((object) => `${object.properties.title} · ${object.properties.kind}`);
  manager.bindClusterPopup((objects, ids) => `${ids.length.toLocaleString()} objects here`);

  return { map, manager };
}

/**
 * A ManagedObject is an id, a position and whatever properties the application
 * already owns. No wrapper class, no per-object DOM node.
 */
export function makeObjects(count, seed = 7) {
  const random = mulberry32(seed);
  const kinds = Object.keys(KIND);
  const objects = new Array(count);

  for (let i = 0; i < count; i++) {
    const city = CITIES[(random() * CITIES.length) | 0];
    const spread = 0.04 + random() * 0.9;
    const kind = random() > 0.985 ? "alert" : kinds[(random() * 3) | 0];
    objects[i] = {
      id: i,
      coordinates: {
        lat: city[0] + gauss(random) * spread,
        lng: city[1] + gauss(random) * spread * 1.6
      },
      properties: { title: `${city[2]} · unit ${i}`, kind }
    };
  }
  return objects;
}

/** Cooperative import: chunked, cancellable, with progress. */
export function importObjects(manager, objects, { signal, onProgress }) {
  return manager.addAsync(objects, {
    chunkSize: 25_000,
    yieldMode: "task",
    signal,
    onProgress
  });
}

/* -------------------------------------------------- deterministic sample - */

const CITIES = [
  [52.52, 13.405, "Berlin"], [48.14, 11.58, "Munich"], [50.11, 8.68, "Frankfurt"],
  [53.55, 9.99, "Hamburg"], [51.23, 6.78, "Düsseldorf"], [48.78, 9.18, "Stuttgart"],
  [50.94, 6.96, "Cologne"], [52.37, 4.9, "Amsterdam"], [50.85, 4.35, "Brussels"],
  [48.86, 2.35, "Paris"], [47.37, 8.54, "Zürich"], [45.46, 9.19, "Milan"],
  [41.9, 12.5, "Rome"], [40.42, -3.7, "Madrid"], [41.39, 2.17, "Barcelona"],
  [51.51, -0.13, "London"], [53.48, -2.24, "Manchester"], [55.68, 12.57, "Copenhagen"],
  [59.33, 18.07, "Stockholm"], [52.23, 21.01, "Warsaw"], [50.06, 19.94, "Kraków"],
  [47.5, 19.04, "Budapest"], [50.08, 14.44, "Prague"], [48.21, 16.37, "Vienna"],
  [44.43, 26.1, "Bucharest"], [37.98, 23.73, "Athens"], [38.72, -9.14, "Lisbon"],
  [53.35, -6.26, "Dublin"], [60.17, 24.94, "Helsinki"], [59.91, 10.75, "Oslo"]
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller, so clusters look like settlements instead of a uniform grid. */
function gauss(random) {
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random()) * 0.34;
}
