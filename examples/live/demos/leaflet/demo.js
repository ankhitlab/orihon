/* Page wiring: two maps, one scene, synchronised cameras. */

import { mountDemo, isDark, onTheme } from "../../assets/shell.js";
import { createScene as createOrihon } from "./map.js";
import { createScene as createLeaflet } from "./leaflet.js";

/* Leaflet's own stylesheet, loaded the way its docs say to. */
const css = document.createElement("link");
css.rel = "stylesheet";
css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
document.head.append(css);

const data = makeData();

const ui = await mountDemo({
  title: "Coming from Leaflet",
  badges: ["orihon/standard"],
  sources: [
    { name: "map.js", url: "./map.js" },
    { name: "leaflet.js", url: "./leaflet.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  notes: `
    <p class="note"><strong>Two files, one scene.</strong> <code>leaflet.js</code> and
    <code>map.js</code> build the same basemap, route, area, marker and GeoJSON collection.
    Switch between them in the code panel above — the structure is deliberately the same, so
    what you are reading is the vocabulary, not a rewrite.</p>
    <p class="note"><strong>What actually differs.</strong></p>
    <div class="note"><ul>
      <li><code>[lat, lng]</code> becomes <code>{ lat, lng }</code>. A bare tuple cannot
        silently swap the two, and <code>latLng()</code> / <code>lngLat()</code> /
        <code>fromGeoJSONPosition()</code> name the order when you convert.</li>
      <li><code>weight</code>, <code>color</code>, <code>fillColor</code> become
        <code>strokeWidth</code>, <code>stroke</code>, <code>fill</code> — SVG's own names.
        <code>radius</code> becomes <code>radiusPixels</code>, because the other kind of
        radius is metres.</li>
      <li>Popups and tooltips are options on the thing you are creating, so a marker is one
        call rather than a call plus two <code>bind*</code> lines.</li>
      <li><strong>A popup string is text, not HTML.</strong> Leaflet's
        <code>bindPopup("&lt;b&gt;…&lt;/b&gt;")</code> sets <code>innerHTML</code>; Orihon
        escapes it, so the same line renders differently on the two halves above. Rich
        content is built from blocks with <code>popupContent()</code> in
        <code>orihon/popup-content</code>, whose <code>popupHtml</code> block is the single
        place an HTML string is accepted — and it is sanitized there. This is the one
        migration step that fails quietly rather than loudly, so it is worth grepping for.</li>
      <li>The basemap is a map option. <code>onEachFeature</code> stays available, but
        <code>popup:</code> covers the common case directly.</li>
    </ul></div>
    <p class="note"><strong>And the Layer API is still there.</strong>
    <code>polygon(rings, style).addTo(map)</code> reads exactly like the Leaflet sentence;
    the Easy calls above are the map-centric shorthand, not a replacement. Both are public.</p>
    <p class="note"><strong>Sizes, since it always comes up.</strong> Leaflet 1.9.4 is about
    42 KiB gzip; <code>orihon/standard</code> is 37 KiB and carries GeoJSON, canvas vectors,
    overlays and locales. This page loads Leaflet's unminified ESM build on purpose, so do
    not read the network tab as a size comparison.</p>
    <p class="note">A full mapping lives in
    <code>docs/MIGRATION-LEAFLET.md</code>.</p>`
});

/* Two halves inside the stage instead of one map element. */
const split = document.createElement("div");
split.className = "split";
const left = half("Leaflet 1.9.4");
const right = half(`Orihon ${window.OrihonSite?.version ?? ""}`);
split.append(left.box, right.box);
ui.map.replaceWith(split);

const leaflet = createLeaflet({ container: left.map, dark: isDark(), data });
const orihon = createOrihon({ container: right.map, dark: isDark(), data });

/* Orihon watches its own container; Leaflet has to be told. */
new ResizeObserver(() => leaflet.map.invalidateSize()).observe(left.map);

/* Both halves have to swap basemaps together, and Leaflet's layer is not ours
   to reach into from here — a reload is the honest way to restage. */
onTheme(() => location.reload());

/* Camera sync, guarded so the two do not push each other around. */
let syncing = false;
orihon.map.on("move", () => {
  if (syncing) return;
  syncing = true;
  const center = orihon.map.getCenter();
  leaflet.map.setView([center.lat, center.lng], orihon.map.getZoom(), { animate: false });
  syncing = false;
});
leaflet.map.on("move", () => {
  if (syncing) return;
  syncing = true;
  const center = leaflet.map.getCenter();
  orihon.map.setView({ lat: center.lat, lng: center.lng }, leaflet.map.getZoom());
  syncing = false;
});

function half(label) {
  const box = document.createElement("div");
  const map = document.createElement("div");
  map.className = "pane-map";
  const tag = document.createElement("span");
  tag.className = "split-label";
  tag.textContent = label;
  box.append(map, tag);
  return { box, map };
}

function makeData() {
  const route = [
    [13.3694, 52.5251], [13.3777, 52.5163], [13.3900, 52.5170],
    [13.4050, 52.5200], [13.4132, 52.5219]
  ];
  const area = [
    [13.3500, 52.5140], [13.3560, 52.5320], [13.3900, 52.5300],
    [13.3830, 52.5120], [13.3500, 52.5140]
  ];
  const stops = {
    type: "FeatureCollection",
    features: [
      ["Hauptbahnhof", 13.3694, 52.5251, 88], ["Bundestag", 13.3760, 52.5186, 34],
      ["Potsdamer Platz", 13.3760, 52.5096, 71], ["Gendarmenmarkt", 13.3925, 52.5136, 52],
      ["Museumsinsel", 13.3972, 52.5194, 63], ["Alexanderplatz", 13.4132, 52.5219, 95],
      ["Hackescher Markt", 13.4020, 52.5230, 44], ["Nordbahnhof", 13.3880, 52.5320, 27]
    ].map(([name, lng, lat, load], i) => ({
      type: "Feature",
      id: `s-${i}`,
      properties: { name, load },
      geometry: { type: "Point", coordinates: [lng, lat] }
    }))
  };
  return { route, area, stops };
}
