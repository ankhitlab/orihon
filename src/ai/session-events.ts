import type { AIPosition } from "./types.js";

/** Visible map rectangle in WGS84. */
export interface AIMapViewportBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Live camera + visible rectangle reported by the browser. */
export interface AIMapViewportState {
  center: AIPosition;
  zoom: number;
  /** Visible map rectangle — needed at high zoom where center alone is ambiguous. */
  bounds?: AIMapViewportBounds;
}

/** Duck-typed map surface used to snapshot center/zoom/bounds. */
export interface AIMapViewportSource {
  getCenter(): { lat: number; lng: number };
  getZoom(): number;
  getBounds?: () => {
    south: number;
    west: number;
    north: number;
    east: number;
  };
}

/** Read center, zoom, and visible bounds from a live map. */
export function readMapViewport(map: AIMapViewportSource): AIMapViewportState {
  const center = map.getCenter();
  const viewport: AIMapViewportState = {
    center: { lat: center.lat, lng: center.lng },
    zoom: map.getZoom()
  };
  if (typeof map.getBounds === "function") {
    const area = map.getBounds();
    viewport.bounds = {
      south: area.south,
      west: area.west,
      north: area.north,
      east: area.east
    };
  }
  return viewport;
}

/** Browser→AI map events. Hosts and agents subscribe via AIAgentSession.subscribeUser. */
export type AIUserMapEvent =
  | {
      type: "selectionchange";
      selection: Array<string | number>;
      collection?: string;
      source: "user" | "agent";
      at: number;
    }
  | {
      type: "objectmove";
      id: string | number;
      collection: string;
      position: AIPosition;
      previous?: AIPosition;
      source: "user" | "agent";
      revision?: number;
      at: number;
    }
  | {
      type: "viewportchange";
      viewport: AIMapViewportState;
      source: "user" | "agent";
      at: number;
    };

export type AIUserMapListener = (event: AIUserMapEvent) => void;

export interface AIObserveBrowserOptions {
  /** Mirror ObjectManager clicks into session.local.selection. Default true. */
  selection?: boolean;
  /** Mirror map pan/zoom into session.local.viewport. Default true. */
  viewport?: boolean;
  /** Make DOM point markers draggable and report objectmove. Default false. */
  editable?: boolean;
  /**
   * Persist objectmove into session.engine via objects.update.
   * Set false when the host posts to a remote engine instead. Default true.
   */
  syncEngine?: boolean;
}

export interface AIApplyObjectMoveInput {
  collection: string;
  id: string | number;
  position: AIPosition;
  previous?: AIPosition;
  /** Default true. */
  syncEngine?: boolean;
  source?: "user" | "agent";
}
