# Orihon demo site

A self-contained, publishable site: one landing page plus ten demos, written to
show a working programmer what the library is like to use.

```
examples/live/
├── index.html          landing page
├── home.js             landing wiring (hero map, size table, gallery)
├── hero.js             the hero map, shown verbatim on the page
├── bench.js            renders the benchmark tables
├── bench-data.js       measured benchmark numbers (generated)
├── server.mjs          static server, no dependencies
├── assets/
│   ├── boot.js         dist/CDN resolver + import map installer (classic script)
│   ├── shell.js        demo page chrome: header, tabs, controls, HUD
│   ├── hl.js           tiny JS highlighter and code block
│   ├── site.css        design system
│   └── brand/          logo and favicon
└── demos/
    ├── first-map/      editable playground, runs what you type
    ├── scale/          a million objects, ObjectManager + WebGL
    ├── live-data/      one FeatureSource, three consumers
    ├── geojson/        data-driven styling over a hex grid
    ├── heat/           heat field and labelled isolines
    ├── draw/           draw, snap, edit, measure, export GeoJSON
    ├── ai-places/      replay a captured agent plan through orihon/ai
    ├── react/          orihon/react bindings, state-driven layers
    ├── flat/           crs: "Simple" — a floor plan in plain metres
    └── leaflet/        the same scene in Leaflet and Orihon, side by side
```

## Run it

```bash
node examples/live/server.mjs
```

Then open <http://localhost:4180/examples/live/index.html>. The server hosts the
repository root, so the pages load `dist/` — run `npm run build` first if that
directory is missing or stale. The badge in each demo header says which build is
running.

To rehearse a deployment, serve only this folder:

```bash
node examples/live/server.mjs --port 4181 --standalone
```

`dist/` is then out of reach and every page falls back to `orihon@2.0.1` on
jsDelivr, which is what a plain static host will do.

## Publish it

Two options, both static — there is no build step and no bundler.

**Upload this folder.** Copy `examples/live/` to any static host, CDN bucket or
GitHub Pages directory. The pages resolve Orihon from jsDelivr. Nothing else is
needed.

**Upload it next to a build.** Keep the relative layout so that `dist/` sits two
levels above the site:

```
<web root>/dist/…            (npm run build output)
<web root>/examples/live/…   (this folder)
```

The pages then serve the exact build you shipped rather than the published
package. `assets/boot.js` probes `dist/geo-entry.js` once and picks whichever is
there.

Pin a different published version by changing `VERSION` at the top of
`assets/boot.js`.

## How the pages are wired

`assets/boot.js` is a classic script rather than a module, because an import map
has to be installed before the first module resolves. It picks the base URL,
inserts `orihon.css` ahead of `site.css` so the site's layout rules win, installs
the import map, then loads the page entry.

That is what lets every demo be written with real specifiers:

```js
import { createMap } from "orihon/easy";
import { objectManager } from "orihon/object-manager";
```

Each demo is two files. `map.js` is library code only — it is what the code panel
displays, fetched as text so it cannot drift from what ran, and it pastes into a
project unchanged. `demo.js` is the page wiring: controls, counters, rebuilds.
Both are readable from the panel's file switcher.

## Notes

- Basemap tiles come from Esri's grey canvas: no key, and it has a dark variant,
  so the map follows the page theme. The library is not tied to any provider —
  the tile template is a plain option in every demo.
- The size table on the landing page carries measured gzip numbers and refreshes
  itself from `dist/release-manifest.json` when the site is served from a
  checkout, so it cannot go stale silently.
- The Leaflet comparison loads Leaflet 1.9.4 from unpkg. It is the only
  third-party runtime dependency anywhere on the site, and only on that page.

## Regenerating the benchmark table

The table in the `#bench` section is generated, not typed. `bench.js` renders whatever
`bench-data.js` contains: one tab per kind of check, and every cell carrying both
dataset sizes as `small / large`.

To refresh the numbers:

1. Serve the repository and open `examples/bench-compare/index.html`.
2. Run each scenario in `bench-data.js` (`points`, `clusters`, `heatmap`, `geojson`,
   `live`, `pick`) at **50,000** and at **1,000,000**, leaving all four engines checked.
3. After each run, copy the results table — or use *Export JSON*, which writes the same
   rows in the harness’ own shape.
4. Rebuild `bench-data.js` from those rows.

> **Driving it unattended.** The harness times frames with `requestAnimationFrame`, which a
> hidden or backgrounded tab does not fire — a sweep driven from a background browser tab
> simply stops partway with no error. Run it in a foreground tab, or drive it from a headless
> Playwright page, which keeps animating and finishes the whole matrix without supervision.
 Each scenario needs `key`, `label`, `unit`,
   `note`, `columns` (`[heading, key]` pairs), `rows` and a one-line `verdict`. Every
   row value is a two-element array: `[at 50k, at 1M]`.
5. Update `env` and `runs` at the top of the object — they are printed under the table,
   so stale hardware or run counts would be a false claim.

Keep the scenario list to checks that scale with the dataset and that all four engines
can actually be asked to do. Where one cannot, leave the cell as `"—"` and say why in
that scenario’s `verdict` rather than dropping the row.

## What the landing page claims, and where the numbers come from

- **Sizes** — measured gzip from `dist/release-manifest.json`, refreshed at run time when
  the site is served from a checkout.
- **Benchmarks** — six scenarios of `examples/bench-compare` at two dataset sizes, kept in
  `bench-data.js`. See *Regenerating the benchmark table* below.
- **Localization** — nine languages in `src/ui/locale-packs.ts` (core UI),
  `src/draw/locale.ts` (draw toolbar) and the fullscreen/measure labels in
  `src/controls.ts`. `test/control-locale.test.js` guards that every shipped control
  follows `map.setLocale()`.
- **orihon/ai** — on `main`, not in the published 2.0.1. The landing section says so, and
  `demos/ai-places/` degrades to an explanatory message in CDN mode instead of failing.
  Drop both once a release carries the `./ai` export.
- **demos/ai-places/plan.json** — seven Berlin landmarks captured from the Wikipedia REST
  summary API (the endpoint `src/ai/place-search.ts` itself defaults to), then checked with
  `validatePointsReplaceCommand()` before being committed. No model is involved at run time.
- **create-orihon-app** — `packages/create-orihon-app`, published separately on npm.
