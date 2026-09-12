/* Page wiring for the scale demo: controls, counters, rebuilds. */

import {
  mountDemo, isDark, onTheme, fpsMeter, num, compact, panel, field, row, segmented, choice, action
} from "../../assets/shell.js";
import { createScene, makeObjects, importObjects, basemapFor } from "./map.js";

const SIZES = [25_000, 100_000, 250_000, 500_000, 1_000_000];

let count = 250_000;
let clustered = true;
let visualization = "auto";
let controller = null;
let busy = false;

const controls = panel(
  field(
    "Objects",
    row(
      segmented(
        SIZES.map((value) => ({ value, label: compact(value) })),
        count,
        (value) => rebuild(Number(value))
      )
    )
  ),
  field(
    "Clustering",
    row(
      segmented(
        [
          { value: "on", label: "on" },
          { value: "off", label: "off" }
        ],
        "on",
        (value) => {
          clustered = value === "on";
          scene.manager.setClusterize(clustered);
          sample();
        }
      )
    )
  ),
  field(
    "Visualization",
    choice(
      [
        { value: "auto", label: "auto (by zoom)" },
        { value: "objects", label: "objects" },
        { value: "clusters", label: "clusters" },
        { value: "heatmap", label: "heatmap" }
      ],
      visualization,
      (value) => {
        visualization = value;
        scene.manager.setVisualization(value);
        sample();
      }
    )
  ),
  row(action("Regenerate", () => rebuild(count)))
);

const ui = await mountDemo({
  title: "A million objects",
  badges: ["orihon/object-manager"],
  sources: [
    { name: "map.js", url: "./map.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  hud: ["objects", "on screen", "drawn", "renderer", "import", "fps"],
  controls,
  notes: `
    <p class="note"><strong>One manager, not one marker per object.</strong> The whole set is
    indexed once; the map draws what the viewport needs. Nothing here creates a DOM node
    per object, which is the wall a marker-per-record design hits somewhere around
    ten thousand.</p>
    <p class="note"><strong>Renderer is a decision, not a surprise.</strong>
    <code>clusterRenderer: "auto"</code> uses a GPU batch above
    <code>webglThreshold</code> and DOM below it. Asking for <code>"webgl"</code> outright
    throws <code>UnsupportedCapabilityError</code> on a machine that cannot do it, rather
    than silently profiling as a DOM path in production.</p>
    <p class="note"><strong>The import is cooperative.</strong> <code>addAsync</code> takes a
    chunk size, an <code>AbortSignal</code> and a progress callback, so a million rows land
    without one long task. Drag the map while it loads — it answers.</p>
    <p class="note"><strong>Where the numbers come from.</strong> <code>getStats()</code>
    reports objects, visible objects, drawn markers, the chosen renderer and the cluster
    strategy. The HUD prints them unmodified.</p>`
});

const scene = createScene({ container: ui.map, dark: isDark() });
onTheme((dark) => scene.map.setBasemap(basemapFor(dark)));

fpsMeter((value) => ui.hud("fps", value.toFixed(0)));
setInterval(sample, 400);

function sample() {
  const stats = scene.manager.getStats();
  ui.hud("objects", num(stats.objects));
  ui.hud("on screen", num(stats.visibleObjects));
  ui.hud("drawn", num(stats.renderedMarkers));
  ui.hud("renderer", `${stats.renderer}${stats.clusterStrategy === "none" ? "" : " + clusters"}`);
}

async function rebuild(next) {
  if (busy) controller?.abort();
  busy = true;
  count = next;
  controller = new AbortController();

  scene.manager.clear();
  ui.hud("import", "generating…");

  const started = performance.now();
  const objects = makeObjects(count);
  const generated = performance.now();

  try {
    await importObjects(scene.manager, objects, {
      signal: controller.signal,
      onProgress: (processed) => ui.hud("import", `${compact(processed)} / ${compact(count)}`)
    });
    const done = performance.now();
    ui.hud(
      "import",
      `${Math.round(generated - started)} + ${Math.round(done - generated)} ms`
    );
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
  } finally {
    busy = false;
    sample();
  }
}

rebuild(count);
