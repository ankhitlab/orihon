import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", {
  pretendToBeVisual: true,
  url: "http://localhost/"
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLDivElement: dom.window.HTMLDivElement,
  HTMLImageElement: dom.window.HTMLImageElement,
  Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: (callback) => { callback(0); return 1; },
  cancelAnimationFrame: () => {}
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator
});
dom.window.HTMLCanvasElement.prototype.getContext = () => null;

const [{ createMap }, {
  AI_COMMAND_SCHEMA,
  AI_ENGINE_COMMAND_SCHEMA,
  AI_ENGINE_COMMAND_SCHEMAS,
  AI_INTENT_SCHEMA,
  ORIHON_AI_ENGINE_SYSTEM_PROMPT,
  ORIHON_AI_AGENT_SYSTEM_PROMPT,
  ORIHON_AI_INTENT_SYSTEM_PROMPT,
  ORIHON_AI_POINTS_SYSTEM_PROMPT,
  ORIHON_AI_SYSTEM_PROMPT,
  createAIAgentRuntime,
  createAIAgentSession,
  createAIAgentSessionRegistry,
  createAIAGUIAdapter,
  createAILLMAgent,
  createAICommandEngine,
  createAICommandEngineFromSnapshot,
  createAIEngineTool,
  createAIHTTPHandler,
  createAIIntentTool,
  createAIPlaceSearchTool,
  createAIMapProjection,
  createMemoryAISessionStore,
  createNominatimPlaceSearchProvider,
  executeAIPlaceSearch,
  createOpenAICompatibleAdapter,
  createAISessionRecord,
  createAISession,
  createAITool,
  installAIWebMCPTools,
  listAISessionTools,
  restoreAIAgentSession,
  validatePointsReplaceCommand,
  validateScene
}, { Icon, Marker, Polyline, marker }] = await Promise.all([
  import("orihon/easy"),
  import("orihon/ai"),
  import("orihon/standard")
]);

function container() {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientWidth: { value: 800, configurable: true },
    clientHeight: { value: 600, configurable: true }
  });
  element.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 800, bottom: 600,
    width: 800, height: 600, x: 0, y: 0, toJSON() {}
  });
  document.body.appendChild(element);
  return element;
}

test("orihon/ai applies and queries a JSON-only versioned scene", () => {
  const map = createMap(container(), { controls: false });
  const session = createAISession(map);
  const result = session.applyScene({
    version: 1,
    camera: { center: { lat: 55.7558, lng: 37.6176 }, zoom: 11 },
    basemap: {
      type: "raster",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap contributors"
    },
    layers: [
      {
        id: "moscow",
        type: "marker",
        position: { lat: 55.7558, lng: 37.6176 },
        appearance: { shape: "pin", color: "#2563eb" },
        popup: { text: "Москва" }
      },
      {
        id: "route",
        type: "polyline",
        coordinates: [
          { lat: 55.75, lng: 37.60 },
          { lat: 55.77, lng: 37.65 }
        ],
        style: { stroke: "#2563eb", strokeWidth: 4 }
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(map.getZoom(), 11);
  assert.ok(map.getBasemap());
  const owned = [...map.layers].filter((layer) => layer !== map.getBasemap());
  assert.ok(owned.some((layer) => layer instanceof Marker));
  assert.ok(owned.some((layer) => layer instanceof Polyline));

  const snapshot = session.query();
  assert.deepEqual(snapshot.layers.map(({ id }) => id), ["moscow", "route"]);
  assert.deepEqual(snapshot.camera.center, { lat: 55.7558, lng: 37.6176 });
  assert.notEqual(snapshot.layers, result.value.scene.layers);
  map.destroy();
});

test("orihon/ai commands add, update, fit, query, remove and clear by stable ID", () => {
  const map = createMap(container(), { center: { lat: 0, lng: 0 }, zoom: 2, controls: false });
  const session = createAISession(map);

  assert.deepEqual(session.execute({
    op: "add",
    id: "kremlin",
    layer: {
      type: "marker",
      position: { lat: 55.752, lng: 37.6175 },
      popup: { text: "Кремль" }
    }
  }), { ok: true, value: { op: "add", ids: ["kremlin"] } });

  assert.equal(session.execute({
    op: "update",
    id: "kremlin",
    patch: { position: { lat: 55.7521, lng: 37.6177 } }
  }).ok, true);
  assert.deepEqual(session.query().layers[0].position, { lat: 55.7521, lng: 37.6177 });

  assert.equal(session.execute({ op: "fit", ids: ["kremlin"], padding: 20 }).ok, true);
  assert.deepEqual(
    session.execute({ op: "query", ids: ["kremlin"] }).value.scene.layers.map(({ id }) => id),
    ["kremlin"]
  );
  assert.equal(session.execute({ op: "remove", id: "kremlin" }).ok, true);
  assert.equal(session.query().layers.length, 0);

  session.execute({
    op: "add",
    id: "one",
    layer: { type: "marker", position: { lat: 1, lng: 1 } }
  });
  session.execute({
    op: "add",
    id: "two",
    layer: { type: "marker", position: { lat: 2, lng: 2 } }
  });
  assert.deepEqual(session.execute({ op: "clear" }).value.ids, ["one", "two"]);
  map.destroy();
});

test("orihon/ai returns repairable errors and does not mutate on invalid input", () => {
  const map = createMap(container(), { controls: false });
  const session = createAISession(map);
  const invalid = session.execute({
    op: "add",
    id: "bad",
    layer: { type: "marker", position: { lat: 137.6, lng: 37.61 } }
  });

  assert.deepEqual(invalid, {
    ok: false,
    error: {
      code: "INVALID_COORDINATE",
      path: "$command.layer.position.lat",
      message: "Latitude must be between -90 and 90",
      received: 137.6
    }
  });
  assert.equal(session.query().layers.length, 0);

  const notJson = session.execute({
    op: "add",
    id: "callback",
    layer: { type: "marker", position: { lat: 1, lng: 2 }, callback() {} }
  });
  assert.equal(notJson.ok, false);
  assert.equal(notJson.error.code, "NOT_JSON");
  assert.equal(notJson.error.path, "$command.layer.callback");
  assert.equal(notJson.error.received, "[function callback]");
  assert.doesNotThrow(() => JSON.stringify(notJson));

  const unknown = session.execute({ op: "remove", id: "missing" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "NOT_FOUND");
  map.destroy();
});

test("orihon/ai only clears basemaps owned by its session", () => {
  const map = createMap(container(), {
    controls: false,
    basemap: "https://example.test/original/{z}/{x}/{y}.png"
  });
  const original = map.getBasemap();
  const session = createAISession(map);

  assert.equal(session.applyScene({ version: 1, basemap: null, layers: [] }).ok, true);
  assert.equal(map.getBasemap(), original);

  assert.equal(session.applyScene({
    version: 1,
    basemap: { type: "raster", url: "https://example.test/ai/{z}/{x}/{y}.png" },
    layers: []
  }).ok, true);
  assert.notEqual(map.getBasemap(), original);
  assert.match(map.getBasemap().getTileUrl(1, 2, 3), /\/ai\//);

  assert.equal(session.applyScene({ version: 1, basemap: null, layers: [] }).ok, true);
  assert.equal(map.getBasemap(), null);
  map.destroy();
});

test("orihon/ai tool bridge exposes one self-contained tool and executes its calls", () => {
  const map = createMap(container(), { controls: false });
  const session = createAISession(map);
  const tool = createAITool(session);

  assert.equal(tool.definition.name, "orihon_execute");
  assert.equal(tool.definition.inputSchema, AI_COMMAND_SCHEMA);
  assert.equal(AI_COMMAND_SCHEMA.oneOf.length, 9);
  assert.equal(Object.isFrozen(AI_COMMAND_SCHEMA), true);
  assert.equal(Object.isFrozen(AI_COMMAND_SCHEMA.oneOf), true);
  assert.doesNotMatch(JSON.stringify(tool.definition.inputSchema), /function|undefined/);
  assert.match(ORIHON_AI_SYSTEM_PROMPT, /coordinates must be objects/i);
  assert.match(ORIHON_AI_SYSTEM_PROMPT, /error\.code and error\.path/);

  const invalid = tool.execute({
    op: "add",
    id: "live",
    layer: { type: "marker", position: { lat: 120, lng: 37.62 } }
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "INVALID_COORDINATE");

  const repaired = tool.execute({
    op: "add",
    id: "live",
    layer: { type: "marker", position: { lat: 55.75, lng: 37.62 } }
  });
  assert.deepEqual(repaired, { ok: true, value: { op: "add", ids: ["live"] } });
  assert.deepEqual(session.query().layers.map(({ id }) => id), ["live"]);
  map.destroy();
});

test("scene validator rejects duplicate IDs and coordinate arrays", () => {
  assert.throws(() => validateScene({
    version: 1,
    layers: [
      { id: "same", type: "marker", position: { lat: 1, lng: 2 } },
      { id: "same", type: "marker", position: { lat: 3, lng: 4 } }
    ]
  }), (error) => error.code === "DUPLICATE_ID" && error.path === "$scene.layers[1].id");

  assert.throws(() => validateScene({
    version: 1,
    layers: [{ id: "array", type: "marker", position: [55.75, 37.61] }]
  }), (error) => error.code === "INVALID_TYPE" && error.path === "$scene.layers[0].position");
});

function point(id, lng, lat, properties = {}) {
  return { type: "Feature", id, geometry: { type: "Point", coordinates: [lng, lat] }, properties };
}

test("headless command engine applies transactional revisioned object deltas", () => {
  const engine = createAICommandEngine();
  const events = [];
  engine.subscribe((event) => events.push(event));

  const added = engine.execute({
    op: "objects.add",
    collection: "vehicles",
    objects: [point("a", 13.4, 52.5), point("b", 13.41, 52.51)]
  }, { baseRevision: 0 });
  assert.equal(added.ok, true);
  assert.equal(added.value.revision, 1);

  const batched = engine.execute({
    op: "objects.batch",
    collection: "vehicles",
    changes: [
      { type: "update", objects: [point("a", 13.42, 52.52, { status: "moving" })] },
      { type: "add", objects: [point("c", 13.43, 52.53)] },
      { type: "remove", ids: ["b"] }
    ]
  }, { baseRevision: 1 });
  assert.equal(batched.ok, true);
  assert.equal(batched.value.revision, 2);
  assert.deepEqual(engine.getSnapshot().collections.vehicles.map(({ id }) => id), ["a", "c"]);
  assert.deepEqual(engine.getSnapshot().collections.vehicles[0].geometry.coordinates, [13.42, 52.52]);
  assert.equal(events.length, 2);

  const before = engine.getSnapshot();
  const invalid = engine.execute({
    op: "objects.batch",
    collection: "vehicles",
    changes: [
      { type: "add", objects: [point("d", 13.44, 52.54)] },
      { type: "update", objects: [point("missing", 13.45, 52.55)] }
    ]
  }, { baseRevision: 2 });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "NOT_FOUND");
  assert.deepEqual(engine.getSnapshot(), before);

  const conflict = engine.execute({ op: "objects.clear", collection: "vehicles" }, { baseRevision: 1 });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "REVISION_CONFLICT");
  assert.equal(engine.revision, 2);
});

test("browser projection feeds engine snapshots and events through FeatureSource/ObjectManager", () => {
  const engine = createAICommandEngine();
  engine.execute({ op: "objects.add", collection: "vehicles", objects: [point("bus", 13.4, 52.5)] });
  const map = createMap(container(), { center: { lat: 52.5, lng: 13.4 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map, { objectManager: { clusterize: false } });
  assert.deepEqual(projection.applySnapshot(engine.getSnapshot()), { ok: true, value: { revision: engine.revision, type: "snapshot" } });
  assert.equal(projection.revision, 1);
  assert.equal(projection.getCollectionSource("vehicles").size, 1);

  const result = engine.execute({
    op: "objects.update",
    collection: "vehicles",
    objects: [point("bus", 13.42, 52.51, { title: "moved" })]
  });
  assert.equal(result.ok, true);
  assert.equal(projection.applyEvent(result.value.event).ok, true);
  assert.deepEqual(projection.getCollectionSource("vehicles").get("bus").geometry.coordinates, [13.42, 52.51]);
  const duplicate = projection.applyEvent(result.value.event);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "REVISION_CONFLICT");

  projection.destroy();
  map.destroy();
});

test("points.replace atomically replaces the AI map with compact point objects", () => {
  const engine = createAICommandEngine({
    scene: {
      version: 1,
      layers: [{ id: "old", type: "marker", position: { lat: 1, lng: 2 } }]
    },
    collections: { vehicles: [point("bus", 13.4, 52.5)] }
  });

  const result = engine.execute({
    op: "points.replace",
    collection: "places",
    clearMap: true,
    defaults: { category: "alpha" },
    viewport: { mode: "fit", padding: 48 },
    points: [
      { id: "kremlin", position: { lat: 55.752, lng: 37.6175 }, title: "Кремль", popup: "Исторический ансамбль." },
      { id: "vdnkh", position: { lat: 55.8263, lng: 37.6377 }, title: "ВДНХ", category: "gamma" }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.revision, 1);
  assert.equal(result.value.event.command.op, "points.replace");
  const snapshot = engine.getSnapshot();
  assert.equal(snapshot.scene.layers.length, 0);
  assert.deepEqual(Object.keys(snapshot.collections), ["places"]);
  assert.deepEqual(snapshot.collections.places.map(({ id }) => id), ["kremlin", "vdnkh"]);
  assert.deepEqual(snapshot.collections.places[0].geometry.coordinates, [37.6175, 55.752]);
  assert.deepEqual(snapshot.collections.places[0].properties, {
    title: "Кремль", popup: "Исторический ансамбль.", category: "alpha"
  });
  assert.equal(snapshot.collections.places[1].properties.category, "gamma");
  assert.deepEqual(snapshot.viewport, {
    collection: "places", revision: 1, mode: "fit", padding: 48
  });

  const before = engine.getSnapshot();
  const invalid = engine.execute({
    op: "points.replace",
    collection: "places",
    points: [
      { id: "same", position: { lat: 1, lng: 2 } },
      { id: "same", position: { lat: 3, lng: 4 } }
    ]
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "DUPLICATE_ID");
  assert.deepEqual(engine.getSnapshot(), before);
});

test("point projection uses ObjectManager popups and applies viewport fit", () => {
  const engine = createAICommandEngine({
    scene: { version: 1, layers: [{ id: "old", type: "marker", position: { lat: 0, lng: 0 } }] }
  });
  const map = createMap(container(), { center: { lat: 0, lng: 0 }, zoom: 2, controls: false });
  const projection = createAIMapProjection(map);
  assert.deepEqual(projection.applySnapshot(engine.getSnapshot()), { ok: true, value: { revision: engine.revision, type: "snapshot" } });

  const executed = engine.execute({
    op: "points.replace",
    collection: "places",
    clearMap: true,
    viewport: { mode: "fit", padding: 24 },
    points: [
      { id: "west", position: { lat: 55.71, lng: 37.54 }, title: "Запад", popup: "Первая точка" },
      { id: "east", position: { lat: 55.83, lng: 37.67 }, title: "Восток", popup: "Вторая точка" }
    ]
  });
  assert.equal(executed.ok, true);
  assert.equal(projection.applyEvent(executed.value.event).ok, true);
  assert.equal(projection.session.query().layers.length, 0);
  assert.equal(projection.getCollectionSource("places").size, 2);
  assert.equal(projection.getCollectionManager("places").getStats().objects, 2);
  assert.equal(map.getBounds().contains({ lat: 55.71, lng: 37.54 }), true);
  assert.equal(map.getBounds().contains({ lat: 55.83, lng: 37.67 }), true);

  projection.getCollectionManager("places").openPopup("west");
  assert.match(document.querySelector(".oh-popup")?.textContent ?? "", /Запад — Первая точка/);
  projection.destroy();
  map.destroy();
});

test("point projection renders declarative image popups through popupContent", async () => {
  const engine = createAICommandEngine();
  const map = createMap(container(), { center: { lat: 41.9, lng: 12.49 }, zoom: 12, controls: false });
  const projection = createAIMapProjection(map);
  const executed = engine.execute({
    op: "points.replace",
    collection: "rome",
    points: [{
      id: "colosseum",
      position: { lat: 41.8902, lng: 12.4922 },
      title: "Колизей",
      visual: {
        image: {
          url: "/images/colosseum.jpg",
          alt: "Колизей на карте",
          shape: "circle",
          fit: "cover",
          borderColor: "#ffffff",
          borderWidth: 3
        },
        label: {
          text: "Колизей",
          display: "hover",
          fontSize: 14,
          fontWeight: 700,
          color: "#17232a",
          haloColor: "#ffffff",
          haloWidth: 3,
          offset: { x: 0, y: -38 },
          priority: 100
        },
        size: 56,
        collisionMode: "always"
      },
      popup: {
        text: "Античный амфитеатр в центре Рима.",
        image: {
          url: "https://images.example.test/colosseum.jpg",
          alt: "Колизей на закате",
          caption: "Рим, Италия"
        }
      }
    }]
  });
  assert.equal(executed.ok, true);
  assert.equal(projection.applyEvent(executed.value.event).ok, true);
  projection.getCollectionManager("rome").render();

  const mapPhoto = document.querySelector(".oh-marker-icon");
  assert.ok(mapPhoto);
  assert.equal(mapPhoto.src, "http://localhost/images/colosseum.jpg");
  assert.equal(mapPhoto.style.borderRadius, "50%");
  assert.equal(mapPhoto.style.objectFit, "cover");
  assert.match(mapPhoto.style.border, /^3px solid /);
  assert.deepEqual(projection.getCollectionSource("rome").get("colosseum").properties.visual.label.offset, { x: 0, y: -38 });
  assert.equal(document.querySelector(".oh-object-labels")?.textContent ?? "", "");
  mapPhoto.parentElement.dispatchEvent(new window.Event("pointerenter", { bubbles: true }));
  assert.equal(document.querySelector(".oh-tooltip")?.textContent, "Колизей");
  mapPhoto.parentElement.dispatchEvent(new window.Event("pointerleave", { bubbles: true }));
  assert.equal(document.querySelector(".oh-tooltip"), null);

  projection.getCollectionManager("rome").openPopup("colosseum");
  await Promise.resolve();
  const popup = document.querySelector(".oh-rich-popup-stack");
  const image = popup?.querySelector("img");
  assert.match(popup?.textContent ?? "", /Колизей/);
  assert.match(popup?.textContent ?? "", /Античный амфитеатр/);
  assert.match(popup?.textContent ?? "", /Рим, Италия/);
  assert.equal(image?.src, "https://images.example.test/colosseum.jpg");
  assert.equal(image?.alt, "Колизей на закате");
  projection.destroy();
  map.destroy();
});

test("point image popups accept only HTTPS or local URLs", () => {
  const command = (url) => ({
    op: "points.replace",
    collection: "places",
    points: [{ id: "one", position: { lat: 1, lng: 2 }, popup: { image: { url } } }]
  });

  assert.equal(validatePointsReplaceCommand(command("https://images.example.test/place.jpg")).points[0].popup.image.url,
    "https://images.example.test/place.jpg");
  assert.equal(validatePointsReplaceCommand(command("/images/place.jpg")).points[0].popup.image.url,
    "/images/place.jpg");
  for (const url of ["http://images.example.test/place.jpg", "javascript:alert(1)", "data:image/png;base64,AA==", "//example.test/place.jpg"]) {
    assert.throws(() => validatePointsReplaceCommand(command(url)),
      (error) => error.code === "INVALID_VALUE" && error.path === "$command.points[0].popup.image.url");
  }
  assert.throws(() => validatePointsReplaceCommand({
    op: "points.replace",
    collection: "places",
    points: [{ id: "one", position: { lat: 1, lng: 2 }, popup: {} }]
  }), (error) => error.code === "REQUIRED_PROPERTY" && error.path === "$command.points[0].popup");

  assert.throws(() => validatePointsReplaceCommand({
    op: "points.replace",
    collection: "places",
    points: [{ id: "one", position: { lat: 1, lng: 2 }, visual: { image: { url: "http://example.test/photo.jpg" } } }]
  }), (error) => error.code === "INVALID_VALUE" && error.path === "$command.points[0].visual.image.url");
  assert.throws(() => validatePointsReplaceCommand({
    op: "points.replace",
    collection: "places",
    points: [{ id: "one", position: { lat: 1, lng: 2 }, visual: {} }]
  }), (error) => error.code === "REQUIRED_PROPERTY" && error.path === "$command.points[0].visual");
  assert.throws(() => validatePointsReplaceCommand({
    op: "points.replace",
    collection: "places",
    points: [{ id: "one", position: { lat: 1, lng: 2 }, visual: { label: { text: "One", display: "sometimes" } } }]
  }), (error) => error.code === "INVALID_VALUE" && error.path === "$command.points[0].visual.label.display");
});

test("point snapshot recovery restores viewport and clickable ObjectManager popups", () => {
  const engine = createAICommandEngine();
  const executed = engine.execute({
    op: "points.replace",
    collection: "berlin",
    clearMap: true,
    viewport: { mode: "fit", padding: 24 },
    points: [
      { id: "gate", position: { lat: 52.5163, lng: 13.3777 }, title: "Ворота", popup: "Берлин" },
      { id: "gallery", position: { lat: 52.505, lng: 13.4397 }, title: "Галерея", popup: "Стена" }
    ]
  });
  assert.equal(executed.ok, true);

  const map = createMap(container(), { center: { lat: 55.75, lng: 37.62 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map);
  const flyCalls = [];
  const originalFly = map.flyToBounds.bind(map);
  map.flyToBounds = (...args) => {
    flyCalls.push(args);
    return originalFly(...args);
  };
  assert.deepEqual(projection.applySnapshot(engine.getSnapshot()), { ok: true, value: { revision: engine.revision, type: "snapshot" } });
  assert.equal(flyCalls.length, 0, "snapshot restore must not fly from a stale camera");
  assert.equal(map.getBounds().contains({ lat: 52.5163, lng: 13.3777 }), true);
  assert.equal(map.getBounds().contains({ lat: 52.505, lng: 13.4397 }), true);
  assert.equal(projection.getCollectionManager("berlin").getStats().clusters, 0);

  projection.getCollectionManager("berlin").openPopup("gate");
  assert.match(document.querySelector(".oh-popup")?.textContent ?? "", /Ворота — Берлин/);
  projection.destroy();
  map.destroy();
});

test("snapshot restore ignores stale scene camera when viewport fit is current", () => {
  const engine = createAICommandEngine();
  engine.execute({
    op: "apply_scene",
    scene: {
      version: 1,
      camera: { center: { lat: 55.7558, lng: 37.6176 }, zoom: 11 },
      layers: []
    }
  });
  engine.execute({
    op: "points.replace",
    collection: "portugal",
    clearMap: true,
    viewport: { mode: "fit", padding: 44, animation: "fly", durationMs: 700 },
    points: [
      { id: "lisbon", position: { lat: 38.6916, lng: -9.2159 }, title: "Lisbon" },
      { id: "porto", position: { lat: 41.1402, lng: -8.6095 }, title: "Porto" }
    ]
  });
  const snapshot = engine.getSnapshot();
  assert.ok(snapshot.scene.camera.center.lat > 38 && snapshot.scene.camera.center.lat < 42);
  assert.ok(snapshot.scene.camera.center.lng > -10 && snapshot.scene.camera.center.lng < -8);
  assert.equal(snapshot.viewport.animation, "fly");

  const map = createMap(container(), { center: { lat: 55.75, lng: 37.62 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map);
  const flyCalls = [];
  map.flyToBounds = (...args) => {
    flyCalls.push(args);
    return map;
  };
  const snapshotResult = projection.applySnapshot(snapshot);
  assert.equal(snapshotResult.ok, true, JSON.stringify(snapshotResult));
  assert.equal(flyCalls.length, 0);
  assert.equal(map.getBounds().contains({ lat: 38.6916, lng: -9.2159 }), true);
  assert.equal(map.getBounds().contains({ lat: 41.1402, lng: -8.6095 }), true);
  assert.equal(map.getBounds().contains({ lat: 55.7558, lng: 37.6176 }), false);
  projection.destroy();
  map.destroy();
});

test("string popup inherits visual.image in ObjectManager popup", () => {
  const engine = createAICommandEngine();
  const map = createMap(container(), { center: { lat: 41.9, lng: 12.49 }, zoom: 12, controls: false });
  const projection = createAIMapProjection(map);
  const executed = engine.execute({
    op: "points.replace",
    collection: "rome",
    points: [{
      id: "colosseum",
      position: { lat: 41.8902, lng: 12.4922 },
      title: "Колизей",
      popup: "Античный амфитеатр.",
      visual: {
        image: { url: "/images/colosseum.jpg", alt: "Колизей", shape: "circle" },
        size: 56
      }
    }]
  });
  assert.equal(executed.ok, true);
  assert.equal(projection.applyEvent(executed.value.event).ok, true);
  projection.getCollectionManager("rome").openPopup("colosseum");
  const popup = document.querySelector(".oh-popup, .oh-rich-popup");
  const image = document.querySelector(".oh-popup img, .oh-rich-popup img");
  assert.ok(popup);
  assert.ok(image);
  assert.match(image.getAttribute("src") ?? "", /colosseum\.jpg/);
  assert.match(popup.textContent ?? "", /Античный амфитеатр/);
  projection.destroy();
  map.destroy();
});

test("update_points patches a collection without resending unrelated points", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  assert.equal(runtime.execute({
    goal: "create_visit_route",
    collection: "places",
    routeId: "tour",
    points: [
      { id: "a", position: { lat: 1, lng: 1 }, title: "A", popup: "one" },
      { id: "b", position: { lat: 2, lng: 2 }, title: "B", popup: "two" }
    ]
  }).ok, true);
  const updated = runtime.execute({
    goal: "update_points",
    collection: "places",
    points: [{ id: "a", popup: "updated" }]
  });
  assert.equal(updated.ok, true);
  assert.equal(engine.getSnapshot().collections.places.find(({ id }) => id === "a").properties.popup, "updated");
  assert.equal(engine.getSnapshot().collections.places.find(({ id }) => id === "b").properties.popup, "two");
  assert.deepEqual(runtime.getContext().collections[0].ids, ["a", "b"]);
});

test("points.replace defaults.visual merge shared circle chrome", () => {
  const engine = createAICommandEngine();
  const result = engine.execute({
    op: "points.replace",
    collection: "places",
    defaults: {
      visual: {
        image: { shape: "circle", fit: "cover", borderColor: "#ffffff", borderWidth: 3 },
        size: 56
      }
    },
    points: [{
      id: "a",
      position: { lat: 1, lng: 2 },
      visual: { image: { url: "https://example.test/a.jpg", alt: "A" } }
    }, {
      id: "b",
      position: { lat: 3, lng: 4 },
      visual: { image: { url: "https://example.test/b.jpg", alt: "B" }, size: 40 }
    }]
  });
  assert.equal(result.ok, true);
  const [a, b] = engine.getSnapshot().collections.places;
  assert.equal(a.properties.visual.image.shape, "circle");
  assert.equal(a.properties.visual.image.borderWidth, 3);
  assert.equal(a.properties.visual.size, 56);
  assert.equal(b.properties.visual.size, 40);
  assert.equal(b.properties.visual.image.url, "https://example.test/b.jpg");
});

test("route.plan orders a point collection and projects it through RoutingLayer", () => {
  const engine = createAICommandEngine();
  engine.execute({
    op: "points.replace",
    collection: "berlin",
    viewport: { mode: "fit", padding: 24 },
    points: [
      { id: "west", position: { lat: 52.5209, lng: 13.2957 }, title: "Запад" },
      { id: "center", position: { lat: 52.5163, lng: 13.3777 }, title: "Центр" },
      { id: "north", position: { lat: 52.5351, lng: 13.3903 }, title: "Север" },
      { id: "east", position: { lat: 52.505, lng: 13.4397 }, title: "Восток" }
    ]
  });
  const planned = engine.execute({
    op: "route.plan",
    routeId: "berlin-tour",
    collection: "berlin",
    startId: "west",
    endId: "east",
    optimize: "shortest"
  });
  assert.equal(planned.ok, true);
  assert.equal(planned.value.event.type, "route");
  assert.equal(planned.value.route.id, "berlin-tour");
  assert.equal(planned.value.route.stops, 4);
  assert.ok(planned.value.route.distance > 0);

  const snapshot = engine.getSnapshot();
  const route = snapshot.routes["berlin-tour"];
  assert.equal(route.waypointIds[0], "west");
  assert.equal(route.waypointIds.at(-1), "east");
  assert.equal(new Set(route.waypointIds).size, 4);
  assert.equal(route.routes[0].coordinates.length, 4);
  assert.equal(snapshot.collections.berlin.find(({ id }) => id === "west").properties.visitOrder, 1);

  assert.equal(snapshot.viewport.revision, 2);
  const map = createMap(container(), { center: { lat: 55.75, lng: 37.62 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map);
  assert.equal(projection.applySnapshot(snapshot).ok, true);
  const routeLayer = projection.getRouteLayer("berlin-tour");
  assert.equal(routeLayer.getRoutes().length, 1);
  assert.equal(routeLayer.getRoutes()[0].coordinates.length, 4);
  assert.equal(map.getBounds().contains({ lat: 52.5209, lng: 13.2957 }), true);
  assert.equal(map.getBounds().contains({ lat: 52.505, lng: 13.4397 }), true);
  projection.getCollectionManager("berlin").openPopup("west");
  assert.match(document.querySelector(".oh-popup")?.textContent ?? "", /^1\. Запад/);
  const changed = engine.execute({
    op: "objects.update",
    collection: "berlin",
    objects: [point("west", 13.2957, 52.5209, { title: "Запад обновлён" })]
  });
  assert.equal(changed.ok, true);
  assert.equal(projection.applyEvent(changed.value.event).ok, true);
  assert.equal(projection.getRouteLayer("berlin-tour"), undefined);
  assert.equal(projection.getCollectionSource("berlin").get("west").properties.visitOrder, undefined);
  assert.equal(engine.getSnapshot().routes, undefined);
  projection.destroy();
  map.destroy();
});

test("route.plan returns repairable collection and stop errors without mutation", () => {
  const engine = createAICommandEngine({ collections: { places: [point("only", 13.4, 52.5)] } });
  const before = engine.getSnapshot();
  const tooShort = engine.execute({ op: "route.plan", routeId: "tour", collection: "places" });
  assert.equal(tooShort.ok, false);
  assert.equal(tooShort.error.code, "EMPTY_SELECTION");
  assert.deepEqual(engine.getSnapshot(), before);

  const missing = engine.execute({ op: "route.plan", routeId: "tour", collection: "missing" });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "NOT_FOUND");
  assert.equal(missing.error.path, "$command.collection");
});

test("semantic runtime discovers capabilities and commits a visit route atomically", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  const events = [];
  engine.subscribe((event) => events.push(event));
  assert.deepEqual(runtime.describeCapabilities().map(({ id }) => id), [
    "orihon.object-manager",
    "orihon.route-model",
    "orihon.visualization-model"
  ]);
  const intent = {
    goal: "create_visit_route",
    collection: "rome",
    routeId: "rome-tour",
    points: [
      { id: "vatican", position: { lat: 41.9022, lng: 12.4573 }, title: "Ватикан" },
      { id: "pantheon", position: { lat: 41.8986, lng: 12.4769 }, title: "Пантеон" },
      { id: "colosseum", position: { lat: 41.8902, lng: 12.4922 }, title: "Колизей" }
    ],
    route: { startId: "vatican", endId: "colosseum", optimize: "shortest" },
    presentation: { clearMap: true, viewport: { mode: "fit", padding: 32 } }
  };
  const planned = runtime.plan(intent);
  assert.equal(planned.ok, true);
  assert.equal(planned.value.steps.length, 2);
  assert.deepEqual(planned.value.steps[1].dependsOn, ["places"]);
  assert.deepEqual(planned.value.steps[1].input.source, { kind: "collection", id: "rome" });

  const preview = runtime.preview(planned.value);
  assert.equal(preview.ok, true);
  assert.equal(preview.value.revision, 1);
  assert.equal(preview.value.context.routes[0].reactive, true);
  assert.equal(engine.revision, 0);
  assert.equal(events.length, 0);

  const committed = runtime.commit(planned.value);
  assert.equal(committed.ok, true);
  assert.equal(committed.value.revision, 1);
  assert.deepEqual(committed.value.resources.map(({ kind, id, revision }) => [kind, id, revision]), [
    ["collection", "rome", 1],
    ["route", "rome-tour", 1]
  ]);
  assert.equal(engine.getSnapshot().routes["rome-tour"].request.reactive, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "transaction");
  assert.equal(events[0].commands.length, 2);

  const map = createMap(container(), { controls: false });
  const projection = createAIMapProjection(map);
  assert.equal(projection.applyEvent(events[0]).ok, true);
  assert.equal(projection.getCollectionSource("rome").size, 3);
  assert.equal(projection.getRouteLayer("rome-tour").getRoutes().length, 1);
  projection.destroy();
  map.destroy();
});

test("semantic runtime commits show_places without a route", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  const intent = {
    goal: "show_places",
    collection: "lisbon",
    points: [
      { id: "belem", position: { lat: 38.6916, lng: -9.2159 }, title: "Belém Tower" },
      { id: "jeronimos", position: { lat: 38.6978, lng: -9.2066 }, title: "Jerónimos" }
    ],
    presentation: { clearMap: true, viewport: { mode: "fit", padding: 24 } }
  };
  const planned = runtime.plan(intent);
  assert.equal(planned.ok, true);
  assert.equal(planned.value.steps.length, 1);
  assert.equal(planned.value.steps[0].operation, "replace_points");
  assert.equal(planned.value.goal, "show_places");

  const committed = runtime.commit(planned.value);
  assert.equal(committed.ok, true);
  assert.equal(committed.value.revision, 1);
  assert.deepEqual(committed.value.resources.map(({ kind, id }) => [kind, id]), [["collection", "lisbon"]]);
  assert.equal(committed.value.context.routes.length, 0);
  assert.equal(committed.value.context.collections[0].count, 2);
});

test("semantic intent tool exposes one compact model-native operation", () => {
  const runtime = createAIAgentRuntime(createAICommandEngine());
  const tool = createAIIntentTool(runtime);
  assert.equal(tool.definition.name, "orihon_plan");
  assert.equal(tool.definition.inputSchema, AI_INTENT_SCHEMA);
  assert.match(ORIHON_AI_INTENT_SYSTEM_PROMPT, /reactive by default/);
  const result = tool.execute({
    goal: "create_visit_route",
    collection: "places",
    routeId: "tour",
    points: [
      { id: "a", position: { lat: 1, lng: 1 } },
      { id: "b", position: { lat: 2, lng: 2 } }
    ]
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value), ["goal", "revision", "resources"]);
  assert.equal(result.value.resources.length, 2);
});

test("provider-neutral LLM agent searches places, calls orihon_plan and accumulates usage", async () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  const mapTool = createAIIntentTool(runtime);
  const searchRequests = [];
  const placeTool = createAIPlaceSearchTool({
    async search(input) {
      searchRequests.push(input);
      const index = input.query === "Alpha" ? 0 : 1;
      return [{
        id: `place-${index + 1}`,
        title: input.query,
        position: { lat: 58 + index * 0.01, lng: 56 + index * 0.01 }
      }];
    }
  });
  let turn = 0;
  const adapter = {
    provider: "test-provider",
    model: "test-model",
    async complete(request) {
      turn++;
      assert.match(request.systemPrompt, /orihon_plan/);
      assert.deepEqual(request.tools.map(({ name }) => name), ["orihon_search_places", "orihon_plan"]);
      if (turn === 1) return {
        content: null,
        toolCalls: [{ id: "search-1", name: "orihon_search_places", arguments: { city: "Perm", queries: ["Alpha", "Beta"] } }],
        usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 1 }
      };
      if (turn === 2) return {
        content: null,
        toolCalls: [{
          id: "map-1",
          name: "orihon_plan",
          arguments: {
            goal: "create_visit_route",
            collection: "agent-places",
            routeId: "agent-route",
            points: [
              { id: "place-1", position: { lat: 58, lng: 56 }, title: "Alpha" },
              { id: "place-2", position: { lat: 58.01, lng: 56.01 }, title: "Beta" }
            ],
            route: { optimize: "shortest", reactive: true },
            presentation: { clearMap: true, viewport: { mode: "fit" } }
          }
        }],
        usage: { inputTokens: 20, outputTokens: 4, cachedInputTokens: 2 }
      };
      return {
        content: "Карта обновлена.",
        toolCalls: [],
        usage: { inputTokens: 30, outputTokens: 6, cachedInputTokens: 3 },
        model: "test-model-v2"
      };
    }
  };
  const agent = createAILLMAgent({
    adapter,
    tools: [placeTool, mapTool],
    systemPrompt: `${ORIHON_AI_AGENT_SYSTEM_PROMPT}\n${mapTool.systemPrompt}`
  });
  const result = await agent.run("Show two places in Perm");
  assert.equal(result.ok, true);
  assert.equal(result.value.message, "Карта обновлена.");
  assert.equal(result.value.model, "test-model-v2");
  assert.deepEqual(result.value.usage, { inputTokens: 60, outputTokens: 12, cachedInputTokens: 6 });
  assert.deepEqual(result.value.toolCalls.map(({ name }) => name), ["orihon_search_places", "orihon_plan"]);
  assert.equal(searchRequests.length, 2);
  assert.equal(engine.getSnapshot().collections["agent-places"].length, 2);
  assert.equal(engine.getSnapshot().routes["agent-route"].waypointIds.length, 2);
});

test("OpenAI-compatible adapter maps generic tools, messages and token usage", async () => {
  let captured;
  const adapter = createOpenAICompatibleAdapter({
    baseURL: "https://models.example/v1/",
    model: "another-model",
    apiKey: "secret",
    fetch: async (url, init) => {
      captured = { url: String(url), init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        model: "another-model-2026",
        choices: [{ message: { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "map", arguments: "{\"x\":1}" } }] } }],
        usage: { prompt_tokens: 101, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 80 } }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const completion = await adapter.complete({
    systemPrompt: "system",
    messages: [{ role: "user", content: "map it" }],
    tools: [{ name: "map", description: "Map", inputSchema: { type: "object" } }]
  });
  assert.equal(captured.url, "https://models.example/v1/chat/completions");
  assert.equal(captured.init.headers.authorization, "Bearer secret");
  assert.equal(captured.body.tools[0].function.name, "map");
  assert.deepEqual(completion.toolCalls[0].arguments, { x: 1 });
  assert.deepEqual(completion.usage, { inputTokens: 101, outputTokens: 7, cachedInputTokens: 80 });
  assert.equal(completion.model, "another-model-2026");
});

test("Nominatim place provider validates, normalizes and caches server results", async () => {
  let requests = 0;
  const provider = createNominatimPlaceSearchProvider({
    userAgent: "orihon-test/1.0",
    minIntervalMs: 0,
    fetch: async () => {
      requests++;
      return new Response(JSON.stringify([{
        place_id: 12,
        osm_type: "node",
        osm_id: 34,
        lat: "58.01",
        lon: "56.24",
        display_name: "Test Museum, Perm",
        type: "museum"
      }]), { status: 200 });
    }
  });
  const first = await provider.search({ city: "Perm", query: "Test Museum", limit: 1 });
  const second = await provider.search({ city: "Perm", query: "Test Museum", limit: 1 });
  assert.equal(requests, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(first[0], {
    id: "osm-node-34",
    title: "Test Museum",
    position: { lat: 58.01, lng: 56.24 },
    displayName: "Test Museum, Perm",
    query: "Test Museum",
    category: "museum"
  });
});

test("visit search skips administrative and service POIs", async () => {
  const provider = createNominatimPlaceSearchProvider({
    userAgent: "orihon-test/1.0",
    minIntervalMs: 0,
    fetch: async () => new Response(JSON.stringify([
      {
        place_id: 1, osm_type: "relation", osm_id: 11, lat: "17.05", lon: "-96.72",
        display_name: "Colegio Monte Albán, Oaxaca", category: "amenity", type: "college"
      },
      {
        place_id: 2, osm_type: "way", osm_id: 22, lat: "17.0439", lon: "-96.7675",
        display_name: "Zona Arqueológica de Monte Albán, Oaxaca", category: "historic", type: "archaeological_site"
      }
    ]), { status: 200 })
  });
  const [place] = await provider.search({ query: "Monte Alban", area: "Mexico", limit: 1 });
  assert.equal(place.id, "osm-way-22");
  assert.equal(place.category, "archaeological_site");
});

test("place search reports imagesMissing and compact results", async () => {
  const provider = createNominatimPlaceSearchProvider({
    userAgent: "orihon-test/1.0",
    minIntervalMs: 0,
    fetch: async (url) => {
      const href = String(url);
      if (href.includes("nominatim") || href.includes("format=jsonv2")) {
        return new Response(JSON.stringify([{
          place_id: 12, osm_type: "node", osm_id: 34, lat: "58.01", lon: "56.24",
          display_name: "Test Museum, Perm", category: "tourism", type: "museum"
        }]), { status: 200 });
      }
      if (href.includes("action=query")) {
        return new Response(JSON.stringify({ query: { pages: { 1: { title: "Test Museum" } } } }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }
  });
  const compact = await executeAIPlaceSearch(provider, {
    queries: ["Test Museum"],
    includeImages: true,
    includeSummaries: true
  });
  assert.equal(compact.ok, true);
  assert.equal(compact.value.profile, "visit");
  assert.deepEqual(compact.value.imagesMissing, ["Test Museum"]);
  assert.equal(compact.value.places[0].displayName, undefined);
  assert.equal(compact.value.places[0].query, "Test Museum");

  const full = await executeAIPlaceSearch(provider, {
    queries: ["Test Museum"],
    resultMode: "full"
  });
  assert.equal(full.value.places[0].displayName, "Test Museum, Perm");
});

test("place search attaches wikipedia thumbnail and summary", async () => {
  const provider = createNominatimPlaceSearchProvider({
    userAgent: "orihon-test/1.0",
    minIntervalMs: 0,
    fetch: async (url) => {
      const href = String(url);
      if (href.includes("format=jsonv2")) {
        return new Response(JSON.stringify([{
          place_id: 1, osm_type: "way", osm_id: 2, lat: "20.68", lon: "-88.56",
          display_name: "Chichen Itza, Yucatan", category: "tourism", type: "attraction"
        }]), { status: 200 });
      }
      return new Response(JSON.stringify({
        query: {
          pages: {
            1: {
              title: "Chichen Itza",
              thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/thumb/a.jpg/500px-a.jpg?utm=1" },
              extract: "A Maya city on the Yucatan Peninsula."
            }
          }
        }
      }), { status: 200 });
    }
  });
  const result = await executeAIPlaceSearch(provider, {
    queries: ["Chichen Itza"],
    includeImages: true,
    includeSummaries: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.imagesMissing, undefined);
  assert.equal(result.value.places[0].image.url, "https://upload.wikimedia.org/wikipedia/commons/thumb/a.jpg/500px-a.jpg");
  assert.match(result.value.places[0].summary, /Maya city/);
});

test("wikipedia media prefers the user query over a local OSM title", async () => {
  const provider = createNominatimPlaceSearchProvider({
    userAgent: "orihon-test/1.0",
    minIntervalMs: 0,
    fetch: async (url) => {
      const href = String(url);
      if (href.includes("format=jsonv2")) {
        return new Response(JSON.stringify([{
          place_id: 1, osm_type: "way", osm_id: 2, lat: "43.268", lon: "-2.934",
          display_name: "Bilboko Guggenheim museoa, Bilbao",
          category: "tourism",
          type: "museum",
          namedetails: { name: "Bilboko Guggenheim museoa", "name:en": "Guggenheim Museum Bilbao" }
        }]), { status: 200 });
      }
      if (href.includes("list=search")) {
        return new Response(JSON.stringify({ query: { search: [{ title: "Guggenheim Museum Bilbao" }] } }), { status: 200 });
      }
      if (decodeURIComponent(href).includes("Guggenheim")) {
        return new Response(JSON.stringify({
          query: {
            normalized: [{ from: "Guggenheim Bilbao", to: "Guggenheim Museum Bilbao" }],
            pages: {
              1: {
                title: "Guggenheim Museum Bilbao",
                thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/guggenheim.jpg" },
                extract: "The Guggenheim Museum Bilbao is a museum of modern and contemporary art."
              }
            }
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 });
    }
  });
  const result = await executeAIPlaceSearch(provider, {
    queries: ["Guggenheim Bilbao"],
    includeImages: true,
    includeSummaries: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.places[0].title, "Guggenheim Museum Bilbao");
  assert.equal(result.value.places[0].image.url, "https://upload.wikimedia.org/wikipedia/commons/guggenheim.jpg");
  assert.equal(result.value.imagesMissing, undefined);
});

test("wikipedia disambiguation extracts are ignored", async () => {
  const provider = createNominatimPlaceSearchProvider({
    userAgent: "orihon-test/1.0",
    minIntervalMs: 0,
    fetch: async (url) => {
      const href = String(url);
      if (href.includes("format=jsonv2")) {
        return new Response(JSON.stringify([{
          place_id: 1, osm_type: "relation", osm_id: 2, lat: "37.37", lon: "-5.98",
          display_name: "Plaza de España, Seville", category: "tourism", type: "artwork"
        }]), { status: 200 });
      }
      if (href.includes("list=search")) {
        return new Response(JSON.stringify({ query: { search: [{ title: "Plaza de España, Seville" }] } }), { status: 200 });
      }
      if (href.includes("Seville") || href.includes("Sevilla")) {
        return new Response(JSON.stringify({
          query: {
            pages: {
              1: {
                title: "Plaza de España, Seville",
                thumbnail: { source: "https://upload.wikimedia.org/wikipedia/commons/plaza.jpg" },
                extract: "The Plaza de España is a plaza in the Parque de María Luisa, in Seville, Spain."
              }
            }
          }
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        query: { pages: { 1: { title: "Plaza de España", extract: "Plaza de España (Square of Spain) may refer to:" } } }
      }), { status: 200 });
    }
  });
  const result = await executeAIPlaceSearch(provider, {
    queries: ["Plaza de Espana Seville"],
    includeImages: true,
    includeSummaries: true
  });
  assert.equal(result.ok, true);
  assert.match(result.value.places[0].summary ?? "", /Parque de María Luisa/);
  assert.equal(result.value.places[0].image.url, "https://upload.wikimedia.org/wikipedia/commons/plaza.jpg");
});

test("semantic plan rollback is atomic and reactive routes follow collection changes", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  const invalid = runtime.execute({
    goal: "create_visit_route",
    collection: "broken",
    routeId: "broken-tour",
    points: [{ id: "only", position: { lat: 1, lng: 2 } }]
  });
  assert.equal(invalid.ok, false);
  assert.equal(engine.revision, 0);
  assert.deepEqual(engine.getSnapshot().collections, {});

  const created = runtime.execute({
    goal: "create_visit_route",
    collection: "places",
    routeId: "tour",
    points: [
      { id: "a", position: { lat: 1, lng: 1 }, title: "A" },
      { id: "b", position: { lat: 1, lng: 2 }, title: "B" },
      { id: "c", position: { lat: 1, lng: 3 }, title: "C" }
    ]
  });
  assert.equal(created.ok, true);
  const moved = engine.execute({
    op: "objects.update",
    collection: "places",
    objects: [point("b", 2.5, 1, { title: "B moved" })]
  });
  assert.equal(moved.ok, true);
  assert.equal(moved.value.event.type, "objects");
  assert.equal(moved.value.event.routes.length, 1);
  assert.equal(engine.getSnapshot().routes.tour.waypointIds.length, 3);

  const removed = engine.execute({ op: "objects.remove", collection: "places", ids: ["b"] });
  assert.equal(removed.ok, true);
  assert.equal(removed.value.event.routes[0].waypointIds.length, 2);
  assert.equal(engine.getSnapshot().routes.tour.waypointIds.length, 2);

  const insufficient = engine.execute({ op: "objects.remove", collection: "places", ids: ["c"] });
  assert.equal(insufficient.ok, true);
  assert.deepEqual(insufficient.value.event.removedRouteIds, ["tour"]);
  assert.equal(engine.getSnapshot().routes, undefined);
});

test("agent session exposes local browser bridge stubs without persistence", async () => {
  const engine = createAICommandEngine();
  const session = createAIAgentSession({
    id: "map:prague",
    actor: { userId: "582" },
    engine,
    capabilities: ["objects", "routes", "viewport", "selection", "popup"]
  });
  assert.equal(session.revision, 0);
  assert.deepEqual(session.describeCapabilities().map(({ id }) => id).sort(), [
    "orihon.object-manager",
    "orihon.route-model"
  ]);

  const bridge = session.connect();
  assert.equal(session.connect(), bridge);
  assert.ok(bridge.list().some(({ name }) => name === "map.set_viewport"));
  assert.equal(bridge.list().some(({ name }) => name === "map.draw_get_mode"), false);

  const viewport = await bridge.call("map.set_viewport", {
    center: { lat: 50.08, lng: 14.42 },
    zoom: 12
  });
  assert.equal(viewport.ok, true);
  assert.deepEqual(viewport.value, { center: { lat: 50.08, lng: 14.42 }, zoom: 12 });

  const selection = await bridge.call("map.set_selection", { ids: ["a", "b"] });
  assert.equal(selection.ok, true);
  assert.deepEqual(session.local.selection, ["a", "b"]);

  const context = session.getContext();
  assert.equal(context.session.id, "map:prague");
  assert.equal(context.session.actor.userId, "582");
  assert.deepEqual(context.local.viewport, { center: { lat: 50.08, lng: 14.42 }, zoom: 12 });
  assert.ok(context.browserTools.length >= 4);

  const committed = session.execute({
    goal: "create_visit_route",
    collection: "places",
    routeId: "tour",
    points: [
      { id: "a", position: { lat: 50.08, lng: 14.42 } },
      { id: "b", position: { lat: 50.09, lng: 14.43 } }
    ]
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.value.revision, 1);

  const locked = createAIAgentSession({
    id: "map:locked",
    engine: createAICommandEngine(),
    capabilities: ["viewport"]
  });
  const denied = locked.execute({
    goal: "create_visit_route",
    collection: "places",
    routeId: "tour",
    points: [
      { id: "a", position: { lat: 1, lng: 1 } },
      { id: "b", position: { lat: 2, lng: 2 } }
    ]
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "FORBIDDEN");

  const noDraw = await locked.connect().call("map.draw_get_mode");
  assert.equal(noDraw.ok, false);
  assert.equal(noDraw.error.code, "NOT_FOUND");
});

test("agent session bridge drives live map viewport selection and popup", async () => {
  const engine = createAICommandEngine();
  const map = createMap(container(), { center: { lat: 55.75, lng: 37.62 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map);
  const session = createAIAgentSession({
    id: "map:live",
    engine,
    map,
    projection,
    capabilities: ["objects", "routes", "viewport", "selection", "popup"]
  });

  const planned = session.execute({
    goal: "create_visit_route",
    collection: "places",
    routeId: "tour",
    points: [
      { id: "a", position: { lat: 55.75, lng: 37.62 }, title: "A", popup: "Alpha" },
      { id: "b", position: { lat: 55.76, lng: 37.63 }, title: "B", popup: "Beta" }
    ]
  });
  assert.equal(planned.ok, true);
  assert.deepEqual(projection.applySnapshot(engine.getSnapshot()), { ok: true, value: { revision: engine.revision, type: "snapshot" } });

  const moved = await session.call("map.set_viewport", {
    center: { lat: 50.08, lng: 14.42 },
    zoom: 12
  });
  assert.equal(moved.ok, true);
  assert.ok(Math.abs(map.getCenter().lat - 50.08) < 0.0001);
  assert.ok(Math.abs(map.getZoom() - 12) < 0.0001);

  const selected = await session.call("map.set_selection", { ids: ["b"], collection: "places" });
  assert.equal(selected.ok, true);
  assert.equal(projection.getCollectionManager("places").getSelectedId(), "b");

  const opened = await session.call("map.open_popup", { id: "a", collection: "places" });
  assert.equal(opened.ok, true);
  assert.match(document.querySelector(".oh-popup")?.textContent ?? "", /A — Alpha|Alpha/);
  assert.equal(session.local.openPopupId, "a");

  const intentViaCall = await session.call("orihon.plan", {
    goal: "update_points",
    collection: "places",
    points: [{ id: "a", popup: "Updated" }]
  });
  assert.equal(intentViaCall.ok, true);
  assert.equal(engine.getSnapshot().collections.places.find(({ id }) => id === "a").properties.popup, "Updated");

  projection.destroy();
  map.destroy();
});

test("agent session observes browser selection and object moves into engine", () => {
  const engine = createAICommandEngine();
  const map = createMap(container(), { center: { lat: 55.75, lng: 37.62 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map, { objectManager: { clusterize: false } });
  const session = createAIAgentSession({
    id: "map:observe",
    engine,
    map,
    projection,
    capabilities: ["objects", "routes", "viewport", "selection"]
  });
  assert.equal(session.execute({
    goal: "show_places",
    collection: "stops",
    points: [
      { id: "s1", position: { lat: 55.75, lng: 37.62 }, title: "One" },
      { id: "s2", position: { lat: 55.76, lng: 37.63 }, title: "Two" }
    ],
    presentation: { clearMap: true }
  }).ok, true);
  assert.deepEqual(projection.applySnapshot(engine.getSnapshot()), { ok: true, value: { revision: engine.revision, type: "snapshot" } });

  const events = [];
  session.subscribeUser((event) => events.push(event));
  const stopObserve = session.observeBrowser({ selection: true, editable: true, syncEngine: true });

  projection.getCollectionManager("stops").setSelected("s2");
  projection.getCollectionManager("stops").emit("click", {
    objectId: "s2",
    object: projection.getCollectionManager("stops").getObject("s2")
  });
  assert.deepEqual(session.local.selection, ["s2"]);
  assert.equal(session.local.lastUserEvent?.type, "selectionchange");
  assert.equal(events.at(-1)?.type, "selectionchange");

  const moved = session.applyObjectMove({
    collection: "stops",
    id: "s1",
    position: { lat: 55.751, lng: 37.621 },
    previous: { lat: 55.75, lng: 37.62 },
    syncEngine: true,
    source: "user"
  });
  assert.equal(moved.ok, true);
  assert.equal(moved.value.event.type, "objectmove");
  assert.ok(moved.value.revision >= 2);
  const feature = engine.getSnapshot().collections.stops.find(({ id }) => id === "s1");
  assert.deepEqual(feature.geometry.coordinates, [37.621, 55.751]);
  assert.equal(session.local.lastUserEvent?.type, "objectmove");
  assert.equal(session.getContext().local.lastUserEvent.type, "objectmove");

  stopObserve();
  projection.destroy();
  map.destroy();
});

test("visualization stress intents generate and update bulk data inside the engine", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  const created = runtime.execute({
    goal: "create_visualization_stress_test",
    collection: "load-vehicles",
    routeId: "load-route",
    center: { lat: 55.7558, lng: 37.6176 },
    objectCount: 500,
    routeStops: 20,
    seed: 42,
    spreadKm: 12
  });
  assert.equal(created.ok, true);
  assert.equal(created.value.revision, 1);
  assert.equal(created.value.plan.steps.length, 1);
  assert.equal(created.value.context.collections.find(({ ref }) => ref.id === "load-vehicles").count, 500);
  assert.equal(created.value.context.collections.find(({ ref }) => ref.id === "load-vehicles-route-stops").count, 20);
  assert.equal(created.value.context.routes[0].stops, 20);
  const before = engine.getSnapshot().collections["load-vehicles"][0].geometry.coordinates;
  const map = createMap(container(), { center: { lat: 55.7558, lng: 37.6176 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map);
  assert.deepEqual(projection.applySnapshot(engine.getSnapshot()), { ok: true, value: { revision: engine.revision, type: "snapshot" } });
  let updateEvent;
  const unsubscribe = engine.subscribe((event) => { updateEvent = event; });

  const updated = runtime.execute({
    goal: "update_visualization_stress_test",
    collection: "load-vehicles",
    center: { lat: 55.7558, lng: 37.6176 },
    updateCount: 100,
    tick: 1,
    seed: 42,
    spreadKm: 12
  });
  unsubscribe();
  assert.equal(updated.ok, true);
  assert.equal(updated.value.revision, 2);
  assert.equal(updateEvent.type, "transaction");
  assert.equal(updateEvent.events.length, 1);
  assert.equal(updateEvent.snapshot, undefined);
  assert.equal(projection.applyEvent(updateEvent).ok, true);
  assert.equal(projection.getCollectionManager("load-vehicles").getStats().objects, 500);
  assert.equal(updated.value.context.collections.find(({ ref }) => ref.id === "load-vehicles").count, 500);
  const after = engine.getSnapshot().collections["load-vehicles"][0].geometry.coordinates;
  assert.notDeepEqual(after, before);
  assert.match(engine.getSnapshot().collections["load-vehicles"][101].properties.popup, /пакет 0$/);
  projection.destroy();
  map.destroy();
});

test("HTTP adapter accepts browser local viewport patches on a session", async () => {
  const engine = createAICommandEngine();
  const sessions = createAIAgentSessionRegistry();
  const handler = createAIHTTPHandler(engine, { sessions });
  await handler(new Request("http://localhost/api/orihon/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "map:view" })
  }));
  const patched = await handler(new Request("http://localhost/api/orihon/sessions/map%3Aview/local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      viewport: {
        center: { lat: 41.9, lng: 12.5 },
        zoom: 13,
        bounds: { south: 41.88, west: 12.47, north: 41.92, east: 12.53 }
      },
      lastUserEvent: {
        type: "viewportchange",
        viewport: {
          center: { lat: 41.9, lng: 12.5 },
          zoom: 13,
          bounds: { south: 41.88, west: 12.47, north: 41.92, east: 12.53 }
        },
        source: "user",
        at: 1
      }
    })
  }));
  assert.equal(patched.status, 200);
  const body = await patched.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.value.local.viewport, {
    center: { lat: 41.9, lng: 12.5 },
    zoom: 13,
    bounds: { south: 41.88, west: 12.47, north: 41.92, east: 12.53 }
  });
  const context = await handler(new Request("http://localhost/api/orihon/sessions/map%3Aview"));
  const contextBody = await context.json();
  assert.equal(contextBody.local.lastUserEvent.type, "viewportchange");
  assert.equal(contextBody.local.viewport.zoom, 13);
  assert.equal(contextBody.local.viewport.bounds.south, 41.88);
});

test("HTTP adapter scopes context intents and SSE by session id", async () => {
  const engine = createAICommandEngine();
  const sessions = createAIAgentSessionRegistry();
  const handler = createAIHTTPHandler(engine, { sessions });

  const created = await handler(new Request("http://localhost/api/orihon/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "map:demo",
      actor: { userId: "582" },
      capabilities: ["objects", "routes", "viewport", "selection", "popup"]
    })
  }));
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.value.session.id, "map:demo");
  assert.equal(createdBody.value.session.actor.userId, "582");
  assert.deepEqual(createdBody.value.session.browserCapabilities.sort(), ["popup", "selection", "viewport"]);

  const caps = await handler(new Request("http://localhost/api/orihon/sessions/map%3Ademo/capabilities"));
  assert.equal(caps.status, 200);
  const capsBody = await caps.json();
  assert.equal(capsBody.interfaces.sessions, true);
  assert.equal(capsBody.session.id, "map:demo");
  assert.equal(capsBody.capabilities.length, 2);

  const locked = createAIAgentSession({
    id: "map:locked",
    engine,
    capabilities: ["viewport"]
  });
  sessions.register(locked);
  const denied = await handler(new Request("http://localhost/api/orihon/sessions/map%3Alocked/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      intent: {
        goal: "create_visit_route",
        collection: "places",
        routeId: "tour",
        points: [
          { id: "a", position: { lat: 1, lng: 1 } },
          { id: "b", position: { lat: 2, lng: 2 } }
        ]
      }
    })
  }));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, "FORBIDDEN");

  const committed = await handler(new Request("http://localhost/api/orihon/intents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "map:demo",
      intent: {
        goal: "create_visit_route",
        collection: "places",
        routeId: "tour",
        points: [
          { id: "a", position: { lat: 1, lng: 1 } },
          { id: "b", position: { lat: 2, lng: 2 } }
        ]
      }
    })
  }));
  assert.equal(committed.status, 200);
  const committedBody = await committed.json();
  assert.equal(committedBody.value.sessionId, "map:demo");
  assert.equal(committedBody.value.revision, 1);

  const context = await handler(new Request("http://localhost/api/orihon/context?sessionId=map%3Ademo"));
  assert.equal(context.status, 200);
  assert.equal((await context.json()).session.id, "map:demo");

  const controller = new AbortController();
  const events = await handler(new Request("http://localhost/api/orihon/sessions/map%3Ademo/events", {
    signal: controller.signal
  }));
  assert.equal(events.status, 200);
  assert.equal(events.headers.get("content-type")?.startsWith("text/event-stream"), true);
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  let ready = "";
  while (!ready.includes("\n\n")) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    ready += decoder.decode(value, { stream: true });
  }
  controller.abort();
  assert.match(ready, /event: ready/);
  assert.match(ready, /"sessionId":"map:demo"/);
  assert.match(ready, /"userId":"582"/);
});

test("HTTP adapter exposes semantic capabilities, context, preview and commit", async () => {
  const engine = createAICommandEngine();
  const handler = createAIHTTPHandler(engine);
  const capabilities = await handler(new Request("http://localhost/api/orihon/capabilities"));
  assert.equal(capabilities.status, 200);
  const capabilityBody = await capabilities.json();
  assert.equal(capabilityBody.capabilities.length, 3);
  assert.equal(capabilityBody.interfaces.http.places.path, "/api/orihon/places");
  assert.equal(capabilityBody.interfaces.placeSearch, false);
  const missingSearch = await handler(new Request("http://localhost/api/orihon/places", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: ["X"] })
  }));
  assert.equal(missingSearch.status, 503);
  const intent = {
    goal: "create_visit_route",
    collection: "places",
    routeId: "tour",
    points: [
      { id: "a", position: { lat: 1, lng: 1 } },
      { id: "b", position: { lat: 2, lng: 2 } }
    ]
  };
  const post = (path, baseRevision = 0) => handler(new Request(`http://localhost/api/orihon/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent, baseRevision })
  }));
  const previewResponse = await post("intents/preview");
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.value.goal, "create_visit_route");
  assert.equal(preview.value.plan.steps.length, 2);
  assert.deepEqual(preview.value.plan.steps[0].input, {});
  assert.equal(engine.revision, 0);
  const commitResponse = await post("intents");
  assert.equal(commitResponse.status, 200);
  const committed = await commitResponse.json();
  assert.equal(committed.value.revision, 1);
  assert.equal(committed.value.goal, "create_visit_route");
  assert.equal(committed.value.plan, undefined);
  assert.ok(committed.value.context);
  const contextResponse = await handler(new Request("http://localhost/api/orihon/context"));
  const context = await contextResponse.json();
  assert.equal(context.collections[0].ref.id, "places");
  assert.deepEqual(context.collections[0].ids, ["a", "b"]);
  assert.equal(context.routes[0].reactive, true);
});

test("HTTP adapter exposes compact place search", async () => {
  const engine = createAICommandEngine();
  const placeSearch = createAIPlaceSearchTool({
    async search() {
      return [{
        id: "osm-node-1",
        title: "Alpha",
        query: "Alpha",
        position: { lat: 1, lng: 2 },
        displayName: "Alpha, long OSM name",
        category: "museum"
      }];
    }
  });
  const handler = createAIHTTPHandler(engine, { placeSearch });
  const response = await handler(new Request("http://localhost/api/orihon/places", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: ["Alpha"], includeImages: true, area: "Mexico" })
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.value.area, "Mexico");
  assert.equal(body.value.profile, "visit");
  assert.deepEqual(body.value.places[0], {
    id: "osm-node-1",
    title: "Alpha",
    position: { lat: 1, lng: 2 },
    query: "Alpha",
    category: "museum"
  });
  assert.deepEqual(body.value.imagesMissing, ["Alpha"]);
});

test("HTTP adapter exposes snapshots, commands and optimistic conflicts", async () => {
  const engine = createAICommandEngine();
  const handler = createAIHTTPHandler(engine);
  const post = (body) => handler(new Request("http://localhost/api/orihon/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }));

  const acceptedResponse = await post({ command: { op: "set_view", center: { lat: 52.52, lng: 13.405 }, zoom: 11 }, baseRevision: 0 });
  assert.equal(acceptedResponse.status, 200);
  const accepted = await acceptedResponse.json();
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.revision, 1);

  const conflictResponse = await post({ command: { op: "clear" }, baseRevision: 0 });
  assert.equal(conflictResponse.status, 409);
  assert.equal((await conflictResponse.json()).error.code, "REVISION_CONFLICT");

  const snapshotResponse = await handler(new Request("http://localhost/api/orihon/snapshot"));
  assert.equal(snapshotResponse.status, 200);
  assert.deepEqual((await snapshotResponse.json()).scene.camera, { center: { lat: 52.52, lng: 13.405 }, zoom: 11 });
});

test("engine tool bridge exposes scene and ObjectManager command families", () => {
  const engine = createAICommandEngine();
  const tool = createAIEngineTool(engine);
  assert.equal(tool.definition.inputSchema, AI_ENGINE_COMMAND_SCHEMA);
  assert.equal(AI_ENGINE_COMMAND_SCHEMA.oneOf.length, 17);
  assert.match(ORIHON_AI_ENGINE_SYSTEM_PROMPT, /objects\.batch/);
  const compact = tool.execute({ op: "objects.add", collection: "places", objects: [point(1, 2, 3)] });
  assert.deepEqual(compact, { ok: true, value: { op: "objects.add", revision: 1 } });

  const pointsTool = createAIEngineTool(engine, { profile: "points" });
  assert.equal(pointsTool.definition.inputSchema, AI_ENGINE_COMMAND_SCHEMAS.points);
  assert.equal(pointsTool.definition.inputSchema.oneOf.length, 1);
  assert.match(pointsTool.systemPrompt, /points\.replace/);
  assert.equal(pointsTool.systemPrompt, ORIHON_AI_POINTS_SYSTEM_PROMPT);

  const routeEngine = createAICommandEngine({ collections: {
    places: [point("a", 13.3, 52.5), point("b", 13.4, 52.51)]
  } });
  const routeTool = createAIEngineTool(routeEngine, { profile: "routes" });
  assert.equal(routeTool.definition.inputSchema, AI_ENGINE_COMMAND_SCHEMAS.routes);
  assert.equal(routeTool.definition.inputSchema.oneOf.length, 1);
  assert.match(routeTool.systemPrompt, /route\.plan/);
  const compactRoute = routeTool.execute({ op: "route.plan", routeId: "tour", collection: "places" });
  assert.equal(compactRoute.ok, true);
  assert.deepEqual(Object.keys(compactRoute.value), ["op", "revision", "route"]);
  assert.equal(compactRoute.value.route.stops, 2);

  const fullResult = createAIEngineTool(createAICommandEngine(), { resultMode: "full" })
    .execute({ op: "set_view", center: { lat: 1, lng: 2 }, zoom: 3 });
  assert.equal(fullResult.ok, true);
  assert.equal(fullResult.value.event.command.op, "set_view");
});

test("tool schemas reuse internal definitions without dangling references", () => {
  for (const schema of [AI_COMMAND_SCHEMA, AI_ENGINE_COMMAND_SCHEMA, ...Object.values(AI_ENGINE_COMMAND_SCHEMAS), AI_INTENT_SCHEMA]) {
    const definitions = schema.$defs;
    assert.ok(definitions && typeof definitions === "object");
    const serialized = JSON.stringify(schema);
    const references = [...serialized.matchAll(/"\$ref":"#\/\$defs\/([^"/]+)"/g)].map((match) => match[1]);
    assert.ok(references.length > 0);
    for (const name of references) assert.ok(name in definitions, `missing schema definition ${name}`);
  }
  assert.ok(JSON.stringify(AI_COMMAND_SCHEMA).length < 8_000);
  assert.ok(JSON.stringify(AI_ENGINE_COMMAND_SCHEMA).length < 16_000);
  assert.ok(JSON.stringify(AI_ENGINE_COMMAND_SCHEMAS.points).length < 5_000);
  assert.deepEqual(AI_ENGINE_COMMAND_SCHEMA.oneOf.slice(-8).map(({ $ref }) => $ref), [
    "#/$defs/objectsAdd",
    "#/$defs/objectsUpdate",
    "#/$defs/objectsReplace",
    "#/$defs/objectsRemove",
    "#/$defs/objectsClear",
    "#/$defs/objectsBatch",
    "#/$defs/pointsReplace",
    "#/$defs/routePlan"
  ]);
  assert.ok(JSON.stringify(AI_ENGINE_COMMAND_SCHEMAS.objects).length < 5_000);
  assert.ok(JSON.stringify(AI_ENGINE_COMMAND_SCHEMAS.routes).length < 2_500);
});

test("AI schemas and package subpath exports are published", async () => {
  const root = new URL("../", import.meta.url);
  const [schema, commandSchema, engineCommandSchema, pkg] = await Promise.all([
    readFile(new URL("schemas/orihon-scene-v1.schema.json", root), "utf8").then(JSON.parse),
    readFile(new URL("schemas/orihon-command-v1.schema.json", root), "utf8").then(JSON.parse),
    readFile(new URL("schemas/orihon-engine-command-v1.schema.json", root), "utf8").then(JSON.parse),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse)
  ]);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.properties.version.const, 1);
  assert.deepEqual(pkg.exports["./ai"], {
    types: "./dist/ai-entry.d.ts",
    import: "./dist/ai-entry.js"
  });
  assert.equal(pkg.exports["./schema/scene-v1.json"], "./schemas/orihon-scene-v1.schema.json");
  assert.equal(commandSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(commandSchema.oneOf.length, 9);
  assert.deepEqual(commandSchema.oneOf.map(({ $ref }) => $ref), [
    "#/$defs/setView",
    "#/$defs/flyTo",
    "#/$defs/add",
    "#/$defs/update",
    "#/$defs/remove",
    "#/$defs/clear",
    "#/$defs/fit",
    "#/$defs/query",
    "#/$defs/applyScene"
  ]);
  assert.equal(pkg.exports["./schema/command-v1.json"], "./schemas/orihon-command-v1.schema.json");
  assert.equal(engineCommandSchema.oneOf.length, 9);
  assert.equal(pkg.exports["./schema/engine-command-v1.json"], "./schemas/orihon-engine-command-v1.schema.json");
  assert.ok(pkg.files.includes("schemas"));
  assert.ok(pkg.files.includes("llms.txt"));
});

test("session tools AG-UI adapter and memory store round-trip", async () => {
  const engine = createAICommandEngine();
  const session = createAIAgentSession({
    id: "map:store",
    actor: { userId: "u1" },
    engine,
    capabilities: ["objects", "routes", "viewport", "selection"]
  });
  assert.equal(session.execute({
    goal: "show_places",
    collection: "stops",
    points: [
      { id: "a", position: { lat: 55.75, lng: 37.62 }, title: "A" },
      { id: "b", position: { lat: 55.76, lng: 37.63 }, title: "B" }
    ],
    presentation: { clearMap: true }
  }).ok, true);
  session.patchLocal({
    viewport: { center: { lat: 55.75, lng: 37.62 }, zoom: 11, bounds: { south: 55.7, west: 37.5, north: 55.8, east: 37.7 } },
    selection: ["a"]
  });

  const tools = listAISessionTools(session);
  assert.ok(tools.some(({ name }) => name === "orihon.plan"));
  assert.ok(tools.some(({ name }) => name === "map.set_viewport"));
  assert.ok(tools.some(({ name }) => name === "map.get_selection"));

  const agui = createAIAGUIAdapter(session);
  assert.deepEqual(agui.listTools().map(({ name }) => name).sort(), tools.map(({ name }) => name).sort());
  const events = [];
  for await (const event of agui.runTool({
    name: "map.set_viewport",
    args: { center: { lat: 50.08, lng: 14.42 }, zoom: 12 }
  })) {
    events.push(event.type);
  }
  assert.ok(events.includes("TOOL_CALL_START"));
  assert.ok(events.includes("TOOL_CALL_RESULT"));
  assert.ok(events.includes("RUN_FINISHED"));
  assert.deepEqual(session.local.viewport, { center: { lat: 50.08, lng: 14.42 }, zoom: 12 });

  const registered = [];
  const install = await installAIWebMCPTools(session, {
    modelContext: {
      async registerTool(tool, options) {
        registered.push(tool.name);
        assert.equal(typeof tool.execute, "function");
        assert.ok(options?.signal);
      }
    },
    includeServer: false
  });
  assert.ok(registered.includes("map.get_viewport"));
  assert.equal(registered.includes("orihon.plan"), false);
  install.abort.abort();

  const store = createMemoryAISessionStore();
  const saved = store.save(session);
  assert.equal(saved.version, 1);
  assert.equal(saved.id, "map:store");
  assert.equal(saved.snapshot.collections.stops.length, 2);
  assert.equal(saved.local.selection[0], "a");

  const restored = restoreAIAgentSession(saved);
  assert.equal(restored.id, "map:store");
  assert.equal(restored.engine.revision, session.engine.revision);
  assert.equal(restored.engine.getSnapshot().collections.stops.length, 2);
  assert.deepEqual(restored.local.selection, ["a"]);
  assert.equal(restored.execute({
    goal: "update_points",
    collection: "stops",
    points: [{ id: "a", title: "A2" }]
  }).ok, true);
  assert.equal(restored.engine.getSnapshot().collections.stops.find(({ id }) => id === "a").properties.title, "A2");
});

test("a viewport fit hint expires with its revision instead of re-fitting forever", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);

  assert.equal(runtime.execute({
    goal: "show_places",
    collection: "places",
    points: [
      { id: "a", position: { lat: 10, lng: 10 } },
      { id: "b", position: { lat: 11, lng: 11 } }
    ],
    presentation: { viewport: { mode: "fit" } }
  }).ok, true);
  assert.deepEqual(engine.getSnapshot().viewport, { collection: "places", revision: 1, mode: "fit" });

  // A later transaction that asks for no viewport must not resurrect the hint.
  assert.equal(runtime.execute({
    goal: "update_points",
    collection: "places",
    points: [{ id: "a", title: "renamed" }]
  }).ok, true);
  assert.equal(engine.getSnapshot().viewport, undefined);

  // A route planned right after a fit still inherits it inside one transaction.
  const engine2 = createAICommandEngine();
  const runtime2 = createAIAgentRuntime(engine2);
  assert.equal(runtime2.execute({
    goal: "create_visit_route",
    collection: "stops",
    routeId: "tour",
    points: [
      { id: "a", position: { lat: 10, lng: 10 } },
      { id: "b", position: { lat: 11, lng: 11 } }
    ],
    presentation: { viewport: { mode: "fit", padding: 40 } }
  }).ok, true);
  const inherited = engine2.getSnapshot().viewport;
  assert.equal(inherited.revision, engine2.revision);
  assert.equal(inherited.padding, 40);

  // A standalone later route.plan must not revive that expired hint either.
  assert.equal(engine2.execute({
    op: "objects.update",
    collection: "stops",
    objects: [{ type: "Feature", id: "a", geometry: { type: "Point", coordinates: [10, 10] }, properties: {} }]
  }).ok, true);
  assert.equal(engine2.execute({ op: "route.plan", routeId: "tour", collection: "stops" }).ok, true);
  assert.equal(engine2.getSnapshot().viewport, undefined);
});

test("clear resets layers, collections and routes together", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  assert.equal(runtime.execute({
    goal: "create_visit_route",
    collection: "deliveries",
    routeId: "run",
    points: [
      { id: "a", position: { lat: 55.7, lng: 37.6 } },
      { id: "b", position: { lat: 55.75, lng: 37.61 } },
      { id: "c", position: { lat: 55.82, lng: 37.63 } }
    ],
    route: { startId: "a", optimize: "shortest" }
  }).ok, true);
  const before = engine.getSnapshot();
  assert.equal(before.collections.deliveries.length, 3);
  assert.deepEqual(Object.keys(before.routes), ["run"]);

  assert.equal(engine.execute({ op: "clear" }).ok, true);
  const after = engine.getSnapshot();
  assert.deepEqual(after.scene.layers, []);
  assert.deepEqual(after.collections, {});
  assert.equal(after.routes, undefined);
  assert.equal(after.viewport, undefined);
});

test("clearMap names every route it drops so projections cannot orphan polylines", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  for (const [collection, routeId, lat] of [["a", "ra", 1], ["b", "rb", 3]]) {
    assert.equal(runtime.execute({
      goal: "create_visit_route",
      collection,
      routeId,
      points: [
        { id: collection + "1", position: { lat, lng: lat } },
        { id: collection + "2", position: { lat: lat + 1, lng: lat + 1 } }
      ],
      route: { reactive: true }
    }).ok, true);
  }
  assert.deepEqual(Object.keys(engine.getSnapshot().routes).sort(), ["ra", "rb"]);

  const events = [];
  engine.subscribe((event) => events.push(event));
  assert.equal(engine.execute({
    op: "points.replace",
    collection: "a",
    clearMap: true,
    points: [{ id: "z", position: { lat: 9, lng: 9 } }]
  }).ok, true);

  assert.equal(engine.getSnapshot().routes, undefined);
  assert.deepEqual([...events.at(-1).removedRouteIds].sort(), ["ra", "rb"]);
});

test("presentation defaults supply a shared visual image without a shared label", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  assert.equal(runtime.execute({
    goal: "show_places",
    collection: "places",
    points: [
      { id: "a", position: { lat: 1, lng: 2 }, title: "A" },
      { id: "b", position: { lat: 3, lng: 4 }, title: "B", visual: { label: "own" } }
    ],
    presentation: {
      defaults: { visual: { image: { url: "https://cdn.test/marker.png", shape: "circle" }, size: 60 } }
    }
  }).ok, true);

  const [a, b] = engine.getSnapshot().collections.places;
  assert.deepEqual(a.properties.visual, {
    image: { url: "https://cdn.test/marker.png", shape: "circle" },
    size: 60
  });
  // Point-level visuals still win, and absent keys are omitted rather than set to undefined.
  assert.deepEqual(b.properties.visual, {
    image: { url: "https://cdn.test/marker.png", shape: "circle" },
    label: "own",
    size: 60
  });
  assert.equal("collisionMode" in b.properties.visual, false);
});

test("capability steps compile by declared operation, not by payload shape", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  assert.equal(runtime.execute({
    goal: "show_places",
    collection: "places",
    points: [{ id: "a", position: { lat: 1, lng: 2 } }]
  }).ok, true);

  const mislabelled = runtime.commit({
    version: 1,
    id: "manual",
    goal: "show_places",
    baseRevision: engine.revision,
    steps: [{
      id: "s1",
      capability: "orihon.object-manager",
      operation: "replace_points",
      dependsOn: [],
      input: {
        collection: "places",
        objects: [{ type: "Feature", id: "a", geometry: { type: "Point", coordinates: [9, 9] }, properties: {} }]
      }
    }]
  });
  assert.equal(mislabelled.ok, false);
  assert.equal(mislabelled.error.code, "UNKNOWN_PROPERTY");
  assert.deepEqual(engine.getSnapshot().collections.places[0].geometry.coordinates, [2, 1]);
});

test("replaceSnapshot validates restored routes and viewport", () => {
  const engine = createAICommandEngine();
  const base = { version: 1, revision: 3, scene: { version: 1, layers: [] }, collections: {} };

  assert.throws(
    () => engine.replaceSnapshot({ ...base, routes: { bad: "not-a-route" } }),
    (error) => error.code === "INVALID_TYPE" && error.path === "$snapshot.routes.bad"
  );
  assert.throws(
    () => engine.replaceSnapshot({
      ...base,
      routes: { r: { id: "r", collection: "c", waypointIds: ["a"], routes: [], selectedIndex: 4 } }
    }),
    (error) => error.code === "INVALID_VALUE" && error.path === "$snapshot.routes.r.selectedIndex"
  );
  assert.throws(
    () => engine.replaceSnapshot({ ...base, viewport: { mode: "fit", collection: "c", revision: -1 } }),
    (error) => error.code === "INVALID_VALUE" && error.path === "$snapshot.viewport.revision"
  );
  assert.equal(engine.revision, 0, "a rejected snapshot must not mutate live state");

  const valid = createAICommandEngineFromSnapshot({
    ...base,
    routes: {
      r: {
        id: "r",
        collection: "c",
        waypointIds: ["a", "b"],
        routes: [{ coordinates: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], distance: 10 }],
        selectedIndex: 0
      }
    }
  });
  assert.equal(valid.revision, 3);
  assert.equal(createAIAgentRuntime(valid).getContext().routes[0].stops, 2);
});

test("session records keep an unrestricted session unrestricted", () => {
  const open = createAIAgentSession({ id: "open", engine: createAICommandEngine() });
  assert.equal(open.capabilityGroups, null);
  const openRecord = createAISessionRecord(open);
  assert.equal(openRecord.capabilities, undefined);
  assert.equal(restoreAIAgentSession(openRecord).browserCapabilityGroups, null);
  assert.equal(restoreAIAgentSession(openRecord).describeCapabilities().length, 3);

  const locked = createAIAgentSession({
    id: "locked",
    engine: createAICommandEngine(),
    capabilities: ["objects", "viewport"]
  });
  const lockedRecord = createAISessionRecord(locked);
  assert.deepEqual(lockedRecord.capabilities, ["objects", "viewport"]);
  const restored = restoreAIAgentSession(lockedRecord);
  assert.deepEqual(restored.browserCapabilityGroups, ["viewport"]);
  assert.deepEqual(restored.describeCapabilities().map(({ id }) => id), ["orihon.object-manager"]);
});

test("session SSE and snapshot read the session's own engine", async () => {
  const handlerEngine = createAICommandEngine();
  const tenantEngine = createAICommandEngine();
  const sessions = createAIAgentSessionRegistry();
  const handler = createAIHTTPHandler(handlerEngine, {
    sessions,
    createSession: (input) => createAIAgentSession({ ...input, engine: tenantEngine })
  });

  const created = await handler(new Request("http://localhost/api/orihon/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "map:tenant" })
  }));
  assert.equal(created.status, 201);

  assert.equal(tenantEngine.execute({
    op: "points.replace",
    collection: "c",
    points: [{ id: "a", position: { lat: 1, lng: 2 } }]
  }).ok, true);
  assert.equal(tenantEngine.revision, 1);
  assert.equal(handlerEngine.revision, 0);

  const snapshot = await (await handler(new Request("http://localhost/api/orihon/sessions/map%3Atenant/snapshot"))).json();
  assert.equal(snapshot.revision, 1);

  const controller = new AbortController();
  const events = await handler(new Request("http://localhost/api/orihon/sessions/map%3Atenant/events", {
    signal: controller.signal
  }));
  const reader = events.body.getReader();
  const decoder = new TextDecoder();
  let ready = "";
  while (!ready.includes("\n\n")) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    ready += decoder.decode(value, { stream: true });
  }
  const payload = JSON.parse(ready.slice(ready.indexOf("data: ") + 6));
  assert.equal(payload.revision, snapshot.revision, "SSE must start from the session engine revision");
  controller.abort();
});

test("sessionId without a registry is refused instead of answered unscoped", async () => {
  const handler = createAIHTTPHandler(createAICommandEngine());
  const response = await handler(new Request("http://localhost/api/orihon/context?sessionId=map%3Amissing"));
  assert.equal(response.status, 503);

  const sessions = createAIAgentSessionRegistry();
  const scoped = createAIHTTPHandler(createAICommandEngine(), { sessions });
  assert.equal((await scoped(new Request("http://localhost/api/orihon/context?sessionId=nope"))).status, 404);
});

test("agent loop survives tool calls and results that are not JSON values", async () => {
  const adapter = {
    provider: "test",
    model: "test-model",
    complete: async ({ messages }) => (messages.some((entry) => entry.role === "tool")
      ? { content: "done", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } }
      : {
        content: null,
        toolCalls: [{ id: "call-1", name: "noop", arguments: undefined }],
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }
      })
  };
  const agent = createAILLMAgent({
    adapter,
    systemPrompt: "test",
    tools: [{
      definition: { name: "noop", description: "returns nothing", inputSchema: { type: "object" } },
      execute: () => undefined
    }]
  });

  const result = await agent.run("go");
  assert.equal(result.ok, true);
  assert.equal(result.value.message, "done");
  assert.equal(result.value.toolCalls.length, 1);
  assert.equal(result.value.toolCalls[0].result, undefined);
});

test("observeBrowser unwires dragend handlers so re-observing cannot double-report moves", () => {
  const engine = createAICommandEngine();
  const map = createMap(container(), { center: { lat: 55.75, lng: 37.62 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map, { objectManager: { clusterize: false } });
  const session = createAIAgentSession({ id: "map:drag", engine, map, projection });
  assert.equal(session.execute({
    goal: "show_places",
    collection: "stops",
    points: [{ id: "s1", position: { lat: 55.75, lng: 37.62 }, title: "One" }]
  }).ok, true);
  assert.deepEqual(projection.applySnapshot(engine.getSnapshot()), { ok: true, value: { revision: engine.revision, type: "snapshot" } });

  // Headless renderers keep no DOM markers, so stand one in to exercise the
  // per-marker drag path observeBrowser uses without ObjectManager.draggablePoints.
  const manager = projection.getCollectionManager("stops");
  const dom = marker({ lat: 55.75, lng: 37.62 });
  manager.markers.set("s1", dom);

  const moves = [];
  session.subscribeUser((event) => { if (event.type === "objectmove") moves.push(event); });

  let stop;
  for (let round = 0; round < 3; round++) stop = session.observeBrowser({ editable: true, syncEngine: false });
  assert.equal(dom.isDraggable(), true);

  dom.emit("dragend", { latlng: { lat: 55.8, lng: 37.7 } });
  assert.equal(moves.length, 1, "re-observing must not stack dragend listeners");

  stop();
  assert.equal(dom.isDraggable(), false, "stopping observation releases the marker");
  dom.emit("dragend", { latlng: { lat: 55.9, lng: 37.8 } });
  assert.equal(moves.length, 1, "a stopped observation must not keep reporting");

  projection.destroy();
  map.destroy();
});

test("applyObjectMove keeps the map and engine consistent when the engine rejects", () => {
  const map = createMap(container(), { center: { lat: 55.75, lng: 37.61 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map, { objectManager: { clusterize: false } });
  const engine = createAICommandEngine();
  const session = createAIAgentSession({ id: "atomic", engine, map, projection });

  const command = {
    op: "points.replace",
    collection: "stops",
    points: [{ id: "a", position: { lat: 55.75, lng: 37.61 } }]
  };
  assert.equal(engine.execute(command).ok, true);
  assert.equal(projection.applyEvent({ type: "objects", revision: 1, collection: "stops", command }).ok, true);

  const rejected = session.applyObjectMove({ collection: "stops", id: "missing", position: { lat: 1, lng: 2 } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "NOT_FOUND");

  const source = projection.getCollectionSource("stops");
  assert.deepEqual(source.get("a").geometry.coordinates, [37.61, 55.75], "a rejected move must not shift the map");

  const accepted = session.applyObjectMove({ collection: "stops", id: "a", position: { lat: 55.8, lng: 37.7 } });
  assert.equal(accepted.ok, true);
  assert.deepEqual(source.get("a").geometry.coordinates, [37.7, 55.8]);
  assert.deepEqual(engine.getSnapshot().collections.stops[0].geometry.coordinates, [37.7, 55.8]);

  projection.destroy();
  map.destroy();
});

test("recycled marker icons reload only when the source URL actually changes", () => {
  const icon = new Icon({ iconUrl: "./pin.png", iconSize: [32, 32], shape: "circle" });
  const first = icon.createIcon();
  const loads = [];
  Object.defineProperty(first, "src", {
    configurable: true,
    get() { return this.getAttribute("src") ?? ""; },
    set(value) { loads.push(value); this.setAttribute("src", value); }
  });

  icon.createIcon(first);
  assert.deepEqual(loads, [], "a relative URL must not be re-assigned on every render");
  assert.equal(first.classList.contains("oh-marker-icon-circle"), true);

  const other = new Icon({ iconUrl: "./other.png", iconSize: [32, 32], shape: "circle" });
  other.createIcon(first);
  assert.deepEqual(loads, ["./other.png"]);
});

test("projection enables AI styling when visuals come from presentation defaults", () => {
  const map = createMap(container(), { center: { lat: 1, lng: 2 }, zoom: 10, controls: false });
  const projection = createAIMapProjection(map);
  const command = {
    op: "points.replace",
    collection: "places",
    points: [{ id: "a", position: { lat: 1, lng: 2 }, title: "A" }],
    defaults: { visual: { image: { url: "https://cdn.test/marker.png" }, size: 48 } }
  };

  assert.equal(projection.applyEvent({ type: "objects", revision: 1, collection: "places", command }).ok, true);
  const manager = projection.getCollectionManager("places");
  assert.equal(typeof manager.options.style, "function", "defaults-only visuals must still install the AI style resolver");
  const styled = manager.options.style(
    { properties: projection.getCollectionSource("places").get("a").properties },
    {},
    {}
  );
  assert.equal(styled.image.url, "https://cdn.test/marker.png");
  assert.equal(styled.size, 48);

  projection.destroy();
  map.destroy();
});

test("projection drops route layers of every collection a clearMap wipes", () => {
  const engine = createAICommandEngine();
  const runtime = createAIAgentRuntime(engine);
  const map = createMap(container(), { center: { lat: 2, lng: 2 }, zoom: 8, controls: false });
  const projection = createAIMapProjection(map);

  for (const [collection, routeId, lat] of [["a", "ra", 1], ["b", "rb", 3]]) {
    assert.equal(runtime.execute({
      goal: "create_visit_route",
      collection,
      routeId,
      points: [
        { id: collection + "1", position: { lat, lng: lat } },
        { id: collection + "2", position: { lat: lat + 1, lng: lat + 1 } }
      ],
      route: { reactive: true }
    }).ok, true);
  }
  assert.deepEqual(projection.applySnapshot(engine.getSnapshot()), { ok: true, value: { revision: engine.revision, type: "snapshot" } });
  assert.deepEqual([...projection.getRouteNames()].sort(), ["ra", "rb"]);

  const events = [];
  const stop = engine.subscribe((event) => events.push(event));
  assert.equal(engine.execute({
    op: "points.replace",
    collection: "a",
    clearMap: true,
    points: [{ id: "z", position: { lat: 9, lng: 9 } }]
  }).ok, true);
  stop();

  assert.equal(projection.applyEvent(events.at(-1)).ok, true);
  assert.deepEqual(projection.getRouteNames(), [], "clearMap must not leave polylines of other collections behind");
  assert.equal(projection.getCollectionSource("b").getFeatures().length, 0);

  projection.destroy();
  map.destroy();
});
