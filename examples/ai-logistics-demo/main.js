import { createMap } from "/dist/easy-entry.js";
import {
  createAIAgentSession,
  createAICommandEngine,
  createAIMapProjection
} from "/dist/ai-entry.js";

const OPENSTREETMAP_BASEMAP = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  maxNativeZoom: 19,
  maxZoom: 19
};

const SESSION_ID = "map:ai-logistics-demo";
const COLLECTION = "deliveries";
const NOTES = "ai-notes";
const ROUTE_ID = "delivery-run";

/** Fixed Moscow-area stops: depot + mixed SLA. */
const STOPS = [
  { id: "depot", title: "Склад Юг", lat: 55.701, lng: 37.625, delayMin: 0, role: "depot" },
  { id: "stop-a", title: "Клиент А · Парк Горького", lat: 55.7297, lng: 37.6015, delayMin: 0 },
  { id: "stop-b", title: "Клиент B · Арбат", lat: 55.7522, lng: 37.5923, delayMin: 18 },
  { id: "stop-c", title: "Клиент C · Кремль", lat: 55.752, lng: 37.6175, delayMin: 42 },
  { id: "stop-d", title: "Клиент D · ВДНХ", lat: 55.8263, lng: 37.6377, delayMin: 55 },
  { id: "stop-e", title: "Клиент E · Сити", lat: 55.7499, lng: 37.5373, delayMin: 8 }
];

const LATE_IDS = STOPS.filter((stop) => stop.delayMin >= 30).map((stop) => stop.id);

const map = createMap("map", {
  center: { lat: 55.7558, lng: 37.6176 },
  zoom: 11,
  controls: true,
  basemap: OPENSTREETMAP_BASEMAP,
  ariaLabel: "Карта логистического цикла Orihon"
});
/** @type {any} */
window.__orihonLogisticsMap = map;

function fitLogisticsView(extra = []) {
  map.invalidateSize();
  const size = map.getSize?.();
  if (size && (size.x < 40 || size.y < 40 || size.y > 2400)) {
    appendLog("error", "Некорректный размер карты — fit пропущен", size);
  }
  const positions = [
    ...STOPS.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    ...extra
  ];
  const notes = projection.getCollectionSource(NOTES);
  if (notes) {
    for (const feature of notes.getFeatures()) {
      if (feature.geometry?.type !== "Point") continue;
      const [lng, lat] = feature.geometry.coordinates;
      if (Number.isFinite(lat) && Number.isFinite(lng)) positions.push({ lat, lng });
    }
  }
  if (positions.length < 1) return;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const point of positions) {
    south = Math.min(south, point.lat);
    west = Math.min(west, point.lng);
    north = Math.max(north, point.lat);
    east = Math.max(east, point.lng);
  }
  map.fitBounds({ south, west, north, east }, { padding: 64 });
}
const projection = createAIMapProjection(map, {
  objectManager: { declutter: true, clusterize: false, draggablePoints: true }
});
const localEngine = createAICommandEngine();
const agentSession = createAIAgentSession({
  id: SESSION_ID,
  actor: { userId: "dispatcher" },
  engine: localEngine,
  map,
  projection,
  capabilities: ["objects", "routes", "viewport", "selection", "popup"]
});
agentSession.connect();

const elements = {
  status: document.querySelector("#status"),
  stepLabel: document.querySelector("#step-label"),
  sessionId: document.querySelector("#session-id"),
  revision: document.querySelector("#revision"),
  selection: document.querySelector("#selection"),
  lastEvent: document.querySelector("#last-event"),
  log: document.querySelector("#log"),
  run: document.querySelector("#run-loop"),
  reset: document.querySelector("#reset"),
  clearLog: document.querySelector("#clear-log"),
  steps: [...document.querySelectorAll("#steps li")]
};

elements.sessionId.textContent = SESSION_ID;
/** After step 3, browser events trigger immediate AI map reactions. */
let liveReact = false;
let reactionSeq = 0;
let localPushTimer;
let reacting = false;

function appendLog(kind, title, payload) {
  const entry = document.createElement("div");
  entry.className = `entry${kind ? ` ${kind}` : ""}`;
  const strong = document.createElement("strong");
  strong.textContent = title;
  entry.append(strong);
  if (payload !== undefined) {
    const pre = document.createElement("pre");
    pre.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    entry.append(pre);
  }
  elements.log.prepend(entry);
}

function setStep(name) {
  elements.stepLabel.textContent = name || "—";
  for (const item of elements.steps) {
    const key = item.getAttribute("data-step");
    item.classList.toggle("active", key === name);
    const order = ["load", "highlight", "route", "replan"];
    const activeIndex = order.indexOf(name);
    const itemIndex = order.indexOf(key);
    item.classList.toggle("done", activeIndex >= 0 && itemIndex >= 0 && itemIndex < activeIndex);
  }
}

function updateState(operation) {
  elements.revision.textContent = String(projection.revision);
  elements.status.textContent = operation;
  const ids = agentSession.local.selection ?? [];
  elements.selection.textContent = ids.length ? ids.join(", ") : "—";
}

async function pushLocalToServer(extra = {}) {
  try {
    await fetch(`/api/orihon/sessions/${encodeURIComponent(SESSION_ID)}/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(agentSession.local.viewport ? { viewport: agentSession.local.viewport } : {}),
        ...(agentSession.local.selection ? { selection: agentSession.local.selection } : {}),
        ...(agentSession.local.lastUserEvent ? { lastUserEvent: agentSession.local.lastUserEvent } : {}),
        ...extra
      })
    });
  } catch {
    /* offline / server restart */
  }
}

function observeLiveMap() {
  try {
    agentSession.observeBrowser({ selection: true, viewport: true, editable: true, syncEngine: false });
  } catch {
    /* empty projection before first snapshot */
  }
}

async function syncSnapshot() {
  const response = await fetch("/api/orihon/snapshot", { cache: "no-store" });
  const snapshot = await response.json();
  const result = projection.applySnapshot(snapshot);
  if (!result.ok) appendLog("error", "Snapshot error", result);
  updateState("snapshot");
  observeLiveMap();
  return snapshot;
}

function applyServerEvent(event) {
  if (event.revision <= projection.revision) return;
  const result = projection.applyEvent(event);
  if (!result.ok && result.error.code === "REVISION_CONFLICT") {
    appendLog("error", "Revision gap → snapshot", result.error);
    void syncSnapshot();
    return;
  }
  if (!result.ok) {
    appendLog("error", "Projection error", result);
    return;
  }
  observeLiveMap();
  const operation = event.type === "transaction" ? event.operation : event.command?.op;
  updateState(operation ?? "event");
  if (liveReact && event.type === "objects" && event.routes?.length) {
    setStep("replan");
    appendLog("success", "AI / engine → reactive replan", {
      revision: event.revision,
      routes: event.routes.map(({ id, waypointIds }) => ({ id, waypointIds }))
    });
    elements.status.textContent = "Маршрут пересчитан · реакция AI на карте";
  }
}

async function runIntent(intent, label) {
  appendLog("", label, intent);
  const response = await fetch(`/api/orihon/sessions/${encodeURIComponent(SESSION_ID)}/intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent, baseRevision: projection.revision })
  });
  const result = await response.json();
  if (!result.ok) {
    appendLog("error", "Intent rejected", result);
    elements.status.textContent = result.error?.code ?? "error";
    return result;
  }
  appendLog("success", "Intent committed", {
    revision: result.value.revision,
    goal: result.value.goal ?? intent.goal,
    resources: result.value.resources
  });
  if (projection.revision < result.value.revision) await syncSnapshot();
  updateState(intent.goal);
  return result;
}

async function executeCommand(command, label) {
  appendLog("", label, command);
  const response = await fetch("/api/orihon/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, baseRevision: projection.revision })
  });
  const result = await response.json();
  if (result.ok && result.value.event) applyServerEvent(result.value.event);
  appendLog(result.ok ? "success" : "error", label, result.ok ? { revision: result.value.revision } : result);
  updateState(command.op);
  return result;
}

function pointSpec(stop, category) {
  const late = stop.delayMin >= 30;
  return {
    id: stop.id,
    position: { lat: stop.lat, lng: stop.lng },
    title: stop.title,
    popup: stop.role === "depot"
      ? "Склад · старт маршрута"
      : stop.delayMin
        ? `Опоздание ${stop.delayMin} мин · SLA нарушен`
        : "В срок",
    category,
    visual: {
      label: { text: stop.role === "depot" ? "Склад" : late ? `+${stop.delayMin}м` : stop.title.split("·")[0].trim(), display: "hover" }
    }
  };
}

async function runLogisticsLoop() {
  elements.run.disabled = true;
  liveReact = false;
  reactionSeq = 0;
  try {
    setStep("load");
    elements.status.textContent = "Загрузка доставок…";
    const load = await runIntent({
      goal: "show_places",
      collection: COLLECTION,
      points: STOPS.map((stop) => pointSpec(stop, stop.delayMin > 0 ? "beta" : "alpha")),
      presentation: {
        clearMap: true,
        viewport: { mode: "fit", padding: 56, animation: "none" }
      }
    }, "AI → show_places (доставки)");
    if (!load.ok) return;
    fitLogisticsView();

    await new Promise((resolve) => setTimeout(resolve, 400));
    setStep("highlight");
    elements.status.textContent = "Подсветка критичных…";
    const highlight = await runIntent({
      goal: "update_points",
      collection: COLLECTION,
      points: LATE_IDS.map((id) => {
        const stop = STOPS.find((item) => item.id === id);
        return {
          id,
          category: "alert",
          popup: `КРИТИЧНО · опоздание ${stop.delayMin} мин`,
          visual: {
            label: { text: `+${stop.delayMin}м`, display: "hover" }
          }
        };
      })
    }, "AI → update_points (highlight alert)");
    if (!highlight.ok) return;

    await agentSession.call("map.set_selection", { ids: LATE_IDS.slice(0, 1), collection: COLLECTION });

    await new Promise((resolve) => setTimeout(resolve, 400));
    setStep("route");
    elements.status.textContent = "Планирование порядка…";
    const routed = await runIntent({
      goal: "create_visit_route",
      collection: COLLECTION,
      routeId: ROUTE_ID,
      points: STOPS.map((stop) => pointSpec(
        stop,
        LATE_IDS.includes(stop.id) ? "alert" : stop.delayMin > 0 ? "beta" : "alpha"
      )),
      route: {
        startId: "depot",
        optimize: "shortest",
        reactive: true,
        annotateStops: true
      },
      presentation: {
        clearMap: true,
        viewport: { mode: "fit", padding: 56, animation: "none" }
      }
    }, "AI → create_visit_route (reactive)");
    if (!routed.ok) return;
    fitLogisticsView();

    observeLiveMap();
    setStep("replan");
    liveReact = true;
    elements.status.textContent = "Live: AI уже добавил первую реакцию — кликните или перетащите ещё";
    appendLog("success", "Live react включён", {
      hint: "Drag or select a stop",
      lateIds: LATE_IDS,
      collections: projection.getCollectionNames(),
      center: map.getCenter(),
      zoom: map.getZoom()
    });
    const focus = STOPS.find((stop) => stop.id === "stop-c") ?? STOPS[1];
    await addAiReaction({
      kind: "select",
      stopId: focus.id,
      position: { lat: focus.lat, lng: focus.lng },
      title: focus.title
    });
    fitLogisticsView();
    requestAnimationFrame(() => {
      map.invalidateSize();
      fitLogisticsView();
    });
  } finally {
    elements.run.disabled = false;
  }
}

async function resetScene() {
  liveReact = false;
  reacting = false;
  reactionSeq = 0;
  setStep(null);
  await executeCommand({ op: "clear" }, "Reset → clear");
  await syncSnapshot();
  elements.status.textContent = "Сброшено";
  elements.lastEvent.textContent = "—";
}

/** Immediate AI reaction: note marker offset from the stop so it is visible. */
async function addAiReaction({ kind, stopId, position, previous, title }) {
  reactionSeq += 1;
  const noteId = `ai-react-${reactionSeq}`;
  const offset = {
    lat: position.lat + 0.006 + reactionSeq * 0.0015,
    lng: position.lng + 0.008 + reactionSeq * 0.0015
  };
  const detail = kind === "move"
    ? `Учёл перенос «${title || stopId}» → ${position.lat.toFixed(4)}, ${position.lng.toFixed(4)}`
    : `Смотрю «${title || stopId}» · нужна ли перестановка в маршруте?`;
  const note = {
    type: "Feature",
    id: noteId,
    geometry: { type: "Point", coordinates: [offset.lng, offset.lat] },
    properties: {
      title: kind === "move" ? `AI · правка #${reactionSeq}` : `AI · фокус #${reactionSeq}`,
      popup: detail,
      category: "alert",
      visual: {
        label: {
          text: kind === "move" ? `AI #${reactionSeq}` : `AI? #${reactionSeq}`,
          display: "always"
        }
      }
    }
  };
  const objects = [note];
  if (kind === "move" && previous) {
    objects.push({
      type: "Feature",
      id: `${noteId}-from`,
      geometry: { type: "Point", coordinates: [previous.lng, previous.lat] },
      properties: {
        title: "Было",
        popup: `Прежняя позиция «${title || stopId}»`,
        category: "beta",
        visual: { label: { text: "было", display: "always" } }
      }
    });
  }
  const added = await executeCommand({
    op: "objects.add",
    collection: NOTES,
    objects
  }, `AI → objects.add (${NOTES})`);
  if (!added.ok) {
    appendLog("error", "Не удалось добавить реакцию AI", added);
    return added;
  }
  observeLiveMap();
  try {
    await agentSession.call("map.set_selection", { ids: [noteId], collection: NOTES });
    await agentSession.call("map.open_popup", { id: noteId, collection: NOTES });
  } catch (error) {
    appendLog("error", "Popup реакции", String(error));
  }
  appendLog("success", "AI сразу добавил реакцию на карту", { noteId, kind, stopId, offset });
  elements.status.textContent = `AI добавил «${note.properties.title}» на карту`;
  fitLogisticsView([{ lat: offset.lat, lng: offset.lng }]);
  return added;
}

async function onDispatcherMove(event) {
  if (!liveReact) {
    elements.status.textContent = "Сначала «Запустить цикл» до шага Live";
    return;
  }
  if (reacting) return;
  reacting = true;
  elements.status.textContent = "AI видит перемещение…";
  try {
    const source = projection.getCollectionSource(event.collection);
    const feature = source?.get(event.id);
    const title = feature?.properties?.title;
    const updated = await executeCommand({
      op: "objects.update",
      collection: event.collection,
      objects: [{
        type: "Feature",
        id: event.id,
        geometry: { type: "Point", coordinates: [event.position.lng, event.position.lat] },
        properties: {
          ...(feature?.properties ?? {}),
          popup: `Диспетчер перенёс · AI пересчитывает`,
          category: feature?.properties?.category === "alert" ? "alert" : "beta"
        }
      }]
    }, "User drag → objects.update (reactive route)");
    if (!updated.ok) return;
    await addAiReaction({
      kind: "move",
      stopId: event.id,
      position: event.position,
      previous: event.previous,
      title
    });
  } finally {
    reacting = false;
  }
}

async function onDispatcherSelect(event) {
  if (!liveReact) {
    if (event.source === "user") elements.status.textContent = "Сначала «Запустить цикл» до шага Live";
    return;
  }
  if (reacting || event.source !== "user") return;
  const id = event.selection[0];
  if (id == null || String(id).startsWith("ai-react-")) return;
  reacting = true;
  elements.status.textContent = "AI видит selection…";
  try {
    const collection = event.collection || COLLECTION;
    const source = projection.getCollectionSource(collection);
    const feature = source?.get(id);
    const coords = feature?.geometry?.coordinates;
    if (!coords) {
      appendLog("error", "Select без координат", { id, collection });
      return;
    }
    await addAiReaction({
      kind: "select",
      stopId: id,
      position: { lat: Number(coords[1]), lng: Number(coords[0]) },
      title: feature?.properties?.title
    });
  } finally {
    reacting = false;
  }
}

agentSession.subscribeUser((event) => {
  elements.lastEvent.textContent = event.type;
  appendLog("", "browser → session", event);
  if (event.type === "selectionchange") {
    elements.selection.textContent = event.selection.join(", ") || "—";
    void onDispatcherSelect(event);
  }
  if (event.type === "viewportchange") {
    clearTimeout(localPushTimer);
    localPushTimer = setTimeout(() => { void pushLocalToServer(); }, 200);
  } else {
    void pushLocalToServer();
  }
  if (event.type === "objectmove") void onDispatcherMove(event);
});

observeLiveMap();

const events = new EventSource(`/api/orihon/sessions/${encodeURIComponent(SESSION_ID)}/events`);
events.addEventListener("ready", () => appendLog("success", "SSE ready", { sessionId: SESSION_ID }));
events.addEventListener("command", (message) => {
  try { applyServerEvent(JSON.parse(message.data)); }
  catch (error) { appendLog("error", "SSE parse", String(error)); }
});
events.onerror = () => { elements.status.textContent = "SSE reconnect…"; };

elements.run.addEventListener("click", () => { void runLogisticsLoop(); });
elements.reset.addEventListener("click", () => { void resetScene(); });
elements.clearLog.addEventListener("click", () => { elements.log.replaceChildren(); });

void syncSnapshot().then(() => {
  appendLog("", "Logistics demo ready", {
    sessionId: SESSION_ID,
    loop: "late → highlight → route → live react (add notes)"
  });
});
