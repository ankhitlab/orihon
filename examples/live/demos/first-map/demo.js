/* Playground page wiring.
   The snippet in the panel is compiled to a real ES module and imported, so the
   `import { createMap } from "orihon/easy"` you read is the import that runs. */

import { mountDemo, isDark, onTheme, basemapUrl } from "../../assets/shell.js";
import { highlight } from "../../assets/hl.js";

/* Any XYZ raster template works. This one is Esri's neutral canvas: no key,
   and it has a dark variant, so the map follows the page theme. */
const basemap = (dark) => `  basemap: {
    url: "${basemapUrl(dark)}",
    attribution: "Tiles © Esri",
    maxNativeZoom: 16
  }`;

const PRESETS = [
  {
    name: "A map and a marker",
    code: (dark) => `import { createMap } from "orihon/easy";

export const map = createMap("map", {
  center: { lat: 52.52, lng: 13.405 },
  zoom: 12,
${basemap(dark)}
});

map.addMarker({
  position: { lat: 52.52, lng: 13.405 },
  appearance: { shape: "pin", color: "#c1501f" },
  // Popup strings are text, never HTML. Rich content goes through
  // orihon/popup-content — see the GeoJSON preset.
  popup: "Berlin — Brandenburger Tor"
});
`
  },
  {
    name: "Route and area",
    code: (dark) => `import { createMap } from "orihon/easy";

export const map = createMap("map", {
  center: { lat: 52.52, lng: 13.405 },
  zoom: 12,
${basemap(dark)}
});

const route = map.addPolyline({
  points: [
    { lat: 52.5251, lng: 13.3694 },
    { lat: 52.5163, lng: 13.3777 },
    { lat: 52.5200, lng: 13.4050 },
    { lat: 52.5219, lng: 13.4132 }
  ],
  style: { stroke: "#c1501f", strokeWidth: 5, arrow: "end" },
  tooltip: "Hauptbahnhof → Alexanderplatz"
});

map.addPolygon({
  rings: [
    { lat: 52.5140, lng: 13.3500 },
    { lat: 52.5320, lng: 13.3560 },
    { lat: 52.5300, lng: 13.3900 },
    { lat: 52.5120, lng: 13.3830 }
  ],
  style: { fill: "#2d7285", fillOpacity: 0.22, stroke: "#2d7285", strokeWidth: 2 },
  popup: "Tiergarten"
});

map.fitBounds(route.getBounds(), { padding: 64 });
`
  },
  {
    name: "GeoJSON, styled by data",
    code: (dark) => `import { createMap } from "orihon/easy";
import { circleMarker } from "orihon";
import { popupContent } from "orihon/popup-content";

export const map = createMap("map", {
  center: { lat: 52.515, lng: 13.4 },
  zoom: 11,
${basemap(dark)}
});

const stations = {
  type: "FeatureCollection",
  features: [
    ["Hauptbahnhof", 13.3694, 52.5251, 329],
    ["Alexanderplatz", 13.4132, 52.5219, 174],
    ["Zoologischer Garten", 13.3327, 52.5073, 96],
    ["Ostkreuz", 13.4694, 52.5030, 148],
    ["Südkreuz", 13.3653, 52.4757, 88]
  ].map(([name, lng, lat, trains]) => ({
    type: "Feature",
    properties: { name, trains },
    geometry: { type: "Point", coordinates: [lng, lat] }
  }))
};

const layer = map.addGeoJSON({
  data: stations,
  // Radius carries the number; colour carries the threshold.
  pointToLayer: (feature, position) =>
    circleMarker(position, {
      radiusPixels: 6 + feature.properties.trains / 22,
      fill: feature.properties.trains > 150 ? "#c1501f" : "#2d7285",
      fillOpacity: 0.85,
      stroke: "#fbf4ed",
      strokeWidth: 2
    }),
  // A popup string is escaped, never parsed. Structured content is built from
  // blocks instead, and popupHtml is the one place HTML is sanitized and used.
  popup: (feature) =>
    popupContent({
      title: feature.properties.name,
      children: [
        { type: "popupText", props: { text: \`\${feature.properties.trains} trains/day\`, tone: "lead" } }
      ]
    })
});

map.fitBounds(layer.getBounds(), { padding: 60 });
`
  },
  {
    name: "50 000 objects, clustered",
    code: (dark) => `import { createMap } from "orihon/easy";
import { objectManager } from "orihon/object-manager";

export const map = createMap("map", {
  center: { lat: 52.52, lng: 13.405 },
  zoom: 9,
${basemap(dark)}
});

const manager = objectManager({
  clusterize: true,
  clusterRenderer: "auto"
}).addTo(map);

const objects = [];
for (let i = 0; i < 50_000; i++) {
  objects.push({
    id: i,
    coordinates: {
      lat: 52.52 + (Math.random() - 0.5) * 0.42,
      lng: 13.405 + (Math.random() - 0.5) * 0.72
    },
    properties: { title: "Sensor " + i }
  });
}

// Imports in cooperative chunks so the map keeps answering the pointer.
await manager.addAsync(objects, { chunkSize: 10_000 });

manager.bindPopup((object) => object.properties.title);
`
  }
];

/* --------------------------------------------------------------- editor UI - */

function buildEditor() {
  const editor = document.createElement("div");
  editor.className = "editor";

  const bar = document.createElement("div");
  bar.className = "code-bar";
  const label = document.createElement("span");
  label.textContent = "playground.js";
  const select = document.createElement("select");
  select.className = "preset";
  PRESETS.forEach((preset, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = preset.name;
    select.append(option);
  });
  const grow = document.createElement("span");
  grow.className = "grow";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "copy";
  copy.textContent = "copy";
  bar.append(label, select, grow, copy);

  const area = document.createElement("div");
  area.className = "editor-area";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  pre.append(code);
  const textarea = document.createElement("textarea");
  textarea.spellcheck = false;
  textarea.autocapitalize = "off";
  textarea.autocomplete = "off";
  textarea.setAttribute("aria-label", "Editable Orihon module");
  area.append(pre, textarea);

  const foot = document.createElement("div");
  foot.className = "editor-foot";
  const run = document.createElement("button");
  run.type = "button";
  run.className = "run";
  run.textContent = "Run ⌘⏎";
  const status = document.createElement("span");
  status.className = "editor-status";
  foot.append(run, status);

  editor.append(bar, area, foot);

  const paint = () => {
    code.innerHTML = highlight(textarea.value);
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  };

  textarea.addEventListener("input", paint);
  textarea.addEventListener("scroll", () => {
    pre.scrollTop = textarea.scrollTop;
    pre.scrollLeft = textarea.scrollLeft;
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const { selectionStart: start, selectionEnd: end, value } = textarea;
      textarea.value = `${value.slice(0, start)}  ${value.slice(end)}`;
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      paint();
    }
  });
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(textarea.value);
    copy.textContent = "copied";
    copy.dataset.done = "1";
    setTimeout(() => {
      copy.textContent = "copy";
      delete copy.dataset.done;
    }, 1400);
  });

  return { editor, textarea, select, run, status, paint };
}

/* ------------------------------------------------------------------- boot - */

const parts = buildEditor();

const ui = await mountDemo({
  title: "Playground",
  badges: ["orihon/easy"],
  code: parts.editor,
  codeLabel: "playground.js",
  notes: `
    <p class="note"><strong>Everything here is real.</strong> The text in the editor is
    compiled to an ES module and imported by the page, with the same
    <code>"orihon/easy"</code> specifier an application would use. There is no sandbox
    translating anything for you.</p>
    <p class="note">Presets walk up the ladder: the Easy API for a first map, then
    vector overlays, then GeoJSON with a data-driven style function, then
    <code>orihon/object-manager</code> for 50 000 objects imported in cooperative
    chunks.</p>
    <p class="note">Rules of the road:</p>
    <div class="note"><ul>
      <li><code>export const map = …</code> lets the page dispose of the previous run.</li>
      <li>Top-level <code>await</code> works — it is a module, not an eval string.</li>
      <li><kbd>⌘/Ctrl</kbd>+<kbd>Enter</kbd> runs. Errors land in the status line.</li>
    </ul></div>`
});

let mapEl = ui.map;
let instance = null;
let objectUrl = null;

function say(message, state = "") {
  parts.status.textContent = message;
  parts.status.dataset.state = state;
}

async function run() {
  const started = performance.now();
  say("running…");

  try { instance?.destroy(); } catch { /* previous run already gone */ }
  instance = null;

  const fresh = document.createElement("div");
  fresh.className = "map";
  fresh.id = "map";
  mapEl.replaceWith(fresh);
  mapEl = fresh;

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(new Blob([parts.textarea.value], { type: "text/javascript" }));

  try {
    const module = await import(objectUrl);
    instance = module.map ?? null;
    if (!instance) say("ran, but nothing was exported as `map`", "");
    else say(`ok · ${Math.round(performance.now() - started)} ms`, "ok");
  } catch (error) {
    say(String(error?.message || error), "error");
  }
}

function load(index) {
  parts.textarea.value = PRESETS[index].code(isDark());
  parts.paint();
  run();
}

parts.run.addEventListener("click", run);
parts.select.addEventListener("change", () => load(Number(parts.select.value)));
parts.textarea.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    run();
  }
});
onTheme(() => load(Number(parts.select.value)));

load(0);
