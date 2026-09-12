/* Page wiring: replay a captured intent, stage by stage, then break it. */

import { mountDemo, isDark, onTheme, num, panel, field, row, action } from "../../assets/shell.js";
import { codeBlock } from "../../assets/hl.js";

const output = codeBlock("{}", { label: "runtime result" });
output.style.margin = "0";

const controls = panel(
  field(
    "The ordinary path",
    row(
      action("Send the intent", () => send()),
      action("Reset", () => reset())
    )
  ),
  field(
    "Or one stage at a time",
    row(
      action("1 · plan", () => stagePlan()),
      action("2 · preview", () => stagePreview()),
      action("3 · commit", () => stageCommit())
    )
  ),
  field(
    "Reactive route — no second model call",
    row(
      action("Drop a stop", () => dropStop()),
      action("Drop another", () => dropStop())
    )
  ),
  field(
    "Break the intent",
    row(
      action("Bad latitude", () => send(corrupt("position"))),
      action("javascript: image", () => send(corrupt("image"))),
      action("Unknown field", () => send(corrupt("field")))
    )
  ),
  field("Result", output)
);

const ui = await mountDemo({
  title: "An agent's intent",
  badges: ["orihon/ai"],
  sources: [
    { name: "intent.json", url: "./intent.json" },
    { name: "map.js", url: "./map.js" },
    { name: "demo.js", url: "./demo.js" }
  ],
  hud: ["stops", "route", "revision", "status"],
  controls,
  notes: `
    <p class="note"><strong>The model states a goal, not a command.</strong>
    <code>intent.json</code> says <code>goal: "create_visit_route"</code> with places and route
    constraints. It contains no route geometry and no map calls. The runtime compiles it
    against the capability registry into two steps — <code>orihon.object-manager</code> then
    <code>orihon.route-model</code> — previews both on a private engine fork, and commits them
    as a single revision. Watch the plan appear under <em>1 · plan</em>.</p>
    <p class="note"><strong>Routes stay reactive afterwards.</strong> <em>Drop a stop</em>
    sends a plain <code>objects.remove</code>. The route model recalculates the remaining
    stops on its own: the waypoint count falls, the revision advances, and no second intent is
    ever produced. That is the difference between a map as a tool environment and a map behind
    LLM tool calls.</p>
    <p class="note"><strong>Failure is repairable.</strong> The <em>Break it</em> buttons
    return <code>{ ok: false, error: { code, path, message, received } }</code> with the path
    pointing at the offending field — what an agent needs to fix its own output. The map is
    untouched: a rejected intent commits nothing.</p>
    <p class="note"><strong>Photo markers are declarative.</strong> <code>visual.image</code>
    carries a URL, a shape and a border, never markup, and a broken URL falls back to a drawn
    glyph rather than an empty box.</p>
    <p class="note"><strong>Where the data came from.</strong> Seven Berlin landmarks with
    coordinates, one-sentence summaries and photographs from the Wikipedia REST summary API —
    the endpoint <code>src/ai/place-search.ts</code> itself defaults to. The intent was checked
    with <code>validateAIIntent()</code> before being committed to the repository.</p>
    <p class="note"><strong>A live agent</strong> adds a server, a model endpoint, place search
    and session-scoped SSE — that is <code>examples/ai-agent-demo</code>. This page deliberately
    needs none of it, because an intent is just data.</p>`
});

const intent = await fetch("./intent.json", { cache: "no-cache" }).then((r) => r.json());

let api = null;
let scene = null;
let plan = null;

try {
  api = await import("./map.js");
  scene = api.createScene({ container: ui.map, dark: isDark() });
  onTheme((dark) => scene.map.setBasemap(api.basemapFor(dark)));
  send();
} catch (error) {
  unavailable(error);
}

function show(value, label) {
  output.setSource(JSON.stringify(value, null, 2), label);
  const snapshot = scene.engine.getSnapshot();
  const route = snapshot.routes && Object.values(snapshot.routes)[0];
  ui.hud("stops", num(scene.projection.getCollectionSource(intent.collection)?.size ?? 0));
  ui.hud("route", route ? `${route.waypointIds.length} stops` : "—");
  ui.hud("revision", String(snapshot.revision));
  ui.hud("status", value?.ok === false ? value.error?.code ?? "rejected" : "ok");
}

function send(payload = intent) {
  if (!scene) return;
  show(api.executeIntent(scene, payload), "runtime.execute(intent)");
}

function stagePlan() {
  const result = api.planIntent(scene, intent);
  plan = result.ok ? result.value : null;
  show(result, "runtime.plan(intent)");
}

function stagePreview() {
  if (!plan) return stagePlan();
  show(api.previewPlan(scene, plan), "runtime.preview(plan)");
}

function stageCommit() {
  if (!plan) return stagePlan();
  const result = api.commitPlan(scene, plan);
  plan = null;
  show(result, "runtime.commit(plan)");
}

function dropStop() {
  const snapshot = scene.engine.getSnapshot();
  const route = snapshot.routes && Object.values(snapshot.routes)[0];
  const id = route?.waypointIds?.at(-1);
  if (!id) return;
  show(api.removeStop(scene, intent.collection, id), `objects.remove "${id}"`);
}

function reset() {
  plan = null;
  send();
}

/** Three ways a model gets it wrong, and what the runtime says back. */
function corrupt(kind) {
  const broken = structuredClone(intent);
  if (kind === "position") broken.points[0].position.lat = 137.6;
  if (kind === "image") broken.points[0].visual.image.url = "javascript:alert(1)";
  if (kind === "field") broken.points[0].colour = "red";
  return broken;
}

function unavailable(error) {
  ui.hud("status", "unavailable");
  const box = document.createElement("div");
  box.className = "boot-error";
  box.innerHTML =
    "<strong>orihon/ai is not in the published package yet.</strong>" +
    "<span>This page needs the repository build: run it from a checkout with " +
    "<code>npm run demo:live</code>. Everything else on this site also works from the CDN.</span>";
  ui.stage.append(box);
  output.setSource(`// ${String(error?.message || error)}`);
}
