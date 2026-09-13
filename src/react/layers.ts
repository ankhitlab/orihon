import { createElement, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LatLngLike } from "../geo.js";
import { FeatureGroup as OrihonFeatureGroup, featureGroup } from "../layer-group.js";
import type { Layer } from "../layer.js";
import { GeoJSONLayer, geoJSON, type GeoJSONData, type GeoJSONOptions } from "../layers/geojson.js";
import { Marker as OrihonMarker, marker, validateMarkerOptions, type MarkerOptions } from "../layers/marker.js";
import { TileLayer as OrihonTileLayer, tileLayer, type TileLayerOptions, type TileTemplate } from "../layers/tile-layer.js";
import { GroupContext, LayerContext, useMap } from "./context.js";
import { useSyncedProp } from "./sync.js";

function useLayer(layer: Layer): void {
  const map = useMap();
  const group = useContext(GroupContext);
  useLayoutEffect(() => {
    if (group) group.addLayer(layer);
    else layer.addTo(map);
    return () => {
      if (group) group.removeLayer(layer);
      else layer.remove();
    };
  }, [map, group, layer]);
}

export interface TileLayerProps extends TileLayerOptions { url: TileTemplate; }

export function TileLayer({ url, ...options }: TileLayerProps) {
  const [layer] = useState(() => tileLayer(url, options));
  useLayer(layer);
  useLayoutEffect(() => { layer.setUrl(url); }, [layer, url]);
  useLayoutEffect(() => { if (options.opacity != null) layer.setOpacity(options.opacity); }, [layer, options.opacity]);
  return null;
}

export type MarkerProps = MarkerOptions & {
  position: LatLngLike;
  children?: ReactNode;
}

export function Marker({ position, children, ...options }: MarkerProps) {
  validateMarkerOptions(options);
  const [layer] = useState(() => marker(position, options));
  useLayer(layer);

  useLayoutEffect(() => { layer.setLatLng(position); }, [layer, position]);

  useSyncedProp(layer, () => {
    if (options.opacity != null) layer.setOpacity(options.opacity);
  }, [options.opacity]);

  useSyncedProp(layer, () => {
    if (options.draggable !== undefined) layer.setDraggable(options.draggable);
  }, [options.draggable]);

  useSyncedProp(layer, () => {
    if (options.interactive !== undefined) layer.setInteractive(options.interactive);
  }, [options.interactive]);

  useSyncedProp(layer, () => {
    if (options.zIndexOffset !== undefined) layer.setZIndexOffset(options.zIndexOffset);
  }, [options.zIndexOffset]);

  useSyncedProp(layer, () => {
    if (options.title !== undefined) layer.setTitle(options.title);
  }, [options.title]);

  useSyncedProp(layer, () => {
    if (options.ariaLabel !== undefined) layer.setAriaLabel(options.ariaLabel);
  }, [options.ariaLabel]);

  useSyncedProp(layer, () => {
    if (options.className !== undefined) layer.setClassName(options.className);
  }, [options.className]);

  useSyncedProp(layer, () => {
    if (options.rotation !== undefined) layer.setRotation(options.rotation);
  }, [options.rotation]);

  useSyncedProp(layer, () => {
    if (options.rotationOrigin !== undefined) layer.setRotationOrigin(options.rotationOrigin);
  }, [options.rotationOrigin]);

  useSyncedProp(layer, () => {
    if (options.keyboard !== undefined) layer.setKeyboard(options.keyboard);
  }, [options.keyboard]);

  // Visual mode: icon / content / built-in appearance are mutually exclusive at validate time.
  useSyncedProp(layer, () => {
    if (options.icon !== undefined) {
      layer.setIcon(options.icon);
      return;
    }
    if (options.content !== undefined) {
      layer.setContent(options.content);
      return;
    }
    const hasAppearance = ["shape", "color", "strokeColor", "size", "strokeWidth"].some(
      (key) => (options as Record<string, unknown>)[key] !== undefined
    );
    if (hasAppearance) {
      layer.setAppearance({
        ...(options.shape !== undefined ? { shape: options.shape } : {}),
        ...(options.color !== undefined ? { color: options.color } : {}),
        ...(options.strokeColor !== undefined ? { strokeColor: options.strokeColor } : {}),
        ...(options.size !== undefined ? { size: options.size } : {}),
        ...(options.strokeWidth !== undefined ? { strokeWidth: options.strokeWidth } : {})
      });
    }
    if (options.anchor !== undefined) layer.setAnchor(options.anchor);
  }, [
    options.icon,
    options.content,
    options.shape,
    options.color,
    options.strokeColor,
    options.size,
    options.strokeWidth,
    options.anchor
  ]);

  return createElement(LayerContext.Provider, { value: layer }, children);
}

export interface GeoJSONProps extends GeoJSONOptions {
  data: GeoJSONData;
}

/**
 * Builder callbacks (`onEachFeature`, `pointToLayer`, `filter`) and `renderer` are
 * recreate-required: changing them replaces the layer so they are not silently stale.
 * `data` and `style` update in place.
 */
export function GeoJSON({
  data,
  style,
  onEachFeature,
  pointToLayer,
  filter,
  renderer,
  ...pathOptions
}: GeoJSONProps) {
  const initial = useRef({ style, onEachFeature, pointToLayer, filter, renderer, ...pathOptions });
  const builders = useRef({ onEachFeature, pointToLayer, filter, renderer });
  const [layer, setLayer] = useState(() => geoJSON(data, initial.current));
  useLayer(layer);
  const dataSkip = useRef(true);

  useLayoutEffect(() => {
    const prev = builders.current;
    if (
      prev.onEachFeature === onEachFeature
      && prev.pointToLayer === pointToLayer
      && prev.filter === filter
      && prev.renderer === renderer
    ) return;
    builders.current = { onEachFeature, pointToLayer, filter, renderer };
    dataSkip.current = true;
    setLayer(geoJSON(data, {
      style,
      onEachFeature,
      pointToLayer,
      filter,
      renderer,
      ...pathOptions
    }));
    // pathOptions apply on recreate; style/data have dedicated sync paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- builder identity owns recreate
  }, [onEachFeature, pointToLayer, filter, renderer]);

  useLayoutEffect(() => {
    if (dataSkip.current) {
      dataSkip.current = false;
      return;
    }
    layer.clearLayers().addData(data);
  }, [layer, data]);

  useLayoutEffect(() => { if (style) layer.setStyle(style); }, [layer, style]);

  return createElement(LayerContext.Provider, { value: layer });
}

export interface FeatureGroupProps { children?: ReactNode; }

export function FeatureGroup({ children }: FeatureGroupProps) {
  const [group] = useState<OrihonFeatureGroup>(() => featureGroup());
  useLayer(group);
  return createElement(
    LayerContext.Provider,
    { value: group },
    createElement(GroupContext.Provider, { value: group }, children)
  );
}

export type { OrihonTileLayer, OrihonMarker, GeoJSONLayer };
