import { createElement, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import type { EventFor, EventHandler } from "../events.js";
import type { LatLngLike } from "../geo.js";
import { createMap, type MapEventMap, type MapOptions, type Orihon } from "../map.js";
import { MapContext } from "./context.js";
import { useSyncedProp } from "./sync.js";
import { rejectLegacyUnit } from "../units.js";

export interface MapProps extends Omit<HTMLAttributes<HTMLDivElement>, "onClick">, Omit<MapOptions, "center" | "zoom"> {
  center: LatLngLike;
  zoom: number;
  children?: ReactNode;
  style?: CSSProperties;
  onClick?: EventHandler<EventFor<MapEventMap, "click", Orihon>>;
  onMapReady?: (map: Orihon) => void;
}

export function Map(props: MapProps) {
  rejectLegacyUnit(props, "zoomAnimationDuration", "zoomAnimationDurationMs");
  const {
    center, zoom, children, onClick, onMapReady,
    minZoom, maxZoom, zoomSnap, wheelZoomStep, maxBounds, maxBoundsViscosity,
    inertia, inertiaDeceleration, inertiaMaxSpeed, zoomAnimationDurationMs, controls,
    locale, ariaLabel, keyboard, keyboardPanDelta, behaviors, crs,
    ...containerProps
  } = props;
  const mapOptions = {
    minZoom, maxZoom, zoomSnap, wheelZoomStep, maxBounds, maxBoundsViscosity,
    inertia, inertiaDeceleration, inertiaMaxSpeed, zoomAnimationDurationMs, controls,
    locale, ariaLabel, keyboard, keyboardPanDelta, behaviors, crs
  };
  const definedOptions = Object.fromEntries(
    Object.entries(mapOptions).filter(([, value]) => value !== undefined)
  ) as MapOptions;
  const containerRef = useRef<HTMLDivElement>(null);
  const initial = useRef({ center, zoom, ...definedOptions });
  const [map, setMap] = useState<Orihon | null>(null);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const instance = createMap(containerRef.current, initial.current);
    setMap(instance);
    onMapReady?.(instance);
    return () => {
      setMap(null);
      instance.destroy();
    };
  }, []);

  // Controlled camera — applied whenever center/zoom change, including first paint.
  useLayoutEffect(() => {
    map?.setView(center, zoom);
  }, [map, center, zoom]);

  useSyncedProp(map, () => {
    if (locale) map!.setLocale(locale);
  }, [locale]);

  useSyncedProp(map, () => {
    if (minZoom !== undefined) map!.setMinZoom(minZoom);
  }, [minZoom]);

  useSyncedProp(map, () => {
    if (maxZoom !== undefined) map!.setMaxZoom(maxZoom);
  }, [maxZoom]);

  useSyncedProp(map, () => {
    if (maxBounds !== undefined) map!.setMaxBounds(maxBounds);
  }, [maxBounds]);

  useSyncedProp(map, () => {
    if (maxBoundsViscosity !== undefined) map!.setMaxBoundsViscosity(maxBoundsViscosity);
  }, [maxBoundsViscosity]);

  useSyncedProp(map, () => {
    if (zoomSnap !== undefined) map!.setZoomSnap(zoomSnap);
  }, [zoomSnap]);

  useSyncedProp(map, () => {
    if (wheelZoomStep !== undefined) map!.setWheelZoomStep(wheelZoomStep);
  }, [wheelZoomStep]);

  useSyncedProp(map, () => {
    if (inertia !== undefined) map!.setInertia(inertia);
  }, [inertia]);

  useSyncedProp(map, () => {
    if (inertiaDeceleration !== undefined) map!.setInertiaDeceleration(inertiaDeceleration);
  }, [inertiaDeceleration]);

  useSyncedProp(map, () => {
    if (inertiaMaxSpeed !== undefined) map!.setInertiaMaxSpeed(inertiaMaxSpeed);
  }, [inertiaMaxSpeed]);

  useSyncedProp(map, () => {
    if (zoomAnimationDurationMs !== undefined) map!.setZoomAnimationDurationMs(zoomAnimationDurationMs);
  }, [zoomAnimationDurationMs]);

  useSyncedProp(map, () => {
    if (controls !== undefined) map!.setControls(controls);
  }, [controls]);

  useSyncedProp(map, () => {
    if (ariaLabel !== undefined) map!.setAriaLabel(ariaLabel);
  }, [ariaLabel]);

  useSyncedProp(map, () => {
    if (keyboard !== undefined) map!.setKeyboard(keyboard);
  }, [keyboard]);

  useSyncedProp(map, () => {
    if (keyboardPanDelta !== undefined) map!.setKeyboardPanDelta(keyboardPanDelta);
  }, [keyboardPanDelta]);

  useSyncedProp(map, () => {
    if (behaviors !== undefined) map!.setBehaviors(behaviors);
  }, [behaviors]);

  useLayoutEffect(() => {
    if (!map || !onClick) return;
    map.on("click", onClick);
    return () => { map.off("click", onClick); };
  }, [map, onClick]);

  return createElement(
    MapContext.Provider,
    { value: map },
    createElement("div", { ...containerProps, ref: containerRef }, map ? children : null)
  );
}
