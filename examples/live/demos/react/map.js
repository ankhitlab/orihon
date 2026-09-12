/*
 * The React bindings.
 *
 * `orihon/react` is a thin binding, not a second engine: <Map> owns a real
 * Orihon instance, every child mounts a real layer, and `useMap()` hands you the
 * map itself when you need something the components do not cover. React and
 * React DOM are optional peer dependencies, so a non-React app never sees them.
 *
 * Written with `createElement` because this page has no build step. With a
 * bundler these are the JSX tags you would write instead — same components,
 * same props.
 */

import { createElement as h, useCallback, useMemo, useState } from "react";
import { Map, TileLayer, Marker, Popup, GeoJSON, useMapEvent } from "orihon/react";

const STATUS = { open: "#0b463c", busy: "#b6820a", closed: "#c1501f" };

export const basemapFor = (dark) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
    dark ? "Dark" : "Light"
  }_Gray_Base/MapServer/tile/{z}/{y}/{x}`;

/** Clicks on the map are an event, not an imperative handle. */
function ClickToAdd({ onAdd }) {
  useMapEvent("click", (event) => onAdd(event.latlng));
  return null;
}

export function App({ dark, initialStops, onCountChange }) {
  const [stops, setStops] = useState(initialStops);
  const [filter, setFilter] = useState("all");

  const visible = useMemo(
    () => (filter === "all" ? stops : stops.filter((stop) => stop.status === filter)),
    [stops, filter]
  );

  const addStop = useCallback(
    (latlng) => {
      setStops((current) => {
        const next = [
          ...current,
          {
            id: `stop-${current.length + 1}`,
            name: `Stop ${current.length + 1}`,
            status: "open",
            position: { lat: latlng.lat, lng: latlng.lng }
          }
        ];
        onCountChange?.(next.length);
        return next;
      });
    },
    [onCountChange]
  );

  const area = useMemo(
    () => ({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Service area" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [13.352, 52.503], [13.432, 52.498], [13.452, 52.535],
              [13.360, 52.541], [13.352, 52.503]
            ]]
          }
        }
      ]
    }),
    []
  );

  // State drives the map. Removing a marker from `visible` removes the layer.
  return h(
    Map,
    {
      center: { lat: 52.518, lng: 13.4 },
      zoom: 12,
      style: { position: "absolute", inset: 0 }
    },
    h(TileLayer, { url: basemapFor(dark), attribution: "Tiles © Esri", maxNativeZoom: 16 }),
    h(GeoJSON, {
      data: area,
      style: { fill: "#2d7285", fillOpacity: 0.14, stroke: "#2d7285", strokeWidth: 2 }
    }),
    h(ClickToAdd, { onAdd: addStop }),
    visible.map((stop) =>
      h(
        Marker,
        {
          key: stop.id,
          position: stop.position,
          shape: "pin",
          color: STATUS[stop.status],
          title: stop.name
        },
        h(Popup, null, `${stop.name} — ${stop.status}`)
      )
    ),
    h(Legend, { filter, setFilter, shown: visible.length, total: stops.length })
  );
}

/** Ordinary React, rendered over the map by the page's own CSS. */
function Legend({ filter, setFilter, shown, total }) {
  return h(
    "div",
    { className: "react-legend" },
    h("strong", null, `${shown} of ${total} stops`),
    h(
      "div",
      { className: "react-legend-row" },
      ["all", "open", "busy", "closed"].map((value) =>
        h(
          "button",
          {
            key: value,
            type: "button",
            "aria-pressed": String(filter === value),
            onClick: () => setFilter(value)
          },
          value
        )
      )
    ),
    h("small", null, "Click the map to add a stop")
  );
}

export const INITIAL_STOPS = [
  { id: "s1", name: "Hauptbahnhof", status: "open", position: { lat: 52.5251, lng: 13.3694 } },
  { id: "s2", name: "Potsdamer Platz", status: "busy", position: { lat: 52.5096, lng: 13.376 } },
  { id: "s3", name: "Alexanderplatz", status: "open", position: { lat: 52.5219, lng: 13.4132 } },
  { id: "s4", name: "Nordbahnhof", status: "closed", position: { lat: 52.532, lng: 13.388 } },
  { id: "s5", name: "Gendarmenmarkt", status: "busy", position: { lat: 52.5136, lng: 13.3925 } }
];
