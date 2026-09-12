/*
 * What an agent actually sends, and what happens to it.
 *
 * The model does not emit map commands. It states one goal — an *intent* — and
 * the semantic runtime does the rest:
 *
 *     intent  →  runtime.plan()     compile against the capability registry
 *             →  runtime.preview()  validate every step on a private engine fork
 *             →  runtime.commit()   publish the whole plan as ONE revision
 *             →  projection         draw the resulting snapshot
 *
 * `AICommandEngine` holds the authoritative, revisioned state; `AIMapProjection`
 * is the only thing that touches the map. Nothing here talks to a model: an
 * intent is data, so a captured one replays through the same code a live agent
 * drives.
 */

import { createMap } from "orihon/easy";
import {
  createAICommandEngine,
  createAIAgentRuntime,
  createAIMapProjection,
  validateAIIntent
} from "orihon/ai";

export const basemapFor = (dark) => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
    dark ? "Dark" : "Light"
  }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  attribution: "Tiles © Esri",
  maxNativeZoom: 16
});

export function createScene({ container, dark }) {
  const map = createMap(container, {
    center: { lat: 52.518, lng: 13.38 },
    zoom: 12,
    basemap: basemapFor(dark)
  });

  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  const projection = createAIMapProjection(map, { objectManager: { declutter: true } });

  return { map, engine, runtime, projection };
}

/** What the model is allowed to ask for, in its own words. Feed it to the tool description. */
export const capabilitiesOf = ({ runtime }) => runtime.describeCapabilities();

/**
 * Step 1. Compile a goal into a dependency plan. `create_visit_route` becomes
 * ObjectManager points followed by a route model — the model never sends route
 * geometry, only the constraint that there should be one.
 */
export function planIntent({ runtime }, intent) {
  return runtime.plan(validateAIIntent(intent));
}

/** Step 2. Run the whole plan on an isolated fork. Nothing is published yet. */
export const previewPlan = ({ runtime }, plan) => runtime.preview(plan);

/** Step 3. One atomic revision, then draw it. */
export function commitPlan(scene, plan) {
  const committed = scene.runtime.commit(plan);
  if (!committed.ok) return committed;
  return draw(scene);
}

/** The ordinary path: plan, preview and commit in one call. */
export function executeIntent(scene, intent) {
  const done = scene.runtime.execute(intent);
  if (!done.ok) return done;
  return draw(scene);
}

/**
 * A semantic route is reactive. Drop one of its stops with a plain engine
 * command and the route model recalculates the remaining ones — no second
 * intent, no second model call, one new revision.
 */
export function removeStop(scene, collection, id) {
  const removed = scene.engine.execute({ op: "objects.remove", collection, ids: [id] });
  if (!removed.ok) return removed;
  return draw(scene);
}

const draw = (scene) => scene.projection.applySnapshot(scene.engine.getSnapshot());
