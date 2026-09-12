/* Landing page wiring: hero map, size table, gallery, API snippets. */

import { ready, isDark, onTheme, themeButton } from "./assets/shell.js";
import { codeBlock } from "./assets/hl.js";
import { createHero } from "./hero.js";
import { mountBench } from "./bench.js";

await ready();

const site = window.OrihonSite || { version: "2.0.1", origin: "npm", base: "" };

/* ------------------------------------------------------------- hero + copy - */

let hero = createHero({ container: document.getElementById("hero-map"), dark: isDark() });

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(button.dataset.copy);
    const previous = button.textContent;
    button.textContent = "copied";
    setTimeout(() => (button.textContent = previous), 1400);
  });
}

document.querySelector('[data-slot="theme"]').append(themeButton());
document.querySelector('[data-slot="origin"]').textContent =
  site.local ? `the local build in dist/` : `orihon ${site.version} from jsDelivr`;
document.querySelector('[data-slot="version"]').textContent = `orihon@${site.version}`;

/* The card under the hero map is hero.js itself, fetched as text. */
const heroSource = await fetch("./hero.js", { cache: "no-cache" })
  .then((response) => response.text())
  .catch(() => "");
const heroCard = codeBlock(trimHero(heroSource), { label: "hero.js — the map above" });
document.querySelector('[data-slot="hero-code"]').append(heroCard);

onTheme((dark) => {
  hero.destroy();
  hero = createHero({ container: document.getElementById("hero-map"), dark });
});

/** The card shows the first two overlays; the file adds one more of each kind. */
function trimHero(source) {
  const cut = source.indexOf("  map.addPolyline(");
  return cut < 0 ? source : `${source.slice(0, cut).trimEnd()}\n\n  // …route and marker\n}\n`;
}

/* ------------------------------------------------------------------ sizes - */

/*
 * Measured gzip bytes from dist/release-manifest.json, refreshed below when the site is
 * served from a checkout so the table cannot go stale silently.
 *
 * Every row is cumulative: what the browser downloads to reach that point, entry plus
 * the shared chunks it pulls in. Quoting an entry's own file would be true and useless —
 * the `orihon/core` facade alone is 690 bytes.
 *
 * Add-ons used to be listed on their own, which charged each of them the shared chunks a
 * tier already delivered: `orihon/react` read as 40.5 KiB where it actually adds 1.8, and
 * nobody imports it without a map anyway. The object manager is now quoted the way it is
 * used — on top of Advanced, which already carries the WebGL it needs.
 */
const SIZES = {
  "orihon.core.esm.js": 22122,
  "orihon.standard.esm.js": 48783,
  "orihon.esm.js": 132792,
  "orihon.advanced+object-manager": 165760
};

const ROWS = [
  ["orihon/core", "orihon.core.esm.js", "tier", "Map, camera, events, geometry, DOM raster tiles"],
  ["orihon", "orihon.standard.esm.js", "tier", "Core + markers, vectors, GeoJSON, popups, overlays, English locale"],
  ["orihon/advanced", "orihon.esm.js", "tier", "Standard + WebGL/WebGPU, vector tiles, heat, workers, routing"],
  ["orihon/advanced+object-manager", "orihon.advanced+object-manager", "tier", "Advanced + tens of thousands to millions of application objects"]
];

if (site.local) {
  await fetch(new URL("release-manifest.json", site.base), { cache: "no-cache" })
    .then((response) => (response.ok ? response.json() : null))
    .then((manifest) => {
      const loads = manifest?.initialLoads;
      const own = manifest?.sizes;
      if (!own || !loads) return;
      for (const file of Object.keys(SIZES)) {
        if (file === "orihon.advanced+object-manager") continue;
        // The initial load is the entry plus the chunks it drags in; fall back to the
        // entry's own size only when the manifest predates that field.
        const measured = loads[file]?.gzipBytes ?? own[file]?.gzipBytes;
        if (typeof measured === "number") SIZES[file] = measured;
      }
      // The pair shares most of its chunks, so summing the two loads would double-count.
      // Take the union of the files each pulls in and add every chunk exactly once.
      const advanced = loads["orihon.esm.js"]?.files;
      const objects = loads["orihon.object-manager.esm.js"]?.files;
      if (!advanced || !objects) return;
      let combined = 0;
      for (const file of new Set([...advanced, ...objects])) combined += own[file]?.gzipBytes ?? 0;
      if (combined > 0) SIZES["orihon.advanced+object-manager"] = combined;
    })
    .catch(() => {});
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const peak = Math.max(...ROWS.map(([, file]) => SIZES[file]));
const body = document.querySelector('[data-slot="sizes"]');

for (const [name, file, kind, what] of ROWS) {
  const tr = document.createElement("tr");
  tr.className = kind;
  tr.innerHTML =
    `<td>${name}</td>` +
    `<td><span class="track"><span class="fill" style="width:${(SIZES[file] / peak) * 100}%"></span></span></td>` +
    `<td class="n">${kib(SIZES[file])}</td>` +
    `<td class="what">${what}</td>`;
  body.append(tr);
}

document.querySelector('[data-slot="size-core"]').textContent = kib(SIZES["orihon.core.esm.js"]);
document.querySelector('[data-slot="size-standard"]').textContent = kib(SIZES["orihon.standard.esm.js"]);

/* ---------------------------------------------------------------- gallery - */

const DEMOS = [
  {
    href: "./demos/first-map/index.html",
    title: "Playground",
    blurb: "Edit a real ES module and run it against the map. Presets walk from a first marker to fifty thousand clustered objects.",
    badges: ["orihon/easy"],
    art: `<circle cx="80" cy="42" r="6" fill="var(--terracotta)"/>
          <path d="M20 62 C46 30 62 74 92 44 116 20 132 56 156 40" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round"/>
          <rect x="18" y="14" width="52" height="8" rx="4" fill="var(--water)" opacity="0.45"/>
          <rect x="18" y="28" width="34" height="8" rx="4" fill="var(--water)" opacity="0.3"/>`
  },
  {
    href: "./demos/scale/index.html",
    title: "A million objects",
    blurb: "One ObjectManager, GPU singles, worker cluster layout and a cooperative import. Counters read straight from getStats().",
    badges: ["orihon/object-manager", "WebGL"],
    art: dots()
  },
  {
    href: "./demos/ai-places/index.html",
    title: "An agent's intent",
    blurb: "One goal in, a compiled plan out: photo markers plus a route, previewed on a fork. Drop a stop and the route redraws with no model call.",
    badges: ["orihon/ai"],
    art: `<path d="M14 22 h44 M14 34 h30 M14 46 h38 M14 58 h24" stroke="var(--ink-3)" stroke-width="3" stroke-linecap="round" opacity="0.35"/>
          <path d="M70 12 v64" stroke="var(--line)" stroke-width="1.5"/>
          <path d="M78 44 h14" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="4 3"/>
          <path d="M88 38 l7 6 -7 6" fill="none" stroke="var(--ink-3)" stroke-width="2"/>
          <g stroke="var(--surface)" stroke-width="3">
            <circle cx="118" cy="30" r="13" fill="var(--water)"/>
            <circle cx="150" cy="52" r="15" fill="var(--accent)"/>
            <circle cx="172" cy="24" r="11" fill="var(--ochre)"/>
            <circle cx="126" cy="64" r="10" fill="var(--terracotta)"/>
          </g>`
  },
  {
    href: "./demos/live-data/index.html",
    title: "Live data",
    blurb: "One FeatureSource, three consumers: a GeoJSON layer, a collision-aware label layer and a plain subscriber.",
    badges: ["orihon/source"],
    art: `<path d="M14 66 C50 58 62 26 104 30 138 33 148 52 166 48" fill="none" stroke="var(--water)" stroke-width="2" stroke-dasharray="5 5"/>
          <path d="M14 30 C48 24 74 62 118 62 146 62 154 70 168 68" fill="none" stroke="var(--water)" stroke-width="2" stroke-dasharray="5 5"/>
          <circle cx="62" cy="48" r="4.5" fill="var(--accent)"/><circle cx="104" cy="30" r="4.5" fill="var(--terracotta)"/>
          <circle cx="132" cy="63" r="4.5" fill="var(--ochre)"/><circle cx="34" cy="27" r="4.5" fill="var(--accent)"/>`
  },
  {
    href: "./demos/geojson/index.html",
    title: "GeoJSON, styled by data",
    blurb: "Polygons, lines and points from one collection, restyled live through a style function and a canvas batch.",
    badges: ["orihon/standard"],
    art: hexes()
  },
  {
    href: "./demos/heat/index.html",
    title: "Heat and isolines",
    blurb: "A scalar field and its labelled contours from the same grid, built on a worker, backend resolved at run time.",
    badges: ["orihon/advanced", "WASM"],
    art: rings()
  },
  {
    href: "./demos/draw/index.html",
    title: "Draw and measure",
    blurb: "Draw, snap, edit, undo and measure — then read the whole thing back out as GeoJSON, live in the panel.",
    badges: ["orihon/draw", "orihon/controls"],
    art: `<path d="M34 62 L58 24 L104 32 L132 60 L96 74 Z" fill="var(--water)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="2"/>
          <g fill="var(--surface)" stroke="var(--terracotta)" stroke-width="2">
            <rect x="30" y="58" width="8" height="8"/><rect x="54" y="20" width="8" height="8"/>
            <rect x="100" y="28" width="8" height="8"/><rect x="128" y="56" width="8" height="8"/>
            <rect x="92" y="70" width="8" height="8"/>
          </g>`
  },
  {
    href: "./demos/react/index.html",
    title: "React bindings",
    blurb: "State drives the layers: filter the list and markers unmount, click the map and React state grows a new one.",
    badges: ["orihon/react"],
    art: `<rect x="18" y="14" width="70" height="60" rx="8" fill="none" stroke="var(--water)" stroke-width="2"/>
          <path d="M99 44 h26" stroke="var(--ink-3)" stroke-width="2" stroke-dasharray="4 4"/>
          <path d="M119 38 l8 6 -8 6" fill="none" stroke="var(--ink-3)" stroke-width="2"/>
          <g stroke="var(--water)" stroke-width="1.6" fill="none">
            <ellipse cx="53" cy="44" rx="26" ry="10"/>
            <ellipse cx="53" cy="44" rx="26" ry="10" transform="rotate(60 53 44)"/>
            <ellipse cx="53" cy="44" rx="26" ry="10" transform="rotate(120 53 44)"/>
          </g>
          <circle cx="53" cy="44" r="4" fill="var(--water)"/>
          <path d="M150 56 a9 9 0 1 1 0.01 0 z" fill="var(--terracotta)"/>
          <path d="M150 34 l7 14 -14 0 z" fill="var(--terracotta)"/>`
  },
  {
    href: "./demos/flat/index.html",
    title: "Not the Earth",
    blurb: 'crs: "Simple" swaps Mercator for a flat plane — a floor plan in metres, with the same layers, popups and measuring.',
    badges: ["orihon/core", "CRS.Simple"],
    art: `<g stroke="var(--line)" stroke-width="1">
            ${Array.from({ length: 9 }, (_, i) => `<path d="M${14 + i * 20} 8 v72"/>`).join("")}
            ${Array.from({ length: 5 }, (_, i) => `<path d="M14 ${12 + i * 17} h160"/>`).join("")}
          </g>
          <rect x="20" y="14" width="62" height="40" fill="var(--water)" fill-opacity="0.22" stroke="var(--water)" stroke-width="2"/>
          <rect x="20" y="54" width="30" height="26" fill="var(--accent)" fill-opacity="0.22" stroke="var(--accent)" stroke-width="2"/>
          <rect x="92" y="14" width="42" height="24" fill="var(--ochre)" fill-opacity="0.22" stroke="var(--ochre)" stroke-width="2"/>
          <rect x="92" y="44" width="42" height="36" fill="var(--terracotta)" fill-opacity="0.18" stroke="var(--terracotta)" stroke-width="2"/>
          <circle cx="66" cy="30" r="4" fill="var(--terracotta)"/><circle cx="112" cy="62" r="4" fill="var(--terracotta)"/>`
  },
  {
    href: "./demos/leaflet/index.html",
    title: "Coming from Leaflet",
    blurb: "The same scene written twice, side by side, cameras synced. Read the two files against each other.",
    badges: ["migration"],
    art: `<rect x="10" y="12" width="80" height="64" rx="6" fill="var(--water)" fill-opacity="0.16" stroke="var(--water)" stroke-width="1.5"/>
          <rect x="98" y="12" width="80" height="64" rx="6" fill="var(--accent)" fill-opacity="0.14" stroke="var(--accent)" stroke-width="1.5"/>
          <path d="M22 58 C38 40 52 56 78 30" fill="none" stroke="var(--water)" stroke-width="2.2"/>
          <path d="M110 58 C126 40 140 56 166 30" fill="none" stroke="var(--terracotta)" stroke-width="2.2"/>`
  }
];

const gallery = document.querySelector('[data-slot="gallery"]');
for (const demo of DEMOS) {
  const card = document.createElement("a");
  card.className = "demo-card";
  card.href = demo.href;
  card.innerHTML =
    `<svg class="thumb" viewBox="0 0 188 88" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${demo.art}</svg>` +
    `<div class="body"><h3>${demo.title}</h3><p>${demo.blurb}</p>` +
    `<div class="foot">${demo.badges
      .map((badge) => `<span class="pill pill-mono">${badge}</span>`)
      .join("")}</div></div>`;
  gallery.append(card);
}

function dots() {
  let art = "";
  let seed = 9;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 130; i++) {
    const x = 12 + random() * 164;
    const y = 8 + random() * 72;
    art += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.5" fill="var(--water)" opacity="0.55"/>`;
  }
  for (const [x, y, r] of [[54, 34, 13], [112, 52, 16], [148, 24, 10]]) {
    art += `<circle cx="${x}" cy="${y}" r="${r}" fill="var(--terracotta)" opacity="0.85"/>`;
  }
  return art;
}

function hexes() {
  let art = "";
  const w = 13;
  const h = 11;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 9; col++) {
      const cx = 20 + col * w * 1.5 + (row % 2 ? w * 0.75 : 0);
      const cy = 12 + row * h * 1.4;
      const points = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 180) * (60 * i + 30);
        return `${(cx + w * 0.62 * Math.cos(a)).toFixed(1)},${(cy + w * 0.62 * Math.sin(a)).toFixed(1)}`;
      }).join(" ");
      const heat = Math.max(0, 1 - Math.hypot(cx - 92, cy - 44) / 78);
      art += `<polygon points="${points}" fill="var(--accent)" opacity="${(0.12 + heat * 0.72).toFixed(2)}"/>`;
    }
  }
  return art;
}

function rings() {
  let art = "";
  for (let i = 6; i >= 1; i--) {
    art +=
      `<ellipse cx="94" cy="44" rx="${i * 13}" ry="${i * 7}" fill="none" ` +
      `stroke="${i > 4 ? "var(--water)" : i > 2 ? "var(--ochre)" : "var(--terracotta)"}" ` +
      `stroke-width="1.6" opacity="${(0.35 + (7 - i) * 0.1).toFixed(2)}"/>`;
  }
  return art;
}

/* ------------------------------------------------------------ API snippets - */

const SNIPPETS = [
  {
    label: "Easy",
    name: "easy.js",
    code: `import { createMap } from "orihon/easy";
import "orihon/orihon.css";

const map = createMap("map", {
  center: { lat: 52.52, lng: 13.405 },
  zoom: 12,
  basemap: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors"
  }
});

map.addMarker({
  position: { lat: 52.52, lng: 13.405 },
  appearance: { shape: "pin", color: "#c1501f" },
  popup: "Berlin"
});`
  },
  {
    label: "Layer API",
    name: "layers.js",
    code: `import { createMap, tileLayer, marker, polygon } from "orihon";
import "orihon/orihon.css";

const map = createMap("map", { center: { lat: 52.52, lng: 13.405 }, zoom: 12 });

tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

marker({ lat: 52.52, lng: 13.405 }, { shape: "pin", color: "#c1501f" })
  .addTo(map)
  .bindPopup("Berlin");

const area = polygon(
  [
    { lat: 52.50, lng: 13.38 },
    { lat: 52.54, lng: 13.39 },
    { lat: 52.53, lng: 13.45 }
  ],
  { fill: "#0b463c", fillOpacity: 0.2, stroke: "#0b463c" }
).addTo(map);

// event name and payload are both typed
area.on("click", (event) => console.log(event.latlng));`
  },
  {
    label: "React",
    name: "Map.tsx",
    code: `import { Map, TileLayer, Marker, Popup } from "orihon/react";
import "orihon/orihon.css";

export function City() {
  return (
    <Map center={{ lat: 52.52, lng: 13.405 }} zoom={12} style={{ height: "100vh" }}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
      />
      <Marker position={{ lat: 52.52, lng: 13.405 }} shape="pin" color="#c1501f">
        <Popup>Berlin</Popup>
      </Marker>
    </Map>
  );
}`
  }
];

const apiSwitch = document.querySelector('[data-slot="api-switch"]');
const apiCard = codeBlock(SNIPPETS[0].code, { label: SNIPPETS[0].name });
document.querySelector('[data-slot="api-code"]').append(apiCard);

SNIPPETS.forEach((snippet, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = snippet.label;
  button.ariaPressed = String(index === 0);
  button.addEventListener("click", () => {
    for (const other of apiSwitch.children) other.ariaPressed = String(other === button);
    apiCard.setSource(snippet.code, snippet.name);
  });
  apiSwitch.append(button);
});

/* ------------------------------------------------------------- benchmarks - */

mountBench();

/* -------------------------------------------------------------------- ai - */

document.querySelector('[data-slot="ai-code"]').append(
  codeBlock(
    `import {
  createAICommandEngine,
  createAIAgentRuntime,
  createAIIntentTool
} from "orihon/ai";

const engine = createAICommandEngine();
const runtime = createAIAgentRuntime(engine);

// One tool, described to the model in the runtime's own vocabulary.
const tool = createAIIntentTool(runtime);
model.registerTool(tool.definition);
model.setSystemPrompt(tool.systemPrompt);

// What comes back is a goal — no route geometry, no map calls.
const done = runtime.execute({
  goal: "create_visit_route",
  collection: "berlin-highlights",
  routeId: "berlin-walk",
  route: { optimize: "shortest" },
  points: [
    {
      id: "brandenburg-gate",
      position: { lat: 52.5163, lng: 13.3777 },
      title: "Brandenburg Gate",
      visual: { image: { url: photo, shape: "circle" } }
    }
    // …
  ]
});

// Compiled to object-manager -> route-model, previewed on a private fork,
// committed as one revision. Failure is repairable, not thrown:
if (!done.ok) console.error(done.error); // { code, path, message, received }`,
    { label: "agent-runtime.js" }
  )
);
