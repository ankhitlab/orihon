/*
 * Drawing, editing, measuring — opt-in packages, not engine weight.
 *
 * `orihon/draw` is 7 KiB gzip and `orihon/controls` is 3 KiB. A map that never
 * draws anything never loads either of them. Everything the user produces comes
 * back out as ordinary GeoJSON.
 */

import { createMap } from "orihon/easy";
import { tileLayer } from "orihon";
import { drawControl } from "orihon/draw";
import { fullscreenControl, measureControl, miniMap, graticuleLayer } from "orihon/controls";

export const basemapFor = (dark) => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${
    dark ? "Dark" : "Light"
  }_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
  attribution: "Tiles © Esri",
  maxNativeZoom: 16
});

export function createScene({ container, dark, onChange }) {
  const map = createMap(container, {
    center: { lat: 52.515, lng: 13.39 },
    zoom: 13,
    basemap: basemapFor(dark)
  });

  const draw = drawControl({
    position: "top-left",
    modes: ["point", "polyline", "polygon", "rectangle", "circle", "edit", "delete"],
    // Vertices land on existing geometry instead of near it.
    snap: { enabled: true, pixelTolerance: 12 },
    guide: { stroke: "#c1501f", strokeWidth: 2, dashArray: "4 4" }
  }).addTo(map);

  map.addControl(measureControl({ position: "top-right", stroke: "#0b463c" }));
  map.addControl(fullscreenControl({ position: "top-right" }));
  map.addControl(
    miniMap(tileLayer(basemapFor(dark).url, { attribution: "" }), {
      position: "bottom-right",
      zoomOffset: -4,
      width: 150,
      height: 110
    })
  );

  const graticule = graticuleLayer({
    step: "auto",
    stroke: dark ? "#e6f1ea" : "#12312b",
    strokeOpacity: 0.14
  });

  // Every mutation reports the whole collection, so the application never has
  // to reconstruct state from individual events.
  for (const event of ["drawcomplete", "editcomplete", "deletecomplete", "undo", "redo"]) {
    draw.on(event, () => onChange(draw.handler.toGeoJSON()));
  }

  return { map, draw, graticule };
}

/** Round-trips: whatever `toGeoJSON()` produced, `loadData()` takes back. */
export function loadSample(draw) {
  draw.handler.loadData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Delivery area" },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [13.355, 52.505], [13.408, 52.499], [13.432, 52.522],
            [13.395, 52.535], [13.354, 52.526], [13.355, 52.505]
          ]]
        }
      },
      {
        type: "Feature",
        properties: { name: "Service route" },
        geometry: {
          type: "LineString",
          coordinates: [[13.369, 52.525], [13.378, 52.516], [13.401, 52.520], [13.413, 52.522]]
        }
      }
    ]
  });
}
