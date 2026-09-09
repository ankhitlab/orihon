import { featureSource, type FeatureSource } from "../feature-source.js";
import { LatLngBounds } from "../geo.js";
import type { IdentifiedGeoJSONFeature } from "../geojson-types.js";
import type { Orihon } from "../map.js";
import { popupContent } from "../popup-content.js";
import {
  objectManager,
  type ManagedObject,
  type ObjectManager,
  type ObjectManagerOptions,
  type ObjectStyle,
  type ObjectStyleResolver
} from "../services/object-manager.js";
import { createStraightLineRoutingProvider, routingLayer, type RoutingLayer } from "../services/routing.js";
import { AIError, toAIError } from "./errors.js";
import { AISession } from "./session.js";
import { pointCommandFeatures } from "./points.js";
import type {
  AIEngineEvent,
  AIEngineSnapshot,
  AIEngineViewport,
  AIObjectFeature,
  AIRoutePlanState,
  AIPointsReplaceCommand,
  AIPointViewport,
  AIResult
} from "./types.js";

export interface AIMapProjectionOptions {
  /** Defaults applied to each lazily created ObjectManager collection. */
  objectManager?: Omit<ObjectManagerOptions, "source">;
  /** Per-collection override for style, clustering and rendering policy. */
  collectionOptions?: (collection: string) => Omit<ObjectManagerOptions, "source"> | undefined;
  /** Bind safe text or declarative text/image popups from object properties. Default true. */
  objectPopups?: boolean;
}

export interface AIProjectionSuccess {
  revision: number;
  type: "snapshot" | AIEngineEvent["type"];
}

interface CollectionProjection {
  source: FeatureSource<IdentifiedGeoJSONFeature>;
  manager: ObjectManager;
  aiStyleEnabled: boolean;
  consumerStyle: ObjectStyleResolver | null;
}

interface RouteProjection {
  collection: string;
  layer: RoutingLayer;
}

function safeVisualImageURL(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f\\]/.test(url)) return null;
  if ((url.startsWith("/") && !url.startsWith("//")) || url.startsWith("./") || url.startsWith("../")) return url;
  try { return new URL(url).protocol === "https:" ? url : null; } catch { return null; }
}

function aiPointObjectStyle(object: ManagedObject): ObjectStyle | undefined {
  const visual = object.properties?.visual;
  if (!visual || typeof visual !== "object" || Array.isArray(visual)) return undefined;
  const spec = visual as Record<string, unknown>;
  const title = typeof object.properties?.title === "string" ? object.properties.title : "";
  const rawImage = spec.image;
  const hasImageSpec = Boolean(rawImage && typeof rawImage === "object" && !Array.isArray(rawImage));
  const size = typeof spec.size === "number" && Number.isFinite(spec.size)
    ? Math.max(8, Math.min(256, spec.size))
    : hasImageSpec ? 52 : 14;
  const result: ObjectStyle = { size };
  if (rawImage && typeof rawImage === "object" && !Array.isArray(rawImage)) {
    const image = rawImage as Record<string, unknown>;
    const url = safeVisualImageURL(image.url);
    if (url) {
      result.image = {
        url,
        alt: typeof image.alt === "string" ? image.alt : title,
        shape: image.shape === "rectangle" ? "rectangle" : "circle",
        fit: image.fit === "contain" || image.fit === "fill" ? image.fit : "cover",
        borderColor: typeof image.borderColor === "string" ? image.borderColor : "#ffffff",
        borderWidth: typeof image.borderWidth === "number" ? image.borderWidth : 3
      };
      // Photo markers should stay visible under declutter unless the intent opts out.
      if (spec.collisionMode === undefined) result.collisionMode = "always";
    }
  }
  const rawLabel = spec.label;
  if (typeof rawLabel === "string") result.label = { text: rawLabel, display: "hover" };
  else if (rawLabel && typeof rawLabel === "object" && !Array.isArray(rawLabel)) {
    const label = rawLabel as Record<string, unknown>;
    const text = typeof label.text === "string" ? label.text : title;
    if (text) {
      const offset = label.offset && typeof label.offset === "object" && !Array.isArray(label.offset)
        ? label.offset as Record<string, unknown>
        : null;
      result.label = {
        text,
        display: label.display === "always" ? "always" : "hover",
        ...(typeof label.fontSize === "number" ? { fontSize: label.fontSize } : {}),
        ...(typeof label.fontWeight === "number" ? { fontWeight: label.fontWeight } : {}),
        ...(typeof label.color === "string" ? { color: label.color } : {}),
        ...(typeof label.haloColor === "string" ? { haloColor: label.haloColor } : {}),
        ...(typeof label.haloWidth === "number" ? { haloWidth: label.haloWidth } : {}),
        ...(offset && typeof offset.x === "number" && typeof offset.y === "number"
          ? { offset: [offset.x, offset.y] as const }
          : { offset: [0, -(size / 2 + 8)] as const }),
        ...(typeof label.priority === "number" ? { priority: label.priority } : {}),
        ...(typeof label.minZoom === "number" ? { minZoom: label.minZoom } : {}),
        ...(typeof label.maxZoom === "number" ? { maxZoom: label.maxZoom } : {})
      };
    }
  }
  if (spec.collisionMode === "always" || spec.collisionMode === "hide") result.collisionMode = spec.collisionMode;
  return result.image || result.label ? result : undefined;
}

function composeAIStyle(consumer: ObjectStyleResolver | null): ObjectStyleResolver {
  return (object, state, context) => {
    const ai = aiPointObjectStyle(object);
    const custom = consumer?.(object, state, context) ?? undefined;
    if (!ai) return custom;
    if (!custom) return ai;
    return {
      ...ai,
      ...custom,
      image: custom.image !== undefined ? custom.image : ai.image,
      label: custom.label !== undefined ? custom.label : ai.label
    };
  };
}

function hasAIVisual(objects: readonly AIObjectFeature[]): boolean {
  return objects.some((object) => object.properties?.visual && typeof object.properties.visual === "object");
}

/** Browser-side projection of revisioned engine state onto an Orihon map. */
export class AIMapProjection {
  readonly map: Orihon;
  readonly session: AISession;
  readonly #options: AIMapProjectionOptions;
  readonly #collections = new Map<string, CollectionProjection>();
  readonly #routes = new Map<string, RouteProjection>();
  #revision = 0;
  #destroyed = false;
  #transactionManagers: Set<ObjectManager> | null = null;

  constructor(map: Orihon, options: AIMapProjectionOptions = {}) {
    this.map = map;
    this.session = new AISession(map);
    this.#options = options;
  }

  get revision(): number { return this.#revision; }

  getCollectionSource(collection: string): FeatureSource<IdentifiedGeoJSONFeature> | undefined {
    return this.#collections.get(collection)?.source;
  }

  getCollectionManager(collection: string): ObjectManager | undefined {
    return this.#collections.get(collection)?.manager;
  }

  getCollectionNames(): readonly string[] {
    return [...this.#collections.keys()];
  }

  getRouteLayer(id: string): RoutingLayer | undefined {
    return this.#routes.get(id)?.layer;
  }

  getRouteNames(): readonly string[] {
    return [...this.#routes.keys()];
  }

  /** Replace the complete browser projection, normally after GET /snapshot. */
  applySnapshot(snapshot: AIEngineSnapshot): AIResult<AIProjectionSuccess> {
    try {
      this.#assertAlive();
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
        throw new TypeError("AI snapshot revision must be a non-negative safe integer");
      }
      // Engine scene.camera can lag behind a later viewport fit (e.g. clearMap + fit Portugal
      // while camera still points at a previous city). Restoring that camera and then flying
      // makes markers appear to assemble halfway across the world on refresh.
      const restoreViewport = snapshot.viewport?.revision === snapshot.revision
        ? snapshot.viewport
        : undefined;
      if (restoreViewport) {
        this.#fitFeatures(snapshot.collections[restoreViewport.collection] ?? [], {
          ...restoreViewport,
          animation: "none"
        });
      }
      let scene = snapshot.scene;
      if (restoreViewport && snapshot.scene.camera) {
        const { camera: _staleCamera, ...sceneWithoutCamera } = snapshot.scene;
        scene = sceneWithoutCamera;
      }
      const sceneResult = this.session.applyScene(scene);
      if (!sceneResult.ok) return sceneResult;
      for (const [name, projection] of this.#collections) {
        if (!(name in snapshot.collections)) projection.source.clear();
      }
      for (const [name, objects] of Object.entries(snapshot.collections)) {
        this.#collection(name, objects.length > 100, hasAIVisual(objects)).source.reconcile(objects);
      }
      const snapshotRoutes = snapshot.routes ?? {};
      for (const [id, projection] of this.#routes) {
        if (!(id in snapshotRoutes)) {
          projection.layer.remove();
          this.#routes.delete(id);
        }
      }
      for (const route of Object.values(snapshotRoutes)) this.#applyRoute(route);
      this.#revision = snapshot.revision;
      return { ok: true, value: { revision: this.#revision, type: "snapshot" } };
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  /** Apply exactly the next event. Revision gaps trigger a snapshot resync. */
  applyEvent(event: AIEngineEvent): AIResult<AIProjectionSuccess> {
    try {
      this.#assertAlive();
      if (event.revision !== this.#revision + 1) {
        return {
          ok: false,
          error: {
            code: "REVISION_CONFLICT",
            path: "$event.revision",
            message: `Expected revision ${this.#revision + 1}, received ${event.revision}`,
            received: event.revision
          }
        };
      }
      if (event.type === "scene") {
        const result = this.session.execute(event.command);
        if (!result.ok) return result;
        if (event.command.op === "clear" && event.command.ids === undefined) {
          // A full clear resets collections and routes in the engine too.
          this.#clearRoutes();
          for (const projection of this.#collections.values()) projection.source.clear();
        }
      } else if (event.type === "route") {
        this.#annotateRoute(event.route, event.command.annotateStops !== false);
        this.#applyRoute(event.route);
      } else if (event.type === "transaction") {
        if (this.#transactionManagers || !Array.isArray(event.events) || event.events.some(delta => delta.type === ("transaction" as string))) {
          throw new AIError("INVALID_TYPE", "$event.events", "Expected a flat list of transaction deltas");
        }
        const baseRevision = this.#revision;
        const existingNames = new Set(this.#collections.keys());
        const snapshots = new Map([...this.#collections].map(([name, value]) => [name, value.source.getSnapshot().features]));
        const savedScene = this.session.query();
        const savedRoutes = new Map([...this.#routes].map(([id, projection]) => [id, { projection, routes: projection.layer.getRoutes(), selectedIndex: projection.layer.selectedIndex, collection: projection.collection }]));
        const managers = new Set<ObjectManager>();
        this.#transactionManagers = managers;
        const sources = [...this.#collections.values()].map(({ source, manager }) => {
          manager.beginBulk(); managers.add(manager); return source;
        });
        // All subscribed sources publish only final deltas, while managers (including
        // ones created below) defer drawing until the outer transaction finishes.
        const apply = (index: number): void => {
          if (index < sources.length) { sources[index].batch(() => apply(index + 1)); return; }
          try {
            for (const delta of event.events) {
              this.#revision = baseRevision;
              const result = this.applyEvent({ ...delta, revision: event.revision });
              if (!result.ok) throw new AIError(result.error.code, result.error.path, result.error.message);
            }
          } catch (error) {
            for (const [name, projection] of this.#collections) {
              if (existingNames.has(name)) projection.source.replace(snapshots.get(name)!);
              else { projection.manager.destroy(); this.#collections.delete(name); }
            }
            this.session.applyScene(savedScene);
            for (const route of this.#routes.values()) if (![...savedRoutes.values()].some(saved => saved.projection === route)) route.layer.remove();
            this.#routes.clear();
            for (const [id, saved] of savedRoutes) {
              saved.projection.collection = saved.collection;
              saved.projection.layer.setRoutes(saved.routes, saved.selectedIndex).addTo(this.map);
              this.#routes.set(id, saved.projection);
            }
            this.#revision = baseRevision;
            throw error;
          }
        };
        try { apply(0); }
        finally {
          this.#transactionManagers = null;
          for (const manager of managers) manager.endBulk();
        }
      } else {
        const command = event.command;
        this.#removeRoutesForCollection(event.collection);
        // clearMap also drops routes of other collections; the engine names them here.
        if (event.removedRouteIds?.length) this.#removeRoutes(event.removedRouteIds);
        if (command.op === "points.replace") {
          if (command.clearMap) {
            const cleared = this.session.execute({ op: "clear" });
            if (!cleared.ok) return { ok: false, error: cleared.error };
            for (const projection of this.#collections.values()) projection.source.clear();
          }
          // Visuals can arrive from presentation.defaults, so decide on the merged
          // features rather than on the raw point specs.
          const features = pointCommandFeatures(command);
          const projection = this.#collection(event.collection, features.length > 100, hasAIVisual(features));
          projection.source.replace(features);
          if (command.viewport) this.#fitPoints(command);
        } else {
          const source = this.#collection(event.collection).source;
          if (command.op === "objects.add") source.addMany(command.objects);
          else if (command.op === "objects.update") source.batch(() => command.objects.forEach((object) => source.update(object)));
          else if (command.op === "objects.remove") source.remove(command.ids);
          else if (command.op === "objects.replace") source.replace(command.objects);
          else if (command.op === "objects.clear") source.clear();
          else {
            source.batch(() => {
              for (const change of command.changes) {
                if (change.type === "add") source.addMany(change.objects);
                else if (change.type === "update") change.objects.forEach((object) => source.update(object));
                else source.remove(change.ids);
              }
            });
          }
        }
        for (const route of event.routes ?? []) {
          this.#annotateRoute(route, route.request?.annotateStops !== false);
          this.#applyRoute(route);
        }
      }
      this.#revision = event.revision;
      return { ok: true, value: { revision: this.#revision, type: event.type } };
    } catch (error) {
      return { ok: false, error: toAIError(error).toJSON() };
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const projection of this.#collections.values()) projection.manager.destroy();
    this.#collections.clear();
    this.#clearRoutes();
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error("AIMapProjection has been destroyed");
  }

  #collection(name: string, suggestedClusterize = true, enableAIStyle = false): CollectionProjection {
    const existing = this.#collections.get(name);
    if (existing) {
      if (enableAIStyle && !existing.aiStyleEnabled) {
        existing.manager.setStyle(composeAIStyle(existing.consumerStyle));
        existing.aiStyleEnabled = true;
      }
      return existing;
    }
    const source = featureSource<IdentifiedGeoJSONFeature>();
    const sharedOptions = this.#options.objectManager ?? {};
    const collectionOptions = this.#options.collectionOptions?.(name) ?? {};
    const consumerStyle = collectionOptions.style ?? sharedOptions.style ?? null;
    const configuredMarker = collectionOptions.marker ?? sharedOptions.marker;
    const manager = objectManager({
      clusterize: suggestedClusterize,
      clusterRenderer: "auto",
      ...sharedOptions,
      ...collectionOptions,
      marker: configuredMarker ?? {
        shape: "circle",
        size: 14,
        strokeColor: "#ffffff",
        strokeWidth: 2
      },
      ...(enableAIStyle ? { style: composeAIStyle(consumerStyle) } : {}),
      source
    }).addTo(this.map);
    if (this.#transactionManagers) {
      manager.beginBulk();
      this.#transactionManagers.add(manager);
    }
    if (this.#options.objectPopups !== false) {
      manager.bindPopup((object, objectId) => {
        const properties = object.properties ?? {};
        const title = typeof properties.title === "string" ? properties.title : "";
        const popup = properties.popup;
        const order = Number.isSafeInteger(properties.visitOrder) && Number(properties.visitOrder) > 0
          ? `${String(properties.visitOrder)}. `
          : "";
        const rich = popup && typeof popup === "object" && !Array.isArray(popup)
          ? popup as Record<string, unknown>
          : null;
        const text = rich && typeof rich.text === "string"
          ? rich.text
          : typeof popup === "string" ? popup : "";
        const explicitImage = rich?.image && typeof rich.image === "object" && !Array.isArray(rich.image)
          ? rich.image as Record<string, unknown>
          : null;
        const visual = properties.visual && typeof properties.visual === "object" && !Array.isArray(properties.visual)
          ? properties.visual as Record<string, unknown>
          : null;
        const visualImage = visual?.image && typeof visual.image === "object" && !Array.isArray(visual.image)
          ? visual.image as Record<string, unknown>
          : null;
        const image = explicitImage ?? visualImage;
        if (image && typeof image.url === "string") {
          const children: Array<
            | { type: "popupImage"; props: { url: string; alt: string; caption?: string } }
            | { type: "popupText"; props: { text: string } }
          > = [{
            type: "popupImage",
            props: {
              url: image.url,
              alt: typeof image.alt === "string" ? image.alt : title,
              ...(typeof image.caption === "string" ? { caption: image.caption } : {})
            }
          }];
          if (text) children.push({ type: "popupText", props: { text } });
          return popupContent({ title: `${order}${title || String(objectId)}`, children });
        }
        if (title && text) return `${order}${title} — ${text}`;
        return `${order}${title || text || String(objectId)}`;
      });
    }
    const result = { source, manager, aiStyleEnabled: enableAIStyle, consumerStyle };
    this.#collections.set(name, result);
    return result;
  }

  #fitPoints(command: AIPointsReplaceCommand): void {
    const area = new LatLngBounds(command.points.map(({ position }) => position));
    this.#fitBounds(area, command.viewport);
  }

  #fitFeatures(features: readonly AIObjectFeature[], viewport: AIEngineViewport): void {
    const positions = features.flatMap((feature) => {
      if (feature.geometry.type !== "Point") return [];
      const [lng, lat] = feature.geometry.coordinates;
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
    });
    this.#fitBounds(new LatLngBounds(positions), viewport);
  }

  #fitBounds(area: LatLngBounds, viewport?: AIPointViewport): void {
    if (!area.isValid()) return;
    const padding = viewport?.padding ?? 32;
    if (viewport?.animation === "fly") {
      this.map.flyToBounds(area, { padding, durationMs: viewport.durationMs });
    } else {
      this.map.fitBounds(area, { padding });
    }
  }

  #applyRoute(route: AIRoutePlanState): void {
    let projection = this.#routes.get(route.id);
    if (!projection) {
      projection = {
        collection: route.collection,
        layer: routingLayer({
          provider: createStraightLineRoutingProvider(),
          alternatives: false
        }).addTo(this.map)
      };
      this.#routes.set(route.id, projection);
    }
    projection.collection = route.collection;
    projection.layer.setRoutes(route.routes, route.selectedIndex);
  }

  #annotateRoute(route: AIRoutePlanState, enabled: boolean): void {
    if (!enabled) return;
    const source = this.#collection(route.collection).source;
    const order = new Map(route.waypointIds.map((id, index) => [id, index + 1]));
    source.batch(() => {
      for (const feature of source.getFeatures()) {
        const properties = feature.properties ?? {};
        const visitOrder = order.get(feature.id);
        if (visitOrder !== undefined) {
          source.update({ ...feature, properties: { ...properties, routeId: route.id, visitOrder } });
        } else if (properties.routeId === route.id) {
          const next = { ...properties };
          delete next.routeId;
          delete next.visitOrder;
          source.update({ ...feature, properties: next });
        }
      }
    });
  }

  #removeRoutesForCollection(collection: string): void {
    const ids: string[] = [];
    for (const [id, projection] of this.#routes) {
      if (projection.collection === collection) ids.push(id);
    }
    this.#removeRoutes(ids);
  }

  /** Drop route layers by id and strip the stop annotations they wrote, per owning collection. */
  #removeRoutes(ids: Iterable<string>): void {
    const removedByCollection = new Map<string, Set<string>>();
    for (const id of ids) {
      const projection = this.#routes.get(id);
      if (!projection) continue;
      projection.layer.remove();
      this.#routes.delete(id);
      const bucket = removedByCollection.get(projection.collection) ?? new Set<string>();
      bucket.add(id);
      removedByCollection.set(projection.collection, bucket);
    }
    for (const [collection, removedIds] of removedByCollection) {
      const source = this.#collections.get(collection)?.source;
      if (!source) continue;
      source.batch(() => {
        for (const feature of source.getFeatures()) {
          const properties = feature.properties ?? {};
          if (typeof properties.routeId !== "string" || !removedIds.has(properties.routeId)) continue;
          const next = { ...properties };
          delete next.routeId;
          delete next.visitOrder;
          source.update({ ...feature, properties: next });
        }
      });
    }
  }

  #clearRoutes(): void {
    for (const projection of this.#routes.values()) projection.layer.remove();
    this.#routes.clear();
  }
}

export function createAIMapProjection(map: Orihon, options?: AIMapProjectionOptions): AIMapProjection {
  return new AIMapProjection(map, options);
}
