import type { Marker } from "../layers/marker.js";
import type { Orihon } from "../map.js";
import type { AIAgentRuntime, AIPlanPreviewResult } from "./runtime.js";
import { createAIAgentRuntime } from "./runtime.js";
import type { AICommandEngine } from "./engine.js";
import { AIError, toAIError } from "./errors.js";
import { clone } from "./json.js";
import type { AIMapProjection } from "./projection.js";
import type {
  AIAgentContext,
  AICapabilityDescription,
  AIEngineExecuteOptions,
  AIIntent,
  AIPlan,
  AIPlanExecution,
  AIPosition,
  AIResult
} from "./types.js";
import {
  createAIBrowserBridge,
  isBrowserCapabilityName,
  type AIBrowserBridge,
  type AIBrowserCapabilityDescription,
  type AIBrowserCapabilityGroup
} from "./browser-bridge.js";
import {
  readMapViewport,
  type AIApplyObjectMoveInput,
  type AIMapViewportBounds,
  type AIMapViewportState,
  type AIObserveBrowserOptions,
  type AIUserMapEvent,
  type AIUserMapListener
} from "./session-events.js";
export type {
  AIApplyObjectMoveInput,
  AIMapViewportBounds,
  AIMapViewportState,
  AIObserveBrowserOptions,
  AIUserMapEvent,
  AIUserMapListener
} from "./session-events.js";
export { readMapViewport } from "./session-events.js";

/** Who owns this map agent session. Auth stays outside Orihon. */
export interface AIActor {
  userId?: string;
  roles?: string[];
  [key: string]: unknown;
}

/**
 * Server-side capability groups. Aliases map onto registry ids.
 * Browser groups (`viewport`, `selection`, `popup`, `draw`) are handled by the bridge.
 */
export type AIServerCapabilityGroup = "objects" | "routes" | "visualization";
export type AISessionCapabilityGroup = AIServerCapabilityGroup | AIBrowserCapabilityGroup;

const SERVER_ALIASES: Record<AIServerCapabilityGroup, string> = {
  objects: "orihon.object-manager",
  routes: "orihon.route-model",
  visualization: "orihon.visualization-model"
};

const BROWSER_GROUPS = new Set<AIBrowserCapabilityGroup>(["viewport", "selection", "popup", "draw"]);

const SERVER_CALL_NAMES = new Set([
  "orihon.plan",
  "orihon_plan",
  "intent.execute",
  "orihon.execute_intent"
]);

/** Ephemeral client state — not authoritative, not persisted in this skeleton. */
export interface AILocalMapState {
  /** Live camera: center, zoom, and visible bounds rectangle. */
  viewport?: AIMapViewportState;
  selection?: Array<string | number>;
  openPopupId?: string | number | null;
  hoverId?: string | number | null;
  /** Latest browser→AI event (selection / drag / viewport). */
  lastUserEvent?: AIUserMapEvent;
}

export interface AIAgentSessionOptions {
  /** Stable session key, e.g. `map:123` or `user:582/map:home`. */
  id: string;
  actor?: AIActor;
  engine: AICommandEngine;
  /** Defaults to a runtime bound to `engine`. */
  runtime?: AIAgentRuntime;
  /**
   * Allowed capability groups. Omit to allow every server capability and
   * every built-in browser group. Pass an explicit list to lock the surface.
   */
  capabilities?: readonly AISessionCapabilityGroup[];
  /** When set, browser viewport tools drive this map. */
  map?: Orihon;
  /** When set, selection/popup tools use ObjectManager collections from the projection. */
  projection?: AIMapProjection;
}

export interface AIAgentSessionContext extends AIAgentContext {
  session: {
    id: string;
    actor: AIActor;
    serverCapabilities: string[];
    browserCapabilities: AIBrowserCapabilityGroup[];
    hasMap: boolean;
    hasProjection: boolean;
  };
  local: AILocalMapState;
  browserTools: AIBrowserCapabilityDescription[];
}

function requiredSessionId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AIError("INVALID_TYPE", "$options.id", "Expected a non-empty session id", value);
  }
  const id = value.trim();
  if (id.length > 200) throw new AIError("INVALID_VALUE", "$options.id", "Session id must not exceed 200 characters", id.length);
  return id;
}

function resolveAllowlists(capabilities: readonly AISessionCapabilityGroup[] | undefined): {
  serverIds: Set<string> | null;
  browserGroups: Set<AIBrowserCapabilityGroup> | null;
} {
  if (capabilities === undefined) return { serverIds: null, browserGroups: null };
  const serverIds = new Set<string>();
  const browserGroups = new Set<AIBrowserCapabilityGroup>();
  for (const entry of capabilities) {
    if (entry in SERVER_ALIASES) serverIds.add(SERVER_ALIASES[entry as AIServerCapabilityGroup]);
    else if (BROWSER_GROUPS.has(entry as AIBrowserCapabilityGroup)) browserGroups.add(entry as AIBrowserCapabilityGroup);
    else throw new AIError("INVALID_VALUE", "$options.capabilities", `Unknown capability group "${entry}"`, entry);
  }
  return { serverIds, browserGroups };
}

function readViewportBounds(value: unknown, path: string): AIMapViewportBounds {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AIError("INVALID_TYPE", path, "Expected {south,west,north,east}", value);
  }
  const source = value as Record<string, unknown>;
  for (const key of ["south", "west", "north", "east"] as const) {
    if (typeof source[key] !== "number" || !Number.isFinite(source[key])) {
      throw new AIError("INVALID_TYPE", `${path}.${key}`, "Expected a finite number", source[key]);
    }
  }
  const south = source.south as number;
  const west = source.west as number;
  const north = source.north as number;
  const east = source.east as number;
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    throw new AIError("INVALID_COORDINATE", path, "Latitude bounds must be between -90 and 90", value);
  }
  if (west < -180 || west > 180 || east < -180 || east > 180) {
    throw new AIError("INVALID_COORDINATE", path, "Longitude bounds must be between -180 and 180", value);
  }
  if (south > north) throw new AIError("INVALID_VALUE", path, "Expected south <= north", value);
  return { south, west, north, east };
}

/**
 * First-class agent-native map session: revisioned engine context + local browser
 * state + capability allowlists. Persist with {@link createAISessionRecord} /
 * {@link restoreAIAgentSession}; auth/DB stay outside Orihon.
 *
 * Distinct from {@link AISession}, which applies low-level JSON scenes to a map.
 */
export class AIAgentSession {
  readonly id: string;
  readonly actor: AIActor;
  readonly engine: AICommandEngine;
  readonly runtime: AIAgentRuntime;
  #map: Orihon | undefined;
  #projection: AIMapProjection | undefined;
  readonly #serverIds: Set<string> | null;
  readonly #browserGroups: Set<AIBrowserCapabilityGroup> | null;
  #local: AILocalMapState = {};
  #bridge: AIBrowserBridge | undefined;
  readonly #userListeners = new Set<AIUserMapListener>();
  #observeStop: (() => void) | undefined;

  constructor(options: AIAgentSessionOptions) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("createAIAgentSession(options) requires an options object");
    }
    if (!options.engine || typeof options.engine.execute !== "function") {
      throw new TypeError("createAIAgentSession requires an AICommandEngine");
    }
    this.id = requiredSessionId(options.id);
    this.actor = Object.freeze({ ...(options.actor ?? {}) });
    this.engine = options.engine;
    this.runtime = options.runtime ?? createAIAgentRuntime(options.engine);
    this.#map = options.map;
    this.#projection = options.projection;
    const allow = resolveAllowlists(options.capabilities);
    this.#serverIds = allow.serverIds;
    this.#browserGroups = allow.browserGroups;
  }

  get revision(): number {
    return this.engine.revision;
  }

  get map(): Orihon | undefined {
    return this.#map;
  }

  get projection(): AIMapProjection | undefined {
    return this.#projection;
  }

  get local(): Readonly<AILocalMapState> {
    return this.#local;
  }

  /** Allowed browser capability groups for this session (null = all). */
  get browserCapabilityGroups(): readonly AIBrowserCapabilityGroup[] | null {
    return this.#browserGroups ? [...this.#browserGroups] : null;
  }

  /**
   * The explicit allowlist this session was constructed with, or `null` when it was
   * created unrestricted. Persistence uses this to tell "allow everything" apart from
   * "allow exactly these", so a restore cannot silently narrow the surface.
   */
  get capabilityGroups(): AISessionCapabilityGroup[] | null {
    if (!this.#serverIds && !this.#browserGroups) return null;
    const groups: AISessionCapabilityGroup[] = [];
    for (const [group, id] of Object.entries(SERVER_ALIASES) as Array<[AIServerCapabilityGroup, string]>) {
      if (this.#serverIds?.has(id)) groups.push(group);
    }
    for (const group of this.#browserGroups ?? []) groups.push(group);
    return groups;
  }

  /** Attach or replace the live map used by viewport browser tools. */
  attachMap(map: Orihon | undefined): this {
    this.#map = map;
    return this;
  }

  /** Attach or replace the projection used by selection/popup browser tools. */
  attachProjection(projection: AIMapProjection | undefined): this {
    this.#projection = projection;
    if (projection && !this.#map) this.#map = projection.map;
    return this;
  }

  describeCapabilities(): AICapabilityDescription[] {
    const all = this.runtime.describeCapabilities();
    if (!this.#serverIds) return all;
    return all.filter((capability) => this.#serverIds!.has(capability.id));
  }

  assertServerCapability(capabilityId: string, path = "$capability"): void {
    if (this.#serverIds && !this.#serverIds.has(capabilityId)) {
      throw new AIError("FORBIDDEN", path, `Capability "${capabilityId}" is not enabled for session "${this.id}"`, capabilityId);
    }
  }

  assertBrowserGroup(group: AIBrowserCapabilityGroup, path = "$capability"): void {
    if (this.#browserGroups && !this.#browserGroups.has(group)) {
      throw new AIError("FORBIDDEN", path, `Browser capability "${group}" is not enabled for session "${this.id}"`, group);
    }
  }

  getContext(): AIAgentSessionContext {
    const base = this.runtime.getContext();
    const bridge = this.#bridge;
    const capabilities = this.describeCapabilities();
    return {
      ...base,
      capabilities: capabilities.map(({ id, operations }) => ({
        id,
        operations: operations.map(({ name }) => name)
      })),
      session: {
        id: this.id,
        actor: { ...this.actor },
        serverCapabilities: capabilities.map(({ id }) => id),
        browserCapabilities: this.#browserGroups
          ? [...this.#browserGroups]
          : (["viewport", "selection", "popup", "draw"] as AIBrowserCapabilityGroup[]),
        hasMap: Boolean(this.#map),
        hasProjection: Boolean(this.#projection)
      },
      local: clone(this.#local),
      browserTools: bridge ? bridge.list() : []
    };
  }

  /** Replace or merge ephemeral browser-side state (selection, viewport, …). */
  patchLocal(patch: Partial<AILocalMapState>): AILocalMapState {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new AIError("INVALID_TYPE", "$local", "Expected a local state patch object", patch);
    }
    const next: AILocalMapState = { ...this.#local };
    if ("viewport" in patch) {
      if (patch.viewport === undefined) delete next.viewport;
      else {
        const center = patch.viewport.center;
        if (!center || typeof center.lat !== "number" || typeof center.lng !== "number") {
          throw new AIError("INVALID_TYPE", "$local.viewport.center", "Expected {lat,lng}", center);
        }
        if (typeof patch.viewport.zoom !== "number" || !Number.isFinite(patch.viewport.zoom)) {
          throw new AIError("INVALID_TYPE", "$local.viewport.zoom", "Expected a finite zoom", patch.viewport.zoom);
        }
        const viewport: AIMapViewportState = {
          center: { lat: center.lat, lng: center.lng },
          zoom: patch.viewport.zoom
        };
        if (patch.viewport.bounds !== undefined) {
          viewport.bounds = readViewportBounds(patch.viewport.bounds, "$local.viewport.bounds");
        }
        next.viewport = viewport;
      }
    }
    if ("selection" in patch) {
      if (patch.selection === undefined) delete next.selection;
      else {
        if (!Array.isArray(patch.selection)) throw new AIError("INVALID_TYPE", "$local.selection", "Expected an id array", patch.selection);
        next.selection = [...patch.selection];
      }
    }
    if ("openPopupId" in patch) next.openPopupId = patch.openPopupId ?? null;
    if ("hoverId" in patch) next.hoverId = patch.hoverId ?? null;
    if ("lastUserEvent" in patch) {
      if (patch.lastUserEvent === undefined) delete next.lastUserEvent;
      else next.lastUserEvent = patch.lastUserEvent;
    }
    this.#local = next;
    return clone(this.#local);
  }

  /** Subscribe to browser→AI events (selection, drag/move, viewport). */
  subscribeUser(listener: AIUserMapListener): () => void {
    if (typeof listener !== "function") throw new TypeError("subscribeUser(listener) requires a function");
    this.#userListeners.add(listener);
    return () => { this.#userListeners.delete(listener); };
  }

  /** Emit a user/agent map event into local state and subscribers. */
  emitUser(event: AIUserMapEvent): AIUserMapEvent {
    const full = { ...event, at: event.at ?? Date.now() } as AIUserMapEvent;
    this.patchLocal({ lastUserEvent: full });
    for (const listener of this.#userListeners) {
      try { listener(full); } catch { /* listeners cannot break the session */ }
    }
    return full;
  }

  /**
   * Mirror live projection interactions into this session.
   * Idempotent — replaces any previous observe handle.
   */
  observeBrowser(options: AIObserveBrowserOptions = {}): () => void {
    this.#observeStop?.();
    this.#observeStop = undefined;
    const projection = this.#projection;
    if (!projection) {
      throw new AIError("NOT_FOUND", "$projection", "attachProjection() before observeBrowser()");
    }
    const selection = options.selection !== false;
    const viewport = options.viewport !== false;
    const editable = options.editable === true;
    const syncEngine = options.syncEngine !== false;
    const stops: Array<() => void> = [];

    if (viewport) {
      const map = this.#map ?? projection.map;
      if (map && typeof map.on === "function" && typeof map.getCenter === "function") {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const publishViewport = (): void => {
          const next = readMapViewport(map);
          this.patchLocal({ viewport: next });
          this.emitUser({ type: "viewportchange", viewport: next, source: "user", at: Date.now() });
        };
        const onViewChange = (): void => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(publishViewport, 120);
        };
        map.on("moveend", onViewChange);
        map.on("zoomend", onViewChange);
        publishViewport();
        stops.push(() => {
          if (timer) clearTimeout(timer);
          map.off("moveend", onViewChange);
          map.off("zoomend", onViewChange);
        });
      }
    }

    const wireCollection = (collection: string): void => {
      const manager = projection.getCollectionManager(collection);
      if (!manager) return;
      if (selection) {
        const onClick = (event: { objectId: string | number }) => {
          const ids = [event.objectId];
          this.patchLocal({ selection: ids });
          this.emitUser({ type: "selectionchange", selection: ids, collection, source: "user", at: Date.now() });
        };
        manager.on("click", onClick);
        stops.push(() => { manager.off("click", onClick); });
      }
      if (editable) {
        const onMove = (event: {
          objectId: string | number;
          latlng: { lat: number; lng: number };
          previousLatlng: { lat: number; lng: number };
        }) => {
          void this.applyObjectMove({
            collection,
            id: event.objectId,
            position: { lat: event.latlng.lat, lng: event.latlng.lng },
            previous: { lat: event.previousLatlng.lat, lng: event.previousLatlng.lng },
            syncEngine,
            source: "user"
          });
        };
        if (manager.options.draggablePoints) {
          manager.on("move", onMove);
          stops.push(() => { manager.off("move", onMove); });
        } else {
          // Fallback for managers without draggablePoints: wire each DOM marker once and
          // remember the handles, otherwise every re-observe stacks another dragend
          // listener on the same marker and one drag reports N moves.
          const wired = new Map<object, (event: { latlng?: { lat: number; lng: number } }) => void>();
          const wireMarkers = (): void => {
            for (const [id, marker] of manager.markers) {
              if (wired.has(marker)) continue;
              const onDragEnd = (event: { latlng?: { lat: number; lng: number } }): void => {
                const latlng = event.latlng ?? marker.getLatLng();
                const previousFeature = projection.getCollectionSource(collection)?.get(id);
                const previous = previousFeature?.geometry?.type === "Point"
                  ? {
                      lat: Number(previousFeature.geometry.coordinates[1]),
                      lng: Number(previousFeature.geometry.coordinates[0])
                    }
                  : undefined;
                void this.applyObjectMove({
                  collection,
                  id,
                  position: { lat: latlng.lat, lng: latlng.lng },
                  previous,
                  syncEngine,
                  source: "user"
                });
              };
              wired.set(marker, onDragEnd);
              marker.setDraggable(true);
              marker.on("dragend", onDragEnd);
            }
          };
          wireMarkers();
          const onRender = (): void => { wireMarkers(); };
          manager.on("render", onRender);
          stops.push(() => {
            manager.off("render", onRender);
            for (const [marker, handler] of wired) {
              const target = marker as Marker;
              target.off("dragend", handler);
              target.setDraggable(false);
            }
            wired.clear();
          });
        }
      }
    };

    for (const name of projection.getCollectionNames()) wireCollection(name);
    // Own handle identity: a stale handle from an earlier observe() must not clear the
    // current one, or the live observation becomes impossible to stop.
    const stop = (): void => {
      for (const entry of stops.splice(0)) entry();
      if (this.#observeStop === stop) this.#observeStop = undefined;
    };
    this.#observeStop = stop;
    return stop;
  }

  /**
   * Apply a user/agent point move into the projection source and optionally the engine.
   * Emits `objectmove` so agents can replan from session.local.lastUserEvent.
   */
  applyObjectMove(input: AIApplyObjectMoveInput): AIResult<{
    event: AIUserMapEvent;
    revision?: number;
  }> {
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new AIError("INVALID_TYPE", "$input", "Expected an object-move payload", input);
      }
      const collection = input.collection;
      if (typeof collection !== "string" || collection.trim() === "") {
        throw new AIError("INVALID_TYPE", "$input.collection", "Expected a collection name", collection);
      }
      const id = input.id;
      if (typeof id !== "string" && typeof id !== "number") {
        throw new AIError("INVALID_TYPE", "$input.id", "Expected string or number id", id);
      }
      const position = input.position;
      if (!position || typeof position.lat !== "number" || typeof position.lng !== "number") {
        throw new AIError("INVALID_TYPE", "$input.position", "Expected {lat,lng}", position);
      }
      const syncEngine = input.syncEngine !== false;
      const sourceTag = input.source ?? "user";
      const projection = this.#projection;
      const featureSource = projection?.getCollectionSource(collection);
      const existing = featureSource?.get(id);
      const movable = Boolean(featureSource) && existing?.geometry?.type === "Point";
      // Commit to the engine before touching the map: a rejected update (revision
      // conflict, unknown object) must not leave the marker moved on screen while the
      // authoritative state still holds the old position.
      let revision: number | undefined;
      if (syncEngine) {
        const properties = existing && "properties" in existing ? existing.properties ?? {} : {};
        const executed = this.engine.execute({
          op: "objects.update",
          collection,
          objects: [{
            type: "Feature",
            id,
            geometry: { type: "Point", coordinates: [position.lng, position.lat] },
            properties
          }]
        });
        if (!executed.ok) {
          // Put the marker back where the engine still believes it is.
          if (movable) featureSource!.update({ ...existing! });
          return executed;
        }
        revision = executed.value.revision;
      }
      if (movable) {
        featureSource!.update({
          ...existing!,
          geometry: { type: "Point", coordinates: [position.lng, position.lat] }
        });
      }
      const event = this.emitUser({
        type: "objectmove",
        id,
        collection,
        position: { lat: position.lat, lng: position.lng },
        ...(input.previous ? { previous: input.previous } : {}),
        source: sourceTag,
        ...(revision !== undefined ? { revision } : {}),
        at: Date.now()
      });
      return { ok: true, value: { event, ...(revision !== undefined ? { revision } : {}) } };
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  plan(intent: unknown, options: AIEngineExecuteOptions = {}): AIResult<AIPlan> {
    try {
      const planned = this.runtime.plan(intent, options);
      if (!planned.ok) return planned;
      for (const step of planned.value.steps) this.assertServerCapability(step.capability, `$plan.steps.${step.id}.capability`);
      return planned;
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  preview(plan: AIPlan): AIResult<AIPlanPreviewResult> {
    try {
      for (const step of plan.steps) this.assertServerCapability(step.capability, `$plan.steps.${step.id}.capability`);
      return this.runtime.preview(plan);
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  commit(plan: AIPlan): AIResult<AIPlanExecution> {
    try {
      for (const step of plan.steps) this.assertServerCapability(step.capability, `$plan.steps.${step.id}.capability`);
      return this.runtime.commit(plan);
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  execute(intent: AIIntent | unknown, options: AIEngineExecuteOptions = {}): AIResult<AIPlanExecution> {
    const planned = this.plan(intent, options);
    if (!planned.ok) return planned;
    return this.commit(planned.value);
  }

  /**
   * Single agent entry: browser tools go to the bridge, semantic intents go to the engine.
   * `orihon.plan` / `orihon_plan` / `intent.execute` accept an intent object as input.
   */
  async call(name: string, input: unknown = {}, options: AIEngineExecuteOptions & { signal?: AbortSignal } = {}): Promise<AIResult> {
    try {
      if (typeof name !== "string" || name.trim() === "") {
        throw new AIError("INVALID_TYPE", "$name", "Expected a non-empty capability name", name);
      }
      const tool = name.trim();
      if (isBrowserCapabilityName(tool) || this.#bridge?.has(tool)) {
        return this.connect().call(tool, input, options);
      }
      if (SERVER_CALL_NAMES.has(tool)) {
        return this.execute(input, options);
      }
      if (input && typeof input === "object" && !Array.isArray(input) && "goal" in (input as Record<string, unknown>)) {
        return this.execute(input, options);
      }
      throw new AIError("NOT_FOUND", "$name", `No browser or server capability named "${tool}"`, tool);
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  /**
   * Local in-process bridge for browser capabilities. Idempotent — returns the
   * same bridge instance and installs default tools for allowed groups once.
   */
  connect(): AIBrowserBridge {
    if (this.#bridge) return this.#bridge;
    this.#bridge = createAIBrowserBridge(this);
    this.#bridge.installDefaults();
    return this.#bridge;
  }
}

export function createAIAgentSession(options: AIAgentSessionOptions): AIAgentSession {
  return new AIAgentSession(options);
}
