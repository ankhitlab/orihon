# Orihon AI Sessions

Agent-native maps: shared revisioned map state and browser capabilities for AI agents.

For low-level JSON scenes (`createAISession` / `orihon_execute`) see [`AI.md`](./AI.md).
For model system prompts see [`AI_SYSTEM_PROMPT.md`](./AI_SYSTEM_PROMPT.md).
For machine-readable discovery see [`../llms.txt`](../llms.txt).

## Positioning

Orihon is **not** “WebSocket ↔ LLM tool calls in the browser.” That pattern is commodity
(AG-UI, WebMCP). Orihon exposes maps as a **safe, stateful tool environment**:

```text
AI Agent
   │ semantic intents / browser tools
   ▼
AIAgentSession          ← user/session scoped
   │ revision · capabilities · local UI state
   ├──────────────┬──────────────┬──────────────┐
   ▼              ▼              ▼              ▼
server engine   browser bridge  HTTP / SSE    adapters
objects/routes  viewport        sessions      WebMCP / AG-UI
places search   selection                     AISessionStore
                popup
```

**Product name:** Agent-native maps.

## Two different “sessions”

| API | Role |
| --- | --- |
| `createAISession(map)` | Low-level JSON scene commands on one map instance |
| `createAIAgentSession({ id, engine, map?, projection? })` | Agent-facing session: intents, allowlists, local UI, bridge |

Do not conflate them.

---

## Quick start (developer)

```ts
import { createMap } from "orihon/easy";
import {
  createAICommandEngine,
  createAIAgentSession,
  createAIMapProjection,
  listAISessionTools,
  createAIAGUIAdapter,
  installAIWebMCPTools,
  createMemoryAISessionStore,
  restoreAIAgentSession
} from "orihon/ai";
import "orihon/orihon.css";

const map = createMap("map", { /* basemap… */ });
const engine = createAICommandEngine();
const projection = createAIMapProjection(map, {
  objectManager: { clusterize: false, draggablePoints: true }
});

const session = createAIAgentSession({
  id: "map:demo",
  actor: { userId: "582" },
  engine,
  map,
  projection,
  capabilities: ["objects", "routes", "viewport", "selection", "popup"]
});

session.connect();
session.observeBrowser({ selection: true, viewport: true, editable: true });
session.subscribeUser((event) => {
  // selectionchange | objectmove | viewportchange
  console.log(event.type, event);
});

await session.call("orihon.plan", {
  goal: "show_places",
  collection: "places",
  points: [
    { id: "a", position: { lat: 55.75, lng: 37.62 }, title: "A", category: "alert" },
    { id: "b", position: { lat: 55.76, lng: 37.63 }, title: "B", category: "alpha" }
  ],
  presentation: { clearMap: true, viewport: { mode: "fit", padding: 48 } }
});

await session.call("map.set_selection", { ids: ["a"], collection: "places" });
session.getContext(); // revision + local + browserTools + allowlists
```

### One session ↔ one map

`AIAgentSession` binds **one** `#map` and one `local.viewport`. For several maps, use several
session ids (`map:a`, `map:b`). Two browser tabs with the same id share (and overwrite) `local`.

---

## `session.call` surface

| Name | Side | Purpose |
| --- | --- | --- |
| `orihon.plan` / `orihon_plan` / `intent.execute` | server | Semantic intent → capability registry → atomic commit |
| `map.get_viewport` / `map.set_viewport` | browser | Camera; live map also writes `local.viewport` **with bounds** |
| `map.get_selection` / `map.set_selection` | browser | ObjectManager selection |
| `map.open_popup` / `map.close_popup` | browser | Popup by object id |
| `map.draw_get_mode` | browser | Stub (`null`) until draw group is wired |

Any input object with a `goal` field is treated as an intent for `execute`.

### Local viewport shape

After pan/zoom (or `map.get_viewport` on a live map):

```json
{
  "center": { "lat": 55.75, "lng": 37.62 },
  "zoom": 14,
  "bounds": { "south": 55.74, "west": 37.60, "north": 55.76, "east": 37.64 }
}
```

At high zoom, agents must use **bounds**, not only center.

### Browser → AI events

```ts
session.observeBrowser({
  selection: true,  // ObjectManager click → selectionchange
  viewport: true,   // moveend/zoomend → viewportchange (+ bounds)
  editable: true,   // drag → objectmove (needs draggablePoints or per-marker drag)
  syncEngine: false // when true, applyObjectMove also mutates session.engine
});

session.subscribeUser((event) => { /* … */ });
```

Hosts typically push `session.local` to the server:

`POST /api/orihon/sessions/:id/local` with `{ viewport?, selection?, lastUserEvent? }`.

---

## Semantic intents (server)

Prefer these goals over inventing coordinates or route geometry in the model:

| Goal | Use when |
| --- | --- |
| `show_places` | Markers only (no `routeId`) |
| `create_visit_route` | Ordered tour; `route.reactive` defaults to `true` |
| `update_points` | Patch existing ids (title, popup, category, position, visual) |
| `create_visualization_stress_test` / `update_…` | Load demos |

Point `category`: `alpha` | `beta` | `gamma` | `alert` (alert renders red in ObjectManager).

Coordinates are always `{ lat, lng }` outside GeoJSON. GeoJSON stays `[lng, lat]`.

---

## HTTP (thin transport)

```ts
import {
  createAICommandEngine,
  createAIAgentRuntime,
  createAIAgentSession,
  createAIAgentSessionRegistry,
  createAIHTTPHandler
} from "orihon/ai";

const engine = createAICommandEngine();
const runtime = createAIAgentRuntime(engine);
const sessions = createAIAgentSessionRegistry();
sessions.register(createAIAgentSession({
  id: "map:demo",
  actor: { userId: "demo" },
  engine,
  runtime,
  capabilities: ["objects", "routes", "viewport", "selection", "popup"]
}));

const handler = createAIHTTPHandler(engine, { runtime, sessions });
```

| Route | Role |
| --- | --- |
| `POST /api/orihon/sessions` | Create/register |
| `GET /api/orihon/sessions/:id` | Context (allowlists + `local`) |
| `POST /api/orihon/sessions/:id/local` | Browser → server local patch |
| `POST /api/orihon/sessions/:id/intents` | Plan/commit through the session |
| `GET /api/orihon/sessions/:id/events` | SSE (`event: ready`, `event: command`) |
| `GET /api/orihon/sessions/:id/snapshot` | Snapshot of the session's engine |
| `GET /api/orihon/snapshot` | Full engine snapshot |
| `POST /api/orihon/commands` | Single engine command + optional `baseRevision` |

Session-scoped snapshot and SSE both read the session's own engine, so a `createSession`
factory may bind a per-tenant engine and the two stay in step. Passing `?sessionId=` to an
adapter configured without a `sessions` registry is rejected (503) rather than silently
answered from the unscoped engine.

Auth, multi-node sync, and DB are **host** concerns.

---

## Adapters (same capability descriptions)

All adapters use `listAISessionTools(session)` → tools that `session.call` already understands
(`orihon.plan` + `map.*`). Do not invent a second tool vocabulary.

### WebMCP

```ts
import { installAIWebMCPTools } from "orihon/ai";

const { tools, abort } = await installAIWebMCPTools(session, {
  // modelContext optional: defaults to document.modelContext / navigator.modelContext
  includeServer: true,
  includeBrowser: true
});

// later
abort.abort(); // unregister
```

In tests or non-Chrome hosts, pass a duck-typed `modelContext.registerTool`.

### AG-UI

```ts
import { createAIAGUIAdapter } from "orihon/ai";

const agui = createAIAGUIAdapter(session);

agui.listTools();           // same list as WebMCP / HTTP capabilities
agui.getStateSnapshot();    // context + engine snapshot

for await (const event of agui.runTool({
  name: "orihon.plan",
  args: { goal: "show_places", collection: "places", points: [/* … */] }
})) {
  // RUN_STARTED → TOOL_CALL_* → STATE_SNAPSHOT → RUN_FINISHED | RUN_ERROR
  pushToClient(event);
}

const stop = agui.subscribe((event) => {
  // STATE_DELTA (engine) · CUSTOM orihon.user (browser events)
});
```

Orihon does **not** own AG-UI HTTP framing; the host streams these events.

---

## Optional `AISessionStore`

Auth and database stay outside Orihon. The library provides a record shape and restore helpers.

```ts
import {
  createMemoryAISessionStore,
  createAISessionRecord,
  restoreAIAgentSession,
  loadAIAgentSession
} from "orihon/ai";

const store = createMemoryAISessionStore(); // or implement AISessionStore
const record = store.save(session);
// persist record JSON in your DB…

const again = restoreAIAgentSession(record, { map, projection });
// again.engine has the same revision/collections/routes; again.local is restored
again.projection?.applySnapshot(again.engine.getSnapshot()); // repaint the map
```

Record fields: `{ version: 1, id, actor, capabilities?, local, snapshot, savedAt }`.
`capabilities` is present only when the session was created with an explicit allowlist;
a session created without one restores unrestricted, so host-registered capabilities are
never silently locked out.

Engine hydrate uses `createAICommandEngineFromSnapshot` / `engine.replaceSnapshot`, which
replace state **without emitting events**. An attached `AIMapProjection` keeps rendering the
previous state until you call `projection.applySnapshot(...)` as shown above.

Hook HTTP create via `createAIHTTPHandler(engine, { createSession, sessions })` if the host
wants load-on-create.

---

## Examples

| Example | URL (with `npm run demo:ai`) |
| --- | --- |
| Agent playground | http://127.0.0.1:4193/examples/ai-agent-demo/ |
| Logistics closed loop | http://127.0.0.1:4193/examples/ai-logistics-demo/ |

Logistics story: late deliveries → `category: "alert"` → reactive `create_visit_route` →
dispatcher drag/select → AI reaction notes (`ai-notes`) + engine replan.

Both demos share one server engine process — run one vertical at a time for clean snapshots.

---

## Roadmap

1. ~~Session + bridge stubs~~
2. ~~Wire bridge to live map + `session.call`~~
3. ~~Demo + this brief~~
4. ~~Thin transports (SSE scoped by session id)~~
5. ~~Bidirectional map→AI events~~
6. ~~Logistics vertical demo~~ (harden external-browser selection later)
7. ~~WebMCP / AG-UI adapters~~
8. ~~Optional `AISessionStore`~~

**Still open:** richer highlight/reorder browser tools; more reliable select/drag sync when
multiple browsers share one session id.

## Moat

```text
generic LLM
  → Orihon semantic geospatial model
  → safe deterministic ops
  → revisioned state
  → browser ↔ server sync (AI tools + user edits)
  → any map renderer / any agent via WebMCP or AG-UI
```
