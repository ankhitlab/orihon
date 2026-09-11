# Orihon — engine benchmark

Comparative browser bench: **Orihon**, **Leaflet**, **OpenLayers**, **MapLibre GL**.

`npm run demo:bench` first rebuilds Orihon and serves the repository, so the benchmark uses the current local `dist`. Opening `index.html` directly remains supported and uses the pinned CDN fallback.

Pinned comparison set (verified 2026-08-21): Orihon 2.0.1, Leaflet 1.9.4, Leaflet.markercluster 1.5.3, OpenLayers 10.10.0 and MapLibre GL 6.4.1. Keep pins explicit so exported results remain reproducible; update this table and all CSS/JS URLs together. MapLibre v6 is loaded through its ESM-only `maplibre-gl.mjs` entry.

Live: https://whahedev.github.io/orihon/bench/

## Scenarios

| Scenario | What it stresses |
| --- | --- |
| **Points** | Fast specialized paths: Orihon WebGLPointLayer, custom MapLibre GL buffer, Leaflet canvas circleMarker, OL WebGLPoints. Different object models; not a native-feature parity test |
| **Native point features** | Public object/feature APIs: Orihon ObjectManager, Leaflet circleMarker, OL WebGLPoints, MapLibre GeoJSON circles |
| **Clusters** | Orihon `ObjectManager`, Leaflet.markercluster, OL `Cluster`, MapLibre GeoJSON cluster. Camera = **discrete** view steps |
| **Heatmap** | Shared hub-weighted dataset replaced by `orihon-mark-shape-v1`: sources trace the accordion-map mark silhouette; Orihon `heatLayer` continuous scalar-field colors |
| **Isolines** | Orihon `heatLayer` WASM field + marching-squares stitching (Leaflet / OL / MapLibre: n/a) |
| **Heatmap + isolines** | Orihon renders colors, matching contours and labels from one scalar field |
| **GeoJSON** | N four-vertex LineStrings; Orihon streams disposable chunks into a packed WebGL buffer |
| **Markers** | Marker renderers **hard-capped at 5k**; Orihon keeps all 5k in DOM (≤500 HTML buttons + SVG DOM remainder), Leaflet uses HTML, OpenLayers canvas, MapLibre ≤500 HTML + GPU |
| **Chart popup** | Marker open latency with chart content |
| **Filter** | Clustered set with filter toggled on camera steps |
| **Rich OM** | ObjectManager / MapLibre rich styles, filter, popup, live batches |
| **Live updates** | Move ~20% of points every frame for ~3s |
| **Sparse live updates** | Move 1% of points; partial API updates where available, full buffer upload in the custom MapLibre adapter |
| **Projection + linear scan** | Diagnostic O(N) coordinate projection/nearest scan; does not benchmark native hit-test APIs |
| **Native hit-test** | map.query / forEachFeatureAtPixel / queryRenderedFeatures, with visible hit verification; Leaflet reports unsupported rather than substituting a scan |
| **Basemap** | Tiles only |
| **Tile scroll / zoom-out** | One fractional zoom-in → zoom-out round-trip, alternating edge exposure, cache reuse and final tile-settle latency |

## Metrics

| Metric | Meaning |
| --- | --- |
| Init | Map + basemap construction |
| Load | Add data + first settled frames |
| Field / Contours / Paint | Orihon heat breakdown inside Load; field/contours exclude source packing and map/tile setup |
| FPS | Avg during camera / live stress (`60≈` = vsync-capped) |
| p95 / max | Frame-time tail |
| drop% | Frames slower than ~18.2 ms |
| Pick / Open | Hit-test / popup open latency |
| Markers | Renderer-specific cluster/feature count (not comparable as exact totals). Leaflet is n/a because stored marker count is not visible cluster count |
| Heap | Chromium `performance.memory`: absolute live heap plus delta from the reclaimed pre-run baseline; median runs also report retained baseline growth |
| Wall | Total runner duration, including preparation, waits and interaction |
| Long tasks / Longest task | Main-thread tasks over 50 ms, covering the whole runner; n/a where PerformanceObserver lacks longtask support |
| Status | Completion, explicit failure/cancellation/unsupported reason, or invalidation when the tab was hidden |

The tile-scroll scenario also reports **Settle**, each engine's tile-pipeline **Requests**, and repeated coordinate/URL **Reloads** inside the same run. This exposes zoom-out cache regressions instead of hiding them behind average FPS. Browser HTTP-cache hits still count when an engine restarts its own tile pipeline, because decode/upload and bookkeeping are part of the user-visible cost.

**Runs = 3 → median** reduces tile/GC noise.

## Notes

- Engines run **sequentially**.
- Each repetition rotates engine order; exports preserve execution order and every raw sample. Repetitions share library/HTTP caches and are not claimed to be cold starts. Three repetitions do not fully balance four engine positions.
- Tests include network basemaps by default. Disable **Include network basemap** to isolate overlay performance; basemap-only scenarios always enable tiles. Network and tile-cache conditions can affect results and the choice is recorded in exports.
- Choose regional uniform, dense hotspots or worldwide point distribution and a numeric seed. The same seed gives nested prefixes across dataset sizes. Heat and popup scenarios retain their separately documented fixed datasets.
- Preparation yields between bounded batches; Leaflet canvas attachment uses 10k batches to avoid repainting the growing set 1000 times. Markercluster is attached before addLayers and awaited through chunkProgress. OpenLayers point tests await rendercomplete. MapLibre source waits have no elapsed-time failure; Cancel interrupts between native operations. A library's synchronous operation cannot be preempted, and an actual browser/process OOM cannot be recovered by page JavaScript.
- Cancelled/failed rows retain explicit status and completed samples remain exportable. Error cleanup releases owned map instances. Final successful map stays visible until the next run.
- RAF reports callback cadence, not GPU-complete visual frames. A hidden-tab run is marked invalid. Heap excludes GPU and can exclude workers; GC is not guaranteed, so retained heap is not proof of a leak. No overall winner is highlighted.
- JS/CSS use pinned jsDelivr URLs for exposed Resource Timing. Transfer includes headers and counts cache hits as zero; encoded body is separate. All matching observed requests (including repeats) are summed. Unavailable entries remain partial, not zero. The optional fallback streams separate CORS fetches and labels their **decoded**, unique-resource bytes; it never calls them compressed transfer. All engines/plugins are preloaded, so these numbers are not minimal consumer bundles.
- Heat rows use `orihon-mark-shape-v1`: point sources follow the Orihon accordion-map mark (panels, strokes, route, end nodes), radius 5 px, blur 16 px, opacity 72% and the shared thermal ramp. Orihon also receives the captured 512×384 static field, Worker/WASM, 32 contour levels and selection weights. Leaflet/OpenLayers receive their native radius+blur controls. MapLibre has no separate blur control, so the benchmark uses one equivalent 21 px kernel. The **Temperature profile 1M** preset selects this scenario, one run and every engine. Exported JSON embeds the complete heat profile.
- Orihon heat sources are packed cooperatively with `setDataAsync()`. The v2 field aggregates weighted sources into cluster-like cells, then runs separable Gaussian passes in WASM/WebGPU; `auto` considers WebGPU at 100k+ in all display modes and reports readback separately. Static rows evaluate the full dataset once, zoom-refined rows rebuild in a persistent Worker, and camera motion compositor-warps the last complete surface.
- MapLibre points/live use a custom mercator buffer layer. These are specialized render paths, not equivalent feature stores; use Native point features for public object APIs.
- Camera inputs use the 256-pixel zoom convention. MapLibre receives zoom minus one (its camera world uses 512-pixel tiles), including camera movement. Exported pixelsPerLongitudeDegree checks initial projected scale; equal numeric zoom alone is not comparable.
- Orihon's mass GeoJSON row uses `retainFeatures:false`; it measures write-once rendering, not source round-trip or later per-feature restyling. Continuous camera motion mixes cheap camera-warp frames with throttled exact GPU redraws, then waits for the final exact settled frame.
- DOM markers above ~5k and GeoJSON above ~25k are intentionally warned. Leaflet and OpenLayers build per-feature object graphs all the way to a million LineStrings — slowly and on over 2 GB each, but they finish, so they are measured rather than skipped (an earlier 50k cap assumed otherwise). Orihon keeps its disposable packed-chunk path, while MapLibre receives the same paths as bounded `MultiLineString` features through a valid GeoJSON Blob URL so its worker does not first clone one million main-thread `Feature` objects — and, on that path, the `maxzoom: 10, buffer: 0` source bounds its docs recommend for large GeoJSON. With default source options it indexes four million vertices down to zoom 18 and takes the tab down; the camera here never passes zoom 6. Geometry is not simplified.
- Export JSON after a completed run.
- The Node CPU/RAM companion benchmark is `npm run bench:object-manager`; it imports only the public package entry and prints the Orihon, Node, OS and architecture versions with every run.

## Scenario organization

- **Projection + linear scan** and its preset are in **Diagnostics**; use **Native hit-test** for application-level picking. The scan remains useful for projection cost, not library indexing.
- **Isolines**, **Heatmap + isolines** and their presets are in **Orihon capabilities**: these adapters demonstrate Orihon APIs rather than rank engines. Both remain available to measure the extra contour/render cost separately.
- Keep **Clusters** and **Filter + clusters**: the latter measures repeated rebuilding and is not a duplicate.
- Keep **Basemap** and **Tile scroll**: continuous camera cadence and settled coverage/request reuse expose different issues.
- **Rich OM** overlaps individual tests intentionally as an integration workload. Do not use it instead of isolated tests.
- Marker representations currently mix HTML, SVG and canvas/GPU. Treat this as a renderer choice comparison, not a pure DOM-marker leaderboard.

The reusable harness is mirrored inline in index.html to preserve standalone HTML use. `scripts/embed-examples.mjs` synchronizes that block from harness.js; the harness tests verify equality and exercise cancellation, readiness, transfer accounting and million-element preparation.
