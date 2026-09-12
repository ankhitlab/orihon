/* Page wiring for the draw demo: live GeoJSON output next to the map. */

import { mountDemo, isDark, onTheme, num, panel, field, row, action } from "../../assets/shell.js";
import { codeBlock } from "../../assets/hl.js";
import { createScene, loadSample, basemapFor } from "./map.js";

const output = codeBlock("{}", { label: "draw.handler.toGeoJSON()" });
output.style.margin = "0";

const controls = panel(
  field(
    "Try it",
    row(
      action("Load a sample", () => {
        loadSample(scene.draw);
        show(scene.draw.handler.toGeoJSON());
      }),
      action("Undo", () => scene.draw.undo()),
      action("Clear", () => {
        scene.draw.handler.featureGroup.clearLayers();
        show(scene.draw.handler.toGeoJSON());
      })
    )
  ),
  field(
    "Graticule",
    row(
      action("Toggle grid", () => {
        if (scene.map.hasLayer(scene.graticule)) scene.graticule.remove();
        else scene.graticule.addTo(scene.map);
      })
    )
  ),
  field("Current collection", output)
);

const ui = await mountDemo({
  title: "Draw and measure",
  badges: ["orihon/draw", "orihon/controls"],
  sources: [
    { name: "map.js", url: "./map.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  hud: ["features", "mode"],
  controls,
  notes: `
    <p class="note"><strong>Optional by construction.</strong> Draw and the extra controls are
    separate entry points — <code>orihon/draw</code> at 7 KiB gzip,
    <code>orihon/controls</code> at 3 KiB. A read-only map never pays for either. That is the
    whole reason they are not in the default build.</p>
    <p class="note"><strong>GeoJSON in, GeoJSON out.</strong> Every mutation event carries the
    complete <code>FeatureCollection</code>, and <code>loadData()</code> takes the same shape
    back. The panel below is <code>toGeoJSON()</code> printed verbatim after each edit.</p>
    <p class="note"><strong>Draw, then edit.</strong> Switch to the edit mode and drag a
    vertex; hold near existing geometry and it snaps within
    <code>snap.pixelTolerance</code>. Undo and redo keep a real history, including edits made
    from outside the plugin through <code>recordEdit()</code>.</p>
    <p class="note">The ruler in the top-right is <code>measureControl</code>; next to it is
    <code>fullscreenControl</code>, and the inset is <code>miniMap</code> — each a plain
    <code>Control</code> you add and remove like any other.</p>`
});

const scene = createScene({
  container: ui.map,
  dark: isDark(),
  onChange: show
});
onTheme((dark) => scene.map.setBasemap(basemapFor(dark)));

scene.draw.on("modechange", (event) => ui.hud("mode", event.mode));
ui.hud("mode", "off");

function show(collection) {
  output.setSource(JSON.stringify(collection, null, 2));
  ui.hud("features", num(collection.features.length));
}

show({ type: "FeatureCollection", features: [] });
