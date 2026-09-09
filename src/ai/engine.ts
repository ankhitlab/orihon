import { AIError, toAIError } from "./errors.js";
import { clone } from "./json.js";
import type {
  AICommand,
  AICollectionCommand,
  AIEngineCommand,
  AIEngineCommandSuccess,
  AIEngineEvent,
  AIEngineExecuteOptions,
  AIEngineMutationEvent,
  AIEngineSnapshot,
  AIEngineTransactionOptions,
  AIEngineTransactionPreview,
  AIEngineTransactionSuccess,
  AIEngineViewport,
  AIObjectFeature,
  AIPointSpec,
  AIPosition,
  AIResult,
  AIRoutePlanCommand,
  AIRoutePlanState,
  AICameraSpec,
  AISceneSpec
} from "./types.js";
import type { AIAgentContext } from "./types.js";
import {
  validateEngineCommand,
  validateEngineViewport,
  validateObjectCommand,
  validateRoutePlanState
} from "./engine-validation.js";
import { pointCommandFeatures } from "./points.js";
import { planAIRoute } from "./routes.js";
import { validateLayer, validateScene } from "./validation.js";

export interface AICommandEngineInitialState {
  scene?: unknown;
  collections?: Record<string, unknown>;
}

export type AIEngineListener = (event: AIEngineEvent) => void;

export interface AIObjectQueryOptions {
  collection: string;
  /** GeoJSON order: west, south, east, north; west > east crosses the dateline. */
  bbox?: readonly [number, number, number, number];
  where?: Record<string, string | number | boolean | null>;
  search?: string;
  fields?: readonly string[];
  includeGeometry?: boolean;
  limit?: number;
  cursor?: string;
}

export interface AIObjectQueryResult {
  revision: number;
  objects: Array<{ id: string | number; properties?: Record<string, unknown> | null; geometry?: AIObjectFeature["geometry"] }>;
  count: number;
  geometryCounts: Record<string, number>;
  nextCursor?: string;
}

function deepMerge(target: unknown, patch: unknown): unknown {
  if (!target || typeof target !== "object" || Array.isArray(target)
    || !patch || typeof patch !== "object" || Array.isArray(patch)) return clone(patch);
  const result = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    Object.defineProperty(result, key, { value: Object.hasOwn(result, key) ? deepMerge(result[key], value) : clone(value), enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function featureMap(features: readonly AIObjectFeature[]): Map<string | number, AIObjectFeature> {
  return new Map(features.map((feature) => [feature.id, clone(feature)]));
}

const geometryCounts = new WeakMap<Map<string | number, AIObjectFeature>, Map<string, number>>();
function countsFor(objects: Map<string | number, AIObjectFeature>): Map<string, number> {
  let counts = geometryCounts.get(objects);
  if (!counts) {
    counts = new Map();
    for (const object of objects.values()) counts.set(object.geometry.type, (counts.get(object.geometry.type) ?? 0) + 1);
    geometryCounts.set(objects, counts);
  }
  return counts;
}

/** Approximate camera for headless viewport recovery without a live map size. */
export function cameraFromPositions(positions: readonly AIPosition[], paddingHint = 44): AICameraSpec {
  if (positions.length === 0) return { center: { lat: 0, lng: 0 }, zoom: 2 };
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const position of positions) {
    minLat = Math.min(minLat, position.lat);
    maxLat = Math.max(maxLat, position.lat);
    minLng = Math.min(minLng, position.lng);
    maxLng = Math.max(maxLng, position.lng);
  }
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const latSpan = Math.max(maxLat - minLat, 1e-6);
  const lngSpan = Math.max(maxLng - minLng, 1e-6);
  const span = Math.max(latSpan, lngSpan * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  const padFactor = 1 + Math.min(1.5, Math.max(0, paddingHint) / 200);
  const zoom = Math.max(1, Math.min(18, Math.floor(Math.log2(360 / (span * padFactor))) - 1));
  return { center, zoom };
}

function cameraFromPointSpecs(points: readonly AIPointSpec[], padding?: number): AICameraSpec {
  return cameraFromPositions(points.map(({ position }) => position), padding ?? 44);
}

/**
 * Transport-independent, headless command engine.
 *
 * It owns canonical JSON state and emits monotonically revisioned events. HTTP,
 * WebSocket and SSE belong in host adapters, while browser projections subscribe
 * to the same events and render object deltas through FeatureSource/ObjectManager.
 */
export class AICommandEngine {
  #revision = 0;
  #scene: AISceneSpec;
  #viewport?: AIEngineViewport;
  readonly #collections = new Map<string, Map<string | number, AIObjectFeature>>();
  readonly #routes = new Map<string, AIRoutePlanState>();
  readonly #listeners = new Set<AIEngineListener>();

  constructor(initial: AICommandEngineInitialState = {}) {
    this.#scene = initial.scene === undefined
      ? { version: 1, layers: [] }
      : validateScene(initial.scene, "$initial.scene");
    if (initial.collections !== undefined) {
      if (!initial.collections || typeof initial.collections !== "object" || Array.isArray(initial.collections)) {
        throw new AIError("INVALID_TYPE", "$initial.collections", "Expected an object keyed by collection name", initial.collections);
      }
      for (const [collection, objects] of Object.entries(initial.collections)) {
        const command = validateObjectCommand({ op: "objects.replace", collection, objects }, `$initial.collections.${collection}`);
        if (command.op !== "objects.replace") throw new Error("Unexpected validated object command");
        this.#collections.set(collection, featureMap(command.objects));
      }
    }
  }

  get revision(): number { return this.#revision; }

  /** Isolated feature reads; supplying ids avoids copying the rest of the collection. */
  getObjects(collection: string, ids?: readonly (string | number)[]): AIObjectFeature[] | undefined {
    const objects = this.#collections.get(collection);
    if (!objects) return undefined;
    return clone(ids ? ids.flatMap(id => { const value = objects.get(id); return value ? [value] : []; }) : [...objects.values()]);
  }

  /** Headless, bounded object query. Cursor is bound to the revision and query parameters. */
  queryObjects(options: AIObjectQueryOptions): AIObjectQueryResult {
    const objects = this.#collections.get(options.collection);
    if (!objects) throw new AIError("NOT_FOUND", "$query.collection", "Collection does not exist", options.collection);
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new RangeError("limit must be between 1 and 1000");
    const bbox = options.bbox;
    if (bbox && (bbox.length !== 4 || !bbox.every(Number.isFinite) || bbox[1] < -90 || bbox[3] > 90 || bbox[1] > bbox[3] || Math.abs(bbox[0]) > 180 || Math.abs(bbox[2]) > 180)) throw new RangeError("Invalid query bbox");
    if (options.fields && (!Array.isArray(options.fields) || options.fields.length > 64 || options.fields.some(field => typeof field !== "string"))) throw new TypeError("fields must contain at most 64 property names");
    if (options.search !== undefined && (typeof options.search !== "string" || options.search.length > 1000)) throw new TypeError("search must be a string of at most 1000 characters");
    if (options.where && (typeof options.where !== "object" || Array.isArray(options.where) || Object.values(options.where).some(value => value !== null && !["string", "number", "boolean"].includes(typeof value)))) throw new TypeError("where requires scalar property values");
    const signature = JSON.stringify([options.collection, bbox, options.where, options.search, options.fields, options.includeGeometry, limit]);
    let offset = 0;
    if (options.cursor) {
      let cursor: unknown;
      try { cursor = JSON.parse(options.cursor); } catch { throw new TypeError("Invalid query cursor"); }
      const value = cursor as { revision?: number; offset?: number; signature?: string } | null;
      if (!value || value.revision !== this.#revision) throw new AIError("REVISION_CONFLICT", "$query.cursor", "Query cursor has expired");
      if (value.signature !== signature || !Number.isSafeInteger(value.offset) || value.offset! < 0) throw new TypeError("Cursor does not match query");
      offset = value.offset!;
    }
    const results: AIObjectQueryResult["objects"] = [];
    const counts: Record<string, number> = {};
    const search = options.search?.toLocaleLowerCase();
    let count = 0;
    for (const feature of objects.values()) {
      const props = feature.properties ?? {};
      if (options.where && !Object.entries(options.where).every(([key, value]) => Object.hasOwn(props, key) && props[key] === value)) continue;
      if (search && !Object.values(props).some(value => typeof value === "string" && value.toLocaleLowerCase().includes(search))) continue;
      if (bbox) {
        const positions = feature.geometry.type === "Point" ? [feature.geometry.coordinates]
          : feature.geometry.type === "LineString" ? feature.geometry.coordinates : feature.geometry.type === "Polygon" ? feature.geometry.coordinates.flat() : [];
        let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
        for (const [lng, lat] of positions) { west = Math.min(west, lng); east = Math.max(east, lng); south = Math.min(south, lat); north = Math.max(north, lat); }
        if (north < bbox[1] || south > bbox[3] || (bbox[0] <= bbox[2] ? east < bbox[0] || west > bbox[2] : east < bbox[0] && west > bbox[2])) continue;
      }
      counts[feature.geometry.type] = (counts[feature.geometry.type] ?? 0) + 1;
      if (count >= offset && results.length < limit) results.push({ id: feature.id,
        properties: options.fields ? Object.fromEntries(options.fields.filter(key => Object.hasOwn(props, key)).map(key => [key, props[key]])) : feature.properties,
        ...(options.includeGeometry ? { geometry: feature.geometry } : {}) });
      count++;
    }
    return { revision: this.#revision, objects: clone(results), count, geometryCounts: counts,
      ...(offset + results.length < count ? { nextCursor: JSON.stringify({ revision: this.#revision, offset: offset + results.length, signature }) } : {}) };
  }

  subscribe(listener: AIEngineListener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  getSnapshot(): AIEngineSnapshot {
    const collections: Record<string, AIObjectFeature[]> = {};
    for (const [name, objects] of this.#collections) Object.defineProperty(collections, name, { value: [...objects.values()], enumerable: true });
    const routes: Record<string, AIRoutePlanState> = {};
    for (const [id, route] of this.#routes) Object.defineProperty(routes, id, { value: route, enumerable: true });
    return clone({
      version: 1,
      revision: this.#revision,
      scene: this.#scene,
      collections,
      ...(this.#routes.size > 0 ? { routes } : {}),
      ...(this.#viewport?.revision === this.#revision ? { viewport: this.#viewport } : {})
    });
  }

  /** Bounded metadata for agents; never serializes collection geometries. */
  getContextSummary(idLimit = 24): Omit<AIAgentContext, "capabilities"> {
    if (!Number.isSafeInteger(idLimit) || idLimit < 0 || idLimit > 1000) throw new RangeError("idLimit must be between 0 and 1000");
    return {
      version: 1,
      revision: this.#revision,
      scene: { layers: this.#scene.layers.length, hasBasemap: this.#scene.basemap != null, hasCamera: this.#scene.camera !== undefined },
      collections: [...this.#collections].map(([id, objects]) => {
        const ids: Array<string | number> = [];
        for (const key of objects.keys()) { if (ids.length === idLimit) break; ids.push(key); }
        return { ref: { kind: "collection" as const, id, revision: this.#revision }, count: objects.size,
          geometryTypes: [...countsFor(objects)].filter(([, count]) => count > 0).map(([type]) => type as AIObjectFeature["geometry"]["type"]), ids };
      }),
      routes: [...this.#routes.values()].map(route => {
        const selected = route.routes[route.selectedIndex];
        return { id: route.id, ref: { kind: "route" as const, id: route.id, revision: this.#revision }, collection: route.collection,
          stops: route.waypointIds.length, ...(selected?.distance !== undefined ? { distance: selected.distance } : {}),
          ...(selected?.durationMs !== undefined ? { durationMs: selected.durationMs } : {}), reactive: route.request?.reactive === true };
      })
    };
  }

  /**
   * Replace live state from a snapshot without emitting events.
   * Hosts use this for {@link createAICommandEngineFromSnapshot} / session stores.
   */
  replaceSnapshot(snapshot: AIEngineSnapshot): this {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new AIError("INVALID_TYPE", "$snapshot", "Expected an AIEngineSnapshot", snapshot);
    }
    if (snapshot.version !== 1) {
      throw new AIError("INVALID_VALUE", "$snapshot.version", "Expected snapshot version 1", snapshot.version);
    }
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new AIError("INVALID_VALUE", "$snapshot.revision", "Expected a non-negative safe integer", snapshot.revision);
    }
    const scene = validateScene(snapshot.scene, "$snapshot.scene");
    const collections = snapshot.collections ?? {};
    if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
      throw new AIError("INVALID_TYPE", "$snapshot.collections", "Expected an object keyed by collection name", collections);
    }
    const nextCollections = new Map<string, Map<string | number, AIObjectFeature>>();
    for (const [collection, objects] of Object.entries(collections)) {
      const command = validateObjectCommand(
        { op: "objects.replace", collection, objects },
        `$snapshot.collections.${collection}`
      );
      if (command.op !== "objects.replace") throw new Error("Unexpected validated object command");
      nextCollections.set(collection, featureMap(command.objects));
    }
    const nextRoutes = new Map<string, AIRoutePlanState>();
    if (snapshot.routes !== undefined) {
      if (!snapshot.routes || typeof snapshot.routes !== "object" || Array.isArray(snapshot.routes)) {
        throw new AIError("INVALID_TYPE", "$snapshot.routes", "Expected an object keyed by route id", snapshot.routes);
      }
      for (const [id, route] of Object.entries(snapshot.routes)) {
        nextRoutes.set(id, validateRoutePlanState(route, `$snapshot.routes.${id}`));
      }
    }
    const nextViewport = snapshot.viewport === undefined
      ? undefined
      : validateEngineViewport(snapshot.viewport, "$snapshot.viewport");
    this.#scene = scene;
    this.#collections.clear();
    for (const [name, objects] of nextCollections) this.#collections.set(name, objects);
    this.#routes.clear();
    for (const [id, route] of nextRoutes) this.#routes.set(id, route);
    this.#viewport = nextViewport;
    this.#revision = snapshot.revision;
    return this;
  }

  /** Validate an ordered command set against a private fork without mutating live state. */
  previewTransaction(
    commands: readonly unknown[],
    options: AIEngineExecuteOptions = {}
  ): AIResult<AIEngineTransactionPreview> {
    try {
      this.#assertBaseRevision(options.baseRevision);
      const { engine: staged } = this.#stageCommands(commands);
      const revision = this.#revision + 1;
      staged.#revision = revision;
      if (staged.#viewport) staged.#viewport.revision = revision;
      return {
        ok: true,
        value: {
          revision,
          commands: commands.map((command) => validateEngineCommand(command)),
          snapshot: staged.getSnapshot()
        }
      };
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  /** Atomically commit a plan as one revision and one projection event. */
  executeTransaction(
    commands: readonly unknown[],
    options: AIEngineTransactionOptions = {}
  ): AIResult<AIEngineTransactionSuccess> {
    try {
      this.#assertBaseRevision(options.baseRevision);
      const baseRevision = this.#revision;
      const { engine: staged, events } = this.#stageCommands(commands);
      const normalized = commands.map((command) => validateEngineCommand(command));
      const revision = baseRevision + 1;
      this.#scene = clone(staged.#scene);
      this.#collections.clear();
      for (const [name, objects] of staged.#collections) this.#collections.set(name, objects);
      this.#routes.clear();
      for (const [id, route] of staged.#routes) this.#routes.set(id, clone(route));
      // A viewport hint expires with the revision that produced it. The fork numbers
      // revisions per staged command, so only a hint stamped above the base revision was
      // actually produced by this transaction; anything older is carried over untouched
      // so getSnapshot() keeps dropping it instead of re-fitting the camera forever.
      this.#viewport = staged.#viewport
        ? (staged.#viewport.revision > baseRevision
          ? { ...clone(staged.#viewport), revision }
          : clone(staged.#viewport))
        : undefined;
      this.#revision = revision;
      // Capture an immutable fork so the lazy compatibility snapshot retains this revision.
      const snapshotState = this.#fork();
      let snapshot: AIEngineSnapshot | undefined;
      const event = {
        type: "transaction" as const,
        revision,
        transactionId: options.transactionId ?? `transaction-${revision}`,
        operation: options.operation ?? "plan.commit",
        commands: normalized,
        events
      };
      for (const listener of this.#listeners) {
        try { listener(clone(event)); } catch { /* listeners cannot roll back an accepted transaction */ }
      }
      return { ok: true, value: { op: "transaction", revision, event: clone(event),
        get snapshot() { return snapshot ??= snapshotState.getSnapshot(); } } };
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  /** Validate and atomically execute an untrusted JSON command. */
  execute(input: unknown, options: AIEngineExecuteOptions = {}): AIResult<AIEngineCommandSuccess> {
    try {
      this.#assertBaseRevision(options.baseRevision);
      const command = validateEngineCommand(input);
      if (command.op === "query") {
        const snapshot = this.getSnapshot();
        if (command.ids !== undefined) {
          const byId = new Map(snapshot.scene.layers.map((layer) => [layer.id, layer]));
          snapshot.scene.layers = command.ids.map((id) => {
            const layer = byId.get(id);
            if (!layer) throw new AIError("NOT_FOUND", "$command.ids", `No AI layer has ID "${id}"`, id);
            return layer;
          });
        }
        return { ok: true, value: { op: command.op, revision: this.#revision, snapshot } };
      }
      const event = command.op === "route.plan"
        ? this.#executeRouteCommand(command)
        : command.op.startsWith("objects.") || command.op === "points.replace"
          ? this.#executeCollectionCommand(command as AICollectionCommand)
          : this.#executeSceneCommand(command as Exclude<AICommand, { op: "query" }>);
      for (const listener of this.#listeners) {
        try { listener(clone(event)); } catch { /* listeners cannot roll back an accepted command */ }
      }
      const value: AIEngineCommandSuccess = { op: command.op, revision: this.#revision, event: clone(event) };
      if (event.type === "route") {
        const selected = event.route.routes[event.route.selectedIndex];
        value.route = {
          id: event.route.id,
          stops: event.route.waypointIds.length,
          ...(selected?.distance !== undefined ? { distance: selected.distance } : {}),
          ...(selected?.durationMs !== undefined ? { durationMs: selected.durationMs } : {})
        };
      }
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  #executeSceneCommand(command: Exclude<AICommand, { op: "query" }>): AIEngineEvent {
    const next = clone(this.#scene);
    let clearedCollections = false;
    if (command.op === "set_view") next.camera = { center: clone(command.center), zoom: command.zoom };
    else if (command.op === "fly_to") {
      next.camera = { center: clone(command.center), zoom: command.zoom ?? next.camera?.zoom ?? 0 };
    } else if (command.op === "add") {
      if (next.layers.some(({ id }) => id === command.id)) {
        throw new AIError("DUPLICATE_ID", "$command.id", `AI layer "${command.id}" already exists`, command.id);
      }
      next.layers.push(validateLayer({ id: command.id, ...command.layer }, "$command.layer"));
    } else if (command.op === "update") {
      const index = next.layers.findIndex(({ id }) => id === command.id);
      if (index < 0) throw new AIError("NOT_FOUND", "$command.id", `No AI layer has ID "${command.id}"`, command.id);
      next.layers[index] = validateLayer(deepMerge(next.layers[index], command.patch), "$command.patch");
    } else if (command.op === "remove") {
      const index = next.layers.findIndex(({ id }) => id === command.id);
      if (index < 0) throw new AIError("NOT_FOUND", "$command.id", `No AI layer has ID "${command.id}"`, command.id);
      next.layers.splice(index, 1);
    } else if (command.op === "clear") {
      if (command.ids === undefined) {
        // A full clear resets the whole AI-owned map, the same surface
        // points.replace{clearMap:true} resets: scene layers, collections and routes.
        // Leaving collections behind would keep markers carrying routeId/visitOrder
        // annotations written by routes that no longer exist.
        next.layers = [];
        clearedCollections = true;
      }
      else {
        const selected = new Set(command.ids);
        for (const id of selected) {
          if (!next.layers.some((layer) => layer.id === id)) throw new AIError("NOT_FOUND", "$command.ids", `No AI layer has ID "${id}"`, id);
        }
        next.layers = next.layers.filter(({ id }) => !selected.has(id));
      }
    } else if (command.op === "fit") {
      const ids = command.ids ?? next.layers.map(({ id }) => id);
      if (ids.length === 0) throw new AIError("EMPTY_SELECTION", "$command.ids", "No layers are available to fit", ids);
      for (const id of ids) {
        if (!next.layers.some((layer) => layer.id === id)) throw new AIError("NOT_FOUND", "$command.ids", `No AI layer has ID "${id}"`, id);
      }
      // Fit is viewport-dependent, so it is intentionally an event-only command.
    } else {
      next.layers = clone(command.scene.layers);
      if (command.scene.camera !== undefined) next.camera = clone(command.scene.camera);
      if (command.scene.basemap !== undefined) next.basemap = clone(command.scene.basemap);
    }
    this.#scene = validateScene(next);
    if (clearedCollections) {
      this.#collections.clear();
      this.#routes.clear();
      this.#viewport = undefined;
    }
    this.#revision++;
    return { type: "scene", revision: this.#revision, command: clone(command) };
  }

  #executeCollectionCommand(command: AICollectionCommand): AIEngineEvent {
    const replaceMap = command.op === "points.replace" && command.clearMap === true;
    // clearMap drops every route, including those owned by other collections, so the
    // event has to name them all or projections keep drawing orphaned polylines.
    const clearedRouteIds = replaceMap ? [...this.#routes.keys()] : [];
    const affectedRoutes = replaceMap
      ? []
      : [...this.#routes.values()].filter((route) => route.collection === command.collection).map(clone);
    const current = replaceMap || command.op === "points.replace" || command.op === "objects.replace" || command.op === "objects.clear"
      ? undefined : this.#collections.get(command.collection);
    // Internal features are never mutated; staging copies only the map and changed features.
    const next = new Map(current);
    const counts = new Map(current ? countsFor(current) : []);
    const countFeature = (object: AIObjectFeature, delta: number): void => {
      counts.set(object.geometry.type, (counts.get(object.geometry.type) ?? 0) + delta);
    };

    const add = (objects: readonly AIObjectFeature[], path: string): void => {
      for (const object of objects) {
        if (next.has(object.id)) throw new AIError("DUPLICATE_ID", path, `Object "${String(object.id)}" already exists`, object.id);
        next.set(object.id, clone(object));
        countFeature(object, 1);
      }
    };
    const update = (objects: readonly AIObjectFeature[], path: string): void => {
      for (const object of objects) {
        if (!next.has(object.id)) throw new AIError("NOT_FOUND", path, `Object "${String(object.id)}" does not exist`, object.id);
        countFeature(next.get(object.id)!, -1);
        next.set(object.id, clone(object));
        countFeature(object, 1);
      }
    };
    const remove = (ids: readonly (string | number)[], path: string): void => {
      for (const id of ids) {
        if (!next.has(id)) throw new AIError("NOT_FOUND", path, `Object "${String(id)}" does not exist`, id);
        countFeature(next.get(id)!, -1);
        next.delete(id);
      }
    };

    if (command.op === "points.replace") {
      add(pointCommandFeatures(command), "$command.points");
    } else if (command.op === "objects.add") add(command.objects, "$command.objects");
    else if (command.op === "objects.update") update(command.objects, "$command.objects");
    else if (command.op === "objects.remove") remove(command.ids, "$command.ids");
    else if (command.op === "objects.replace") {
      next.clear();
      add(command.objects, "$command.objects");
    } else if (command.op === "objects.clear") next.clear();
    else {
      command.changes.forEach((change, index) => {
        if (change.type === "add") add(change.objects, `$command.changes[${index}].objects`);
        else if (change.type === "update") update(change.objects, `$command.changes[${index}].objects`);
        else remove(change.ids, `$command.changes[${index}].ids`);
      });
    }

    if (replaceMap) {
      const scene = clone(this.#scene);
      scene.layers = [];
      this.#scene = validateScene(scene);
      this.#collections.clear();
      this.#routes.clear();
    }
    const invalidatedRouteIds = new Set([...clearedRouteIds, ...affectedRoutes.map(({ id }) => id)]);
    for (const routeId of invalidatedRouteIds) this.#routes.delete(routeId);
    if (invalidatedRouteIds.size > 0) {
      for (const [id, feature] of next) {
        const properties = feature.properties ?? {};
        if (typeof properties.routeId !== "string" || !invalidatedRouteIds.has(properties.routeId)) continue;
        const cleaned = { ...properties };
        delete cleaned.routeId;
        delete cleaned.visitOrder;
        next.set(id, { ...feature, properties: cleaned });
      }
    }
    const replannedRoutes: AIRoutePlanState[] = [];
    for (const previous of affectedRoutes) {
      if (previous.request?.reactive !== true) continue;
      const availableIds = new Set(next.keys());
      const request = clone(previous.request);
      if (request.ids) request.ids = request.ids.filter((id) => availableIds.has(id));
      if (request.startId !== undefined && !availableIds.has(request.startId)) delete request.startId;
      if (request.endId !== undefined && !availableIds.has(request.endId)) delete request.endId;
      try {
        const planned = planAIRoute(request, [...next.values()]);
        next.clear();
        for (const [id, feature] of featureMap(planned.objects)) next.set(id, feature);
        this.#routes.set(previous.id, clone(planned.state));
        replannedRoutes.push(clone(planned.state));
        invalidatedRouteIds.delete(previous.id);
      } catch {
        // A collection mutation remains valid even when fewer than two usable stops remain.
      }
    }
    this.#collections.set(command.collection, next);
    if (!replannedRoutes.length) geometryCounts.set(next, counts);
    this.#revision++;
    if (command.op === "points.replace" && command.viewport) {
      this.#viewport = {
        collection: command.collection,
        revision: this.#revision,
        ...clone(command.viewport)
      };
      const scene = clone(this.#scene);
      scene.camera = cameraFromPointSpecs(command.points, command.viewport.padding);
      this.#scene = validateScene(scene);
    }
    return {
      type: "objects",
      revision: this.#revision,
      collection: command.collection,
      command: clone(command),
      ...(replannedRoutes.length > 0 ? { routes: replannedRoutes } : {}),
      ...(invalidatedRouteIds.size > 0 ? { removedRouteIds: [...invalidatedRouteIds] } : {})
    };
  }

  #executeRouteCommand(command: AIRoutePlanCommand): AIEngineEvent {
    const collection = this.#collections.get(command.collection);
    if (!collection) {
      throw new AIError("NOT_FOUND", "$command.collection", `Collection "${command.collection}" does not exist`, command.collection);
    }
    const planned = planAIRoute(command, [...collection.values()]);
    // Carry a viewport hint forward only while it is still live (set by the current
    // revision, e.g. points.replace + fit immediately before this plan). Reviving an
    // expired hint would re-fit the camera long after the user panned away.
    const inheritedViewport = this.#viewport?.collection === command.collection
      && this.#viewport.revision === this.#revision
      ? clone(this.#viewport)
      : undefined;
    this.#collections.set(command.collection, featureMap(planned.objects));
    this.#routes.set(command.routeId, clone(planned.state));
    this.#revision++;
    if (inheritedViewport) this.#viewport = { ...inheritedViewport, revision: this.#revision };
    return { type: "route", revision: this.#revision, route: clone(planned.state), command: clone(command) };
  }

  #assertBaseRevision(baseRevision: number | undefined): void {
    if (baseRevision === undefined) return;
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new AIError("INVALID_VALUE", "$options.baseRevision", "baseRevision must be a non-negative safe integer", baseRevision);
    }
    if (baseRevision !== this.#revision) {
      throw new AIError(
        "REVISION_CONFLICT",
        "$options.baseRevision",
        `Expected revision ${baseRevision}, current revision is ${this.#revision}`,
        baseRevision
      );
    }
  }

  #fork(): AICommandEngine {
    const staged = new AICommandEngine();
    staged.#revision = this.#revision;
    staged.#scene = clone(this.#scene);
    staged.#viewport = this.#viewport ? clone(this.#viewport) : undefined;
    for (const [name, objects] of this.#collections) staged.#collections.set(name, objects);
    for (const [id, route] of this.#routes) staged.#routes.set(id, clone(route));
    return staged;
  }

  #stageCommands(commands: readonly unknown[]): { engine: AICommandEngine; events: AIEngineMutationEvent[] } {
    if (!Array.isArray(commands) || commands.length === 0) {
      throw new AIError("EMPTY_SELECTION", "$commands", "A transaction requires at least one command", commands);
    }
    const staged = this.#fork();
    const events: AIEngineMutationEvent[] = [];
    for (let index = 0; index < commands.length; index++) {
      const result = staged.execute(commands[index]);
      if (!result.ok) {
        throw new AIError(result.error.code, `$commands[${index}]${result.error.path.replace(/^\$command/, "")}`, result.error.message, result.error.received);
      }
      if (result.value.event && result.value.event.type !== "transaction") events.push(result.value.event);
    }
    return { engine: staged, events };
  }
}

export function createAICommandEngine(initial?: AICommandEngineInitialState): AICommandEngine {
  return new AICommandEngine(initial);
}

/** Rebuild an engine from a revisioned snapshot (no events). */
export function createAICommandEngineFromSnapshot(snapshot: AIEngineSnapshot): AICommandEngine {
  const engine = createAICommandEngine();
  engine.replaceSnapshot(snapshot);
  return engine;
}
