/* Page wiring for the live-data demo. */

import {
  mountDemo, isDark, onTheme, fpsMeter, num, panel, field, row, segmented, slider, action
} from "../../assets/shell.js";
import { createScene, makeFleet, advance, basemapFor } from "./map.js";

let size = 300;
let speed = 1;
let running = true;
let ticks = 0;

const board = document.createElement("div");
board.className = "note";

const controls = panel(
  field(
    "Fleet size",
    row(
      segmented(
        [100, 300, 800].map((value) => ({ value, label: String(value) })),
        size,
        (value) => reset(Number(value))
      )
    )
  ),
  field("Simulation speed", slider({
    min: 0.25, max: 4, step: 0.25, value: speed,
    format: (value) => `${value}×`,
    onInput: (value) => { speed = value; }
  })),
  row(
    action("Pause / resume", () => { running = !running; }),
    action("Drop 20%", () => {
      const ids = scene.source.getFeatures().slice(0, Math.round(scene.source.size * 0.2)).map((f) => f.id);
      scene.source.remove(ids);
    })
  ),
  field("Subscribers see every change", board)
);

const ui = await mountDemo({
  title: "Live data",
  badges: ["orihon/source"],
  sources: [
    { name: "map.js", url: "./map.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  hud: ["features", "updates/s", "fps"],
  controls,
  notes: `
    <p class="note"><strong>The source is the state.</strong> <code>featureSource()</code>
    holds identified GeoJSON features. Layers are views over it: a canvas GeoJSON layer
    for the dots and a collision-aware <code>textLayer</code> for the callsigns, both
    constructed from the same object. Neither one owns the fleet.</p>
    <p class="note"><strong>Mutations are versioned.</strong> <code>source.update(id, patch)</code>
    shallow-merges. Wrapping a sweep in <code>source.batch(...)</code> emits one change with
    one version, so every subscriber re-renders once per tick rather than once per vehicle.</p>
    <p class="note"><strong>Anything can subscribe.</strong> The status board in this panel is
    not a map layer — it is a <code>source.subscribe()</code> listener counting statuses. Drop
    20% of the fleet and the map, the labels and the board all follow from the same event.</p>
    <p class="note">This is the answer to "my application state and my map state keep
    drifting apart": there is one copy, and the renderers read it.</p>`
});

const scene = createScene({ container: ui.map, dark: isDark() });
onTheme((dark) => scene.map.setBasemap(basemapFor(dark)));

/* A plain subscriber — no map involved. */
scene.source.subscribe(() => {
  const counts = { running: 0, loading: 0, delayed: 0 };
  for (const feature of scene.source.getFeatures()) counts[feature.properties.status]++;
  board.innerHTML =
    `<code>running</code> ${counts.running} · ` +
    `<code>loading</code> ${counts.loading} · ` +
    `<code>delayed</code> ${counts.delayed}`;
  ui.hud("features", num(scene.source.size));
});

function reset(next) {
  size = next;
  scene.source.replace(makeFleet(size));
}

fpsMeter((value) => ui.hud("fps", value.toFixed(0)));

let lastSecond = performance.now();
setInterval(() => {
  const now = performance.now();
  ui.hud("updates/s", num((ticks * scene.source.size * 1000) / (now - lastSecond)));
  ticks = 0;
  lastSecond = now;
}, 1000);

setInterval(() => {
  if (!running) return;
  advance(scene.source, speed);
  ticks++;
}, 100);

reset(size);
