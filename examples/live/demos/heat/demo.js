/* Page wiring for the heat demo. */

import {
  mountDemo, isDark, onTheme, fpsMeter, num, compact, panel, field, row, segmented, slider
} from "../../assets/shell.js";
import { createScene, makeReadings, basemapFor } from "./map.js";

let count = 20_000;

const controls = panel(
  field(
    "Mode",
    row(
      segmented(
        [
          { value: "both", label: "both" },
          { value: "heatmap", label: "heatmap" },
          { value: "isolines", label: "isolines" }
        ],
        "both",
        (value) => scene.heat.setMode(value)
      )
    )
  ),
  field(
    "Readings",
    row(
      segmented(
        [5_000, 20_000, 100_000].map((value) => ({ value, label: compact(value) })),
        count,
        (value) => {
          count = Number(value);
          scene.heat.setData(makeReadings(count));
        }
      )
    )
  ),
  field(
    "Backend",
    row(
      segmented(
        [
          { value: "auto", label: "auto" },
          { value: "wasm", label: "wasm" },
          { value: "webgpu", label: "webgpu" }
        ],
        "auto",
        (value) => scene.heat.setBackend(value)
      )
    )
  ),
  field(
    "Contour labels",
    row(
      segmented(
        [
          { value: "on", label: "on" },
          { value: "off", label: "off" }
        ],
        "on",
        (value) => scene.heat.setLabels(value === "on")
      )
    )
  )
);

const ui = await mountDemo({
  title: "Heat and isolines",
  badges: ["orihon/advanced"],
  sources: [
    { name: "map.js", url: "./map.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  hud: ["readings", "backend", "contours", "peak", "build", "fps"],
  controls,
  notes: `
    <p class="note"><strong>One grid, two renderings.</strong> The heatmap and the contour
    lines come from the same scalar field, so a line labelled 60 really is the 60 boundary of
    the colour underneath it. Switching <code>mode</code> does not recompute the field.</p>
    <p class="note"><strong>The backend is resolved, not assumed.</strong>
    <code>backend: "auto"</code> considers WebGPU on large inputs, then WASM, then JS.
    <code>getStats()</code> reports which one actually ran — the HUD shows it. Pick a specific
    backend above and watch the number change.</p>
    <p class="note"><strong>Contours are features, not decoration.</strong> With
    <code>interactive: true</code> the lines and the zones between them hit-test, hover,
    select and can carry a tooltip or popup. Move the pointer over the field.</p>
    <p class="note"><strong>It runs off the main thread.</strong> Field and contour work goes
    to a worker by default; the fps counter stays put while a hundred thousand readings are
    rebuilt.</p>`
});

const scene = createScene({ container: ui.map, dark: isDark(), points: makeReadings(count) });
onTheme((dark) => scene.map.setBasemap(basemapFor(dark)));

fpsMeter((value) => ui.hud("fps", value.toFixed(0)));

setInterval(() => {
  const stats = scene.heat.getStats();
  ui.hud("readings", num(scene.heat.count));
  ui.hud("backend", `${stats.backend}${stats.worker ? " · worker" : ""}`);
  ui.hud("contours", num(stats.rings));
  ui.hud("peak", stats.peak ? stats.peak.toFixed(1) : "—");
  ui.hud("build", `${stats.renderMs.toFixed(1)} ms`);
}, 500);
