import { AIError, toAIError } from "./errors.js";
import type { AIAgentSession } from "./agent-session.js";
import type { AIMapProjection } from "./projection.js";
import type { AIJSONSchema } from "./schema.js";
import { readMapViewport } from "./session-events.js";
import type { AIPosition, AIResult } from "./types.js";
import type { ObjectManager } from "../services/object-manager.js";

export type AIBrowserCapabilityGroup = "viewport" | "selection" | "popup" | "draw";

export interface AIBrowserCapabilityDescription {
  name: string;
  group: AIBrowserCapabilityGroup;
  description?: string;
  inputSchema?: AIJSONSchema;
}

export interface AIBrowserCapabilityHandlerContext {
  session: AIAgentSession;
  signal?: AbortSignal;
}

export interface AIBrowserCapability {
  name: string;
  group: AIBrowserCapabilityGroup;
  description?: string;
  inputSchema?: AIJSONSchema;
  handler: (input: unknown, context: AIBrowserCapabilityHandlerContext) => unknown | Promise<unknown>;
}

export function isBrowserCapabilityName(name: string): boolean {
  return groupOf(name) !== undefined;
}

function groupOf(name: string): AIBrowserCapabilityGroup | undefined {
  if (name.startsWith("map.viewport") || name === "map.get_viewport" || name === "map.set_viewport") return "viewport";
  if (name.startsWith("map.selection") || name === "map.get_selection" || name === "map.set_selection") return "selection";
  if (name.startsWith("map.popup") || name === "map.open_popup" || name === "map.close_popup") return "popup";
  if (name.startsWith("map.draw")) return "draw";
  return undefined;
}

function readCenter(value: unknown, path: string): AIPosition {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AIError("INVALID_TYPE", path, "Expected {lat,lng}", value);
  }
  const source = value as Record<string, unknown>;
  if (typeof source.lat !== "number" || !Number.isFinite(source.lat)) {
    throw new AIError("INVALID_TYPE", `${path}.lat`, "Expected a finite latitude", source.lat);
  }
  if (typeof source.lng !== "number" || !Number.isFinite(source.lng)) {
    throw new AIError("INVALID_TYPE", `${path}.lng`, "Expected a finite longitude", source.lng);
  }
  if (source.lat < -90 || source.lat > 90) throw new AIError("INVALID_COORDINATE", `${path}.lat`, "Latitude must be between -90 and 90", source.lat);
  if (source.lng < -180 || source.lng > 180) throw new AIError("INVALID_COORDINATE", `${path}.lng`, "Longitude must be between -180 and 180", source.lng);
  return { lat: source.lat, lng: source.lng };
}

function findObjectManager(
  projection: AIMapProjection,
  id: string | number,
  collection?: string
): { collection: string; manager: ObjectManager } {
  if (collection) {
    const manager = projection.getCollectionManager(collection);
    if (!manager) throw new AIError("NOT_FOUND", "$input.collection", `Collection "${collection}" is not projected`, collection);
    if (!manager.getObject(id)) throw new AIError("NOT_FOUND", "$input.id", `Object "${String(id)}" is not in "${collection}"`, id);
    return { collection, manager };
  }
  for (const name of projection.getCollectionNames()) {
    const manager = projection.getCollectionManager(name);
    if (manager?.getObject(id)) return { collection: name, manager };
  }
  throw new AIError("NOT_FOUND", "$input.id", `Object "${String(id)}" is not on the projected map`, id);
}

/**
 * In-process browser capability bridge. Host apps register handlers that close
 * over map UI state; agents call them by name. Transports wrap {@link call}
 * via {@link installAIWebMCPTools} / {@link createAIAGUIAdapter}.
 */
export class AIBrowserBridge {
  readonly session: AIAgentSession;
  readonly #capabilities = new Map<string, AIBrowserCapability>();
  #defaultsInstalled = false;

  constructor(session: AIAgentSession) {
    if (!session || typeof session.connect !== "function") {
      throw new TypeError("createAIBrowserBridge(session) requires an AIAgentSession");
    }
    this.session = session;
  }

  list(): AIBrowserCapabilityDescription[] {
    return [...this.#capabilities.values()].map(({ name, group, description, inputSchema }) => ({
      name,
      group,
      ...(description ? { description } : {}),
      ...(inputSchema ? { inputSchema } : {})
    }));
  }

  has(name: string): boolean {
    return this.#capabilities.has(name.trim());
  }

  /** Register or replace a browser-side tool. */
  expose(capability: AIBrowserCapability): this {
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
      throw new AIError("INVALID_TYPE", "$capability", "Expected a browser capability object", capability);
    }
    if (typeof capability.name !== "string" || capability.name.trim() === "") {
      throw new AIError("INVALID_TYPE", "$capability.name", "Expected a non-empty capability name", capability.name);
    }
    if (typeof capability.handler !== "function") {
      throw new AIError("INVALID_TYPE", "$capability.handler", "Expected a handler function", capability.handler);
    }
    const group = capability.group ?? groupOf(capability.name);
    if (!group) {
      throw new AIError("INVALID_VALUE", "$capability.group", "Expected viewport, selection, popup or draw", capability.group);
    }
    this.session.assertBrowserGroup(group, "$capability.group");
    const name = capability.name.trim();
    this.#capabilities.set(name, {
      name,
      group,
      handler: capability.handler,
      ...(capability.description ? { description: capability.description } : {}),
      ...(capability.inputSchema ? { inputSchema: capability.inputSchema } : {})
    });
    return this;
  }

  async call(name: string, input: unknown = {}, options: { signal?: AbortSignal } = {}): Promise<AIResult> {
    try {
      if (typeof name !== "string" || name.trim() === "") {
        throw new AIError("INVALID_TYPE", "$name", "Expected a non-empty capability name", name);
      }
      const capability = this.#capabilities.get(name.trim());
      if (!capability) throw new AIError("NOT_FOUND", "$name", `Browser capability "${name}" is not registered`, name);
      this.session.assertBrowserGroup(capability.group, "$name");
      const value = await capability.handler(input, { session: this.session, signal: options.signal });
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  /**
   * Install default browser tools. With `session.map` / `session.projection`
   * they drive the live map; otherwise they only update {@link AIAgentSession.local}.
   */
  installDefaults(): this {
    if (this.#defaultsInstalled) return this;
    this.#defaultsInstalled = true;
    const groups = this.session.browserCapabilityGroups;
    const allow = (group: AIBrowserCapabilityGroup) => !groups || groups.includes(group);

    if (allow("viewport")) {
      this.expose({
        name: "map.get_viewport",
        group: "viewport",
        description: "Return the live map viewport when attached, otherwise the local snapshot.",
        handler: (_input, { session }) => {
          const map = session.map;
          if (map) {
            const viewport = readMapViewport(map);
            session.patchLocal({ viewport });
            return viewport;
          }
          return session.local.viewport ?? null;
        }
      });
      this.expose({
        name: "map.set_viewport",
        group: "viewport",
        description: "Move the attached map camera (setView or flyTo) and sync local viewport state.",
        inputSchema: {
          type: "object",
          required: ["center", "zoom"],
          additionalProperties: false,
          properties: {
            center: { type: "object", required: ["lat", "lng"], properties: { lat: { type: "number" }, lng: { type: "number" } } },
            zoom: { type: "number" },
            animation: { enum: ["none", "fly"] },
            durationMs: { type: "number", minimum: 0 }
          }
        },
        handler: (input, { session }) => {
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new AIError("INVALID_TYPE", "$input", "Expected {center,zoom}", input);
          }
          const source = input as Record<string, unknown>;
          const center = readCenter(source.center, "$input.center");
          if (typeof source.zoom !== "number" || !Number.isFinite(source.zoom)) {
            throw new AIError("INVALID_TYPE", "$input.zoom", "Expected a finite zoom", source.zoom);
          }
          const map = session.map;
          if (map) {
            if (source.animation === "fly") {
              map.flyTo(center, source.zoom, typeof source.durationMs === "number" ? { durationMs: source.durationMs } : {});
            } else {
              map.setView(center, source.zoom);
            }
            return session.patchLocal({ viewport: readMapViewport(map) }).viewport;
          }
          return session.patchLocal({ viewport: { center, zoom: source.zoom } }).viewport;
        }
      });
    }

    if (allow("selection")) {
      this.expose({
        name: "map.get_selection",
        group: "selection",
        description: "Return selected object ids (ObjectManager is single-select; local may keep a list).",
        handler: (_input, { session }) => {
          const projection = session.projection;
          if (projection) {
            for (const name of projection.getCollectionNames()) {
              const selected = projection.getCollectionManager(name)?.getSelectedId();
              if (selected != null) {
                const ids = [selected];
                session.patchLocal({ selection: ids });
                return ids;
              }
            }
          }
          return session.local.selection ?? [];
        }
      });
      this.expose({
        name: "map.set_selection",
        group: "selection",
        description: "Select object ids. With a projection, the first id is applied to ObjectManager; empty clears.",
        inputSchema: {
          type: "object",
          required: ["ids"],
          additionalProperties: false,
          properties: {
            ids: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
            collection: { type: "string" }
          }
        },
        handler: (input, { session }) => {
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new AIError("INVALID_TYPE", "$input", "Expected {ids}", input);
          }
          const source = input as Record<string, unknown>;
          if (!Array.isArray(source.ids)) throw new AIError("INVALID_TYPE", "$input.ids", "Expected an id array", source.ids);
          const ids = source.ids as Array<string | number>;
          const collection = typeof source.collection === "string" ? source.collection : undefined;
          const projection = session.projection;
          if (projection) {
            for (const name of projection.getCollectionNames()) {
              projection.getCollectionManager(name)?.setSelected(null);
            }
            if (ids.length) {
              const found = findObjectManager(projection, ids[0], collection);
              found.manager.setSelected(ids[0]);
            }
          }
          return session.patchLocal({ selection: ids }).selection;
        }
      });
    }

    if (allow("popup")) {
      this.expose({
        name: "map.open_popup",
        group: "popup",
        description: "Open an ObjectManager popup for an id when a projection is attached.",
        inputSchema: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: {
            id: { oneOf: [{ type: "string" }, { type: "number" }] },
            collection: { type: "string" }
          }
        },
        handler: (input, { session }) => {
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new AIError("INVALID_TYPE", "$input", "Expected {id}", input);
          }
          const source = input as Record<string, unknown>;
          const id = source.id;
          if (typeof id !== "string" && typeof id !== "number") {
            throw new AIError("INVALID_TYPE", "$input.id", "Expected string or number id", id);
          }
          const collection = typeof source.collection === "string" ? source.collection : undefined;
          const projection = session.projection;
          if (projection) {
            const found = findObjectManager(projection, id, collection);
            found.manager.openPopup(id);
          }
          return session.patchLocal({ openPopupId: id }).openPopupId;
        }
      });
      this.expose({
        name: "map.close_popup",
        group: "popup",
        description: "Close open ObjectManager popups on the projection and clear local openPopupId.",
        handler: (_input, { session }) => {
          const projection = session.projection;
          if (projection) {
            for (const name of projection.getCollectionNames()) {
              projection.getCollectionManager(name)?.closePopup();
            }
          }
          return session.patchLocal({ openPopupId: null }).openPopupId;
        }
      });
    }

    if (allow("draw")) {
      this.expose({
        name: "map.draw_get_mode",
        group: "draw",
        description: "Drawing mode stub — always returns null until draw is wired.",
        handler: () => null
      });
    }

    return this;
  }
}

export function createAIBrowserBridge(session: AIAgentSession): AIBrowserBridge {
  return new AIBrowserBridge(session);
}
