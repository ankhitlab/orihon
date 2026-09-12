/* Page wiring for the Simple-CRS demo: measure a path in plain floor units. */

import { mountDemo, panel, field, row, action, num } from "../../assets/shell.js";
import { createScene, pathLength } from "./map.js";

const readout = document.createElement("div");
readout.className = "note";

const controls = panel(
  field(
    "Measure the floor",
    row(
      action("Click points on the map", () => reset()),
      action("Reset", () => reset())
    )
  ),
  field("Result", readout)
);

const ui = await mountDemo({
  title: "Not the Earth",
  badges: ["orihon/core", 'crs: "Simple"'],
  sources: [
    { name: "map.js", url: "./map.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  hud: ["crs", "units", "picked", "length"],
  controls,
  notes: `
    <p class="note"><strong>Same library, different space.</strong>
    <code>crs: "Simple"</code> replaces Web Mercator with a flat Euclidean plane:
    <code>lat</code> is y, <code>lng</code> is x, and there is no basemap because nothing is
    being tiled. Polygons, polylines, image overlays, popups, tooltips and the zoom control
    behave exactly as they do on a world map.</p>
    <p class="note"><strong>Distances come back in your units.</strong> On this map
    <code>map.distance()</code> is straight Pythagoras — the coordinates are metres of
    warehouse floor, so the answer is metres of warehouse floor. Click points on the plan and
    the length adds up below.</p>
    <p class="note"><strong>What it is for.</strong> Floor plans, site layouts, scanned
    drawings, wafer and microscopy imagery, game worlds — anything with coordinates that were
    never on a globe. The plan under the geometry is an
    <code>imageOverlay</code> pinned to two corners; swap in a real scan and the rooms stay
    where they are.</p>
    <p class="note"><strong>The one limit.</strong> GPU layers need Web Mercator and say so:
    asking for one here throws <code>CRSCompatibilityError</code> rather than drawing in the
    wrong place.</p>`
});

const scene = createScene({ container: ui.map });
const picked = [];

ui.hud("crs", "Simple");
ui.hud("units", "floor metres");
update();

scene.map.on("click", (event) => {
  picked.push(event.latlng);
  update();
});

function update() {
  ui.hud("picked", num(picked.length));
  const length = picked.length > 1 ? pathLength(scene.map, picked) : 0;
  ui.hud("length", `${length.toFixed(1)} m`);
  readout.innerHTML = picked.length
    ? `${picked.length} point${picked.length === 1 ? "" : "s"} · <code>${length.toFixed(1)} m</code>` +
      `<br><small>last: x ${picked.at(-1).lng.toFixed(1)}, y ${picked.at(-1).lat.toFixed(1)}</small>`
    : "Click two or more points on the plan.";
}

function reset() {
  picked.length = 0;
  update();
}
