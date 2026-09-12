/* Page wiring for the React demo: mount the app, mirror its state into the HUD. */

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { mountDemo, isDark, onTheme, num } from "../../assets/shell.js";
import { App, INITIAL_STOPS } from "./map.js";

const ui = await mountDemo({
  title: "React bindings",
  badges: ["orihon/react"],
  sources: [
    { name: "map.js", url: "./map.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  hud: ["stops", "react"],
  notes: `
    <p class="note"><strong>A binding, not a second engine.</strong> <code>&lt;Map&gt;</code>
    owns a real Orihon instance and every child mounts a real layer, so anything the
    components do not cover is one <code>useMap()</code> away — the imperative API stays
    reachable instead of being walled off.</p>
    <p class="note"><strong>State drives the map.</strong> The markers here are
    <code>stops.map(...)</code>. Filtering the list unmounts layers; clicking the map appends
    to React state and a marker appears. No <code>addLayer</code> call anywhere in
    <code>map.js</code>.</p>
    <p class="note"><strong>Events are components.</strong> <code>useMapEvent("click", …)</code>
    subscribes and cleans up with the component. The legend floating over the map is plain
    React rendered as a child of <code>&lt;Map&gt;</code>.</p>
    <p class="note"><strong>Optional peers.</strong> React and React DOM are
    <code>peerDependenciesMeta.optional</code>, so an application that never imports
    <code>orihon/react</code> does not install or ship them. This page loads React 18.3.1 from
    a CDN, which is why the code uses <code>createElement</code> — with a bundler you would
    write the same components as JSX.</p>`
});

let root = null;
let stops = INITIAL_STOPS.length;

function mount(dark) {
  root?.unmount();
  ui.map.replaceChildren();
  root = createRoot(ui.map);
  root.render(
    createElement(App, {
      dark,
      initialStops: INITIAL_STOPS,
      onCountChange: (count) => {
        stops = count;
        ui.hud("stops", num(stops));
      }
    })
  );
  ui.hud("stops", num(stops));
  ui.hud("react", "18.3.1");
}

onTheme((dark) => mount(dark));
mount(isDark());
