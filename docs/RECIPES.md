# Recipes

## A Small Raster Map

```js
import { createMap, tileLayer, marker } from "orihon/standard";
import "orihon/orihon.css";

const map = createMap("map", { center: ({ lat: 52.52, lng: 13.405 }), zoom: 11 });
tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxRequests: 8,
  cacheSize: 160
}).addTo(map);
marker(({ lat: 52.52, lng: 13.405 })).bindPopup("Center").addTo(map);
```

## A Bounded WMS Dataset

```js
import { wmsTileLayer } from "orihon";

wmsTileLayer("/wms", {
  layers: "planning:zones",
  version: "1.3.0",
  crs: "EPSG:3857",
  format: "image/png",
  transparent: true,
  bounds: [({ lat: 52.50, lng: 13.35 }), ({ lat: 52.54, lng: 13.45 })]
}).addTo(map);
```

Use `setParams({ layers: "planning:routes" })` to change the visible service layer without replacing the WMS object.

## 10,000 To 100,000 Points

Use `objectManager` for interactive clustered objects and `webglPointLayer` for raw point density:

```js
import { objectManager } from "orihon/object-manager";
import { webglPointLayer } from "orihon/advanced";

const objects = objectManager({ clusterize: true, clusterRadiusPixels: 50 }).addTo(map);
objects.add(featureCollection);

const density = webglPointLayer(points, { pointSize: 4, color: "#e11d48" }).addTo(map);
density.setViewTransform({ rotation: 20, pitch: 30 });
```

A plain point set, clustered or not, costs the manager about 130 bytes an object. The
per-object scene — geometries, spatial index, icon and label layers — comes up on its own the
first time a style resolver, a registered icon, declutter or a line/polygon needs it
(`sceneFeatures: "auto"`, the default), and is built from the objects already stored. Pass
`sceneFeatures: false` to keep it down for untrusted bulk points even after a style arrives.

## A Million Points, And Moving Them

At mass scale the cost moves from drawing to allocating. `webglPointLayer` stores points in
packed typed arrays, so the fastest paths are the ones that never build an object per point.

Load large sources with `setDataAsync()`. It packs degrees across bounded main-thread tasks and
swaps the GPU snapshot atomically, so the map stays responsive while it ingests. Nothing is
projected on the way in: data that arrives as degrees stays float64 degrees and is projected in
the vertex shader, so moving a point later costs two stores rather than a sine and a logarithm.

```js
await density.setDataAsync(points, { chunkSize: 50_000, yieldMode: "task" });
```

`points` may be an array, a generator or an async iterable — a generator avoids materialising
the whole dataset at once.

If you already hold packed buffers — from a worker, a fetch, or your own store — hand them over
directly with `setPackedData()`. `projectMercator01()` produces the absolute mercator it expects:

```js
import { projectMercator01 } from "orihon/geo";

const latlng = new Float32Array(count * 2);
const merc = new Float64Array(count * 2);
for (let i = 0; i < count; i++) {
  const { lat, lng } = source[i];
  const m = projectMercator01(lat, lng);
  latlng[i * 2] = lat;
  latlng[i * 2 + 1] = lng;
  merc[i * 2] = m.x;
  merc[i * 2 + 1] = m.y;
}

density.setPackedData(latlng, merc, { adopt: true });
```

`adopt` takes ownership without copying, so do not reuse those arrays for anything else
afterwards — the layer is now reading and writing them.

Packed data is stored and drawn as absolute mercator, 16 bytes per point by default. Datasets
that never go past roughly zoom 16 can halve that:

```js
webglPointLayer(points, { mercatorPrecision: "f32" });
```

Float32 quantises a normalized mercator to about 3e-8, which is a tenth of a pixel at zoom 14
and half a pixel at 16, but two pixels at 18 and eight at 20 — points visibly wobble as the
camera moves at those zooms. Keep the default `"f64"` unless the saving matters and the zoom
range is bounded. For degree-fed data the option only sets the width of the mercator copy the
layer derives for CPU readers such as `getMercatorAbs()`; drawing and hit-testing keep the
float64 degrees, so there is nothing to wobble.

To move points that are already loaded, patch them instead of replacing the set. `patchPoint()`
writes one position; `patchPoints()` takes flat arrays, sorts and merges the touched slots, and
uploads them as a few GPU ranges rather than one call per point:

```js
const indices = new Uint32Array(movingCount);   // point slots to update
const latLngs = new Float64Array(movingCount * 2); // lat, lng pairs

function onTelemetry(update) {
  // Fill the two arrays in place — reuse them across frames.
  density.patchPoints(indices, latLngs, update.count);
}
```

Reusing both arrays every frame is the point. Calling `setData()` on each tick allocates an
object per point per tick, which at a million points is the difference between a live feed and
a stalled one.

Positions are patched in place, so anything still holding a buffer handed over with
`setPackedData(..., { adopt: true })` sees the same update — that is how `objectManager` keeps a
single set of arrays shared with its layer instead of copying them.

With `interactive: true` the layer also keeps your source objects so `click` and `hover` can
hand them back, but only up to 40,000 points. Past that it keeps the packed buffers alone and
`pointData` stays empty; hit-testing still works, only the original object is no longer
attached to the event.

## Heatmap

Use `heatLayer` for weighted point density with blur and a color gradient:

```js
import { heatLayer } from "orihon/advanced";

const points = [
  [52.52, 13.405, 0.8],
  [52.53, 13.41, 1],
  [52.515, 13.39, 0.5]
];

heatLayer(points, {
  radius: 28,
  blur: 18,
  scaleZoom: 12,
  max: 3,
  minOpacity: 0.08
}).addTo(map);
```

`scaleZoom` is the zoom where `radius` is the geographic bandwidth. The kernel grows and shrinks with mercator zoom; `max` is how many overlapping unit kernels map to red. A uniform field stays the same color at every zoom instead of turning red when you zoom out.

Keep one layer and feed it with `setData()` rather than creating a layer per update. The field
worker costs more to start than the field it computes, so a removed layer hands its worker to
the next one instead of terminating it — but a long-lived layer never pays that at all.

## Binary Vector Tiles

```js
import { createMVTProvider, vectorTileLayer } from "orihon/advanced";

const provider = createMVTProvider("/mvt/{z}/{x}/{y}.pbf", {
  layer: ["roads", "water"]
});

vectorTileLayer({
  provider,
  style: (feature) => ({
    stroke: feature.properties?.class === "motorway" ? "#e11d48" : "#475569",
    strokeWidth: feature.properties?.class === "motorway" ? 4 : 2
  })
}).addTo(map);
```

## Offline Tile Cache

```js
import { offlineTileCache } from "orihon/advanced";

const cache = offlineTileCache({ cacheName: "city-v1", maxEntries: 500 });
await cache.prefetch(urls, { concurrency: 6 });
await cache.registerServiceWorker({
  urlPrefixes: ["https://tile.openstreetmap.org/"],
  scope: "/"
});
```

Cache only sources whose terms permit offline storage. Bump the cache name when tile content or style versions change.

## Cleanup In Single-Page Applications

```js
import { createMap } from "orihon";
import { objectManager } from "orihon/object-manager";

const map = createMap(container, options);
const remote = objectManager({ loader }).addTo(map);

return () => {
  remote.destroy();
  map.remove();
};
```

Removing the map aborts layer work, disconnects resize observation and releases DOM listeners. Provider-owned timers or sockets remain the provider's responsibility.

## Charts, Images And Video In Popups

Return a DOM node for native browser content:

```js
layer.bindPopup(() => {
  const card = document.createElement("section");
  const image = document.createElement("img");
  image.src = "/previews/camera-12.jpg";
  const video = document.createElement("video");
  video.src = "/streams/camera-12.mp4";
  video.controls = true;
  card.append(image, video);
  return card;
});
```

Use mountable content when another library owns resources:

```js
layer.bindPopup((context) => ({
  mount(container) {
    const root = createFrameworkRoot(container);
    root.render({ selected: context.data });
    return () => root.destroy();
  }
}));
```

The returned cleanup is called exactly once for each successful mount. Async factories may fetch details using application-owned cancellation logic; Orihon ignores their result if the popup has already closed.
