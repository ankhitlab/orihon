/* Page wiring for the GeoJSON demo. */

import {
  mountDemo, isDark, onTheme, num, panel, field, row, segmented, slider, action
} from "../../assets/shell.js";
import { createScene, makeData, zoneStyle, RANGES, basemapFor } from "./map.js";

let metric = "demand";
let threshold = 0;

const data = makeData();

const thresholdControl = slider({
  min: 0, max: RANGES[metric], step: 1, value: 0,
  format: (value) => (value === 0 ? "all" : `≥ ${value}`),
  onInput: (value) => {
    threshold = value;
    restyle();
  }
});

const controls = panel(
  field(
    "Colour by",
    row(
      segmented(
        [
          { value: "demand", label: "demand" },
          { value: "growth", label: "growth" },
          { value: "delay", label: "delay" }
        ],
        metric,
        (value) => {
          metric = value;
          threshold = 0;
          thresholdControl.set(0);
          thresholdControl.querySelector("input").max = String(RANGES[metric]);
          restyle();
        }
      )
    )
  ),
  field("Show cells above", thresholdControl),
  field(
    "Layers",
    row(
      action("Zones", () => toggle(scene.zones)),
      action("Corridors", () => toggle(scene.corridors)),
      action("Depots", () => toggle(scene.depots))
    )
  ),
  field("Fit", row(action("Fit to zones", () => scene.map.fitBounds(scene.zones.getBounds(), { padding: 40 }))))
);

const ui = await mountDemo({
  title: "GeoJSON",
  badges: ["orihon/standard"],
  sources: [
    { name: "map.js", url: "./map.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  hud: ["zones", "corridors", "depots", "metric"],
  controls,
  notes: `
    <p class="note"><strong>One collection, three geometry types.</strong> Polygons, lines and
    points go through the same <code>geoJSON()</code> call. Points become whatever
    <code>pointToLayer</code> returns — here a <code>circleMarker</code> sized and painted
    from the feature's own <code>bays</code> property.</p>
    <p class="note"><strong>Style is a function of the feature.</strong> Switching the metric
    calls <code>layer.setStyle(fn)</code>: the features stay where they are, the paint
    changes. The threshold slider is the same call with a different closure.</p>
    <p class="note"><strong>Hundreds of polygons do not become hundreds of DOM nodes.</strong>
    <code>renderer: "canvas"</code> batches the zone grid. Leave it on <code>"auto"</code>
    and the layer switches at <code>canvasThreshold</code> (250 path features by default);
    the Advanced entry adds a WebGL batch on top of the same option.</p>
    <p class="note"><strong>Units are in the names.</strong> <code>radiusPixels</code>, not
    <code>radius</code> — you never have to guess whether a number is metres or pixels.</p>`
});

const scene = createScene({ container: ui.map, dark: isDark(), data });
onTheme((dark) => scene.map.setBasemap(basemapFor(dark)));

ui.hud("zones", num(data.zones.features.length));
ui.hud("corridors", num(data.corridors.features.length));
ui.hud("depots", num(data.depots.features.length));
restyle();

function restyle() {
  scene.zones.setStyle(zoneStyle(metric, threshold));
  ui.hud("metric", threshold ? `${metric} ≥ ${threshold}` : metric);
}

function toggle(layer) {
  if (scene.map.hasLayer(layer)) layer.remove();
  else layer.addTo(scene.map);
}
