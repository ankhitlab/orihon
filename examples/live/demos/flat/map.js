/*
 * A map that is not the Earth.
 *
 * `crs: "Simple"` swaps Web Mercator for a flat Euclidean space: `lat` is y,
 * `lng` is x, and `map.distance()` returns plain units instead of metres. Floor
 * plans, site layouts, scanned drawings, game worlds and microscopy all live
 * here — and every ordinary layer, popup, tooltip and control still works,
 * because only the projection changed.
 */

import { createMap } from "orihon/easy";
import { polygon, polyline, circleMarker, imageOverlay } from "orihon";

const PALETTE = {
  hall: "#2d7285",
  cold: "#0b463c",
  office: "#b6820a",
  dock: "#c1501f"
};

/** Metres of a real warehouse, used directly as map units. */
const ROOMS = [
  { name: "Receiving hall", kind: "hall", area: [[0, 0], [120, 0], [120, 70], [0, 70]] },
  { name: "Cold store", kind: "cold", area: [[0, 70], [60, 70], [60, 130], [0, 130]] },
  { name: "Dispatch", kind: "hall", area: [[60, 70], [120, 70], [120, 130], [60, 130]] },
  { name: "Offices", kind: "office", area: [[120, 0], [180, 0], [180, 55], [120, 55]] },
  { name: "Dock A", kind: "dock", area: [[120, 55], [180, 55], [180, 92], [120, 92]] },
  { name: "Dock B", kind: "dock", area: [[120, 92], [180, 92], [180, 130], [120, 130]] }
];

const AISLES = [
  [[10, 12], [110, 12]], [[10, 34], [110, 34]], [[10, 56], [110, 56]],
  [[14, 8], [14, 60]], [[106, 8], [106, 60]]
];

const ASSETS = [
  { id: "fk-1", label: "Forklift 1", at: [96, 24] },
  { id: "fk-2", label: "Forklift 2", at: [30, 101] },
  { id: "chg", label: "Charging bay", at: [150, 27] },
  { id: "scan", label: "Scanner gate", at: [120, 44] },
  { id: "pal", label: "Pallet buffer", at: [86, 110] }
];

export function createScene({ container }) {
  const map = createMap(container, {
    // No basemap: nothing is being projected, so nothing is being tiled either.
    crs: "Simple",
    center: { lat: 65, lng: 90 },
    zoom: 2,
    minZoom: 0,
    maxZoom: 6,
    basemap: false
  });

  // A scanned plan would go here; the generated one keeps the demo self-contained.
  imageOverlay(floorPlanImage(), [{ lat: 0, lng: 0 }, { lat: 130, lng: 180 }], {
    opacity: 0.5
  }).addTo(map);

  for (const room of ROOMS) {
    polygon(room.area.map(([x, y]) => ({ lat: y, lng: x })), {
      fill: PALETTE[room.kind],
      fillOpacity: 0.22,
      stroke: PALETTE[room.kind],
      strokeWidth: 2
    })
      .addTo(map)
      .bindTooltip(room.name);
  }

  for (const aisle of AISLES) {
    polyline(aisle.map(([x, y]) => ({ lat: y, lng: x })), {
      stroke: "#7f958d",
      strokeWidth: 2,
      dashArray: "6 6"
    }).addTo(map);
  }

  const assets = ASSETS.map((asset) =>
    circleMarker({ lat: asset.at[1], lng: asset.at[0] }, {
      radiusPixels: 7,
      fill: "#c1501f",
      fillOpacity: 0.95,
      stroke: "#fbf4ed",
      strokeWidth: 2
    })
      .addTo(map)
      .bindPopup(`${asset.label} · x ${asset.at[0]}, y ${asset.at[1]}`)
  );

  map.fitBounds([{ lat: 0, lng: 0 }, { lat: 130, lng: 180 }], { padding: 30 });
  return { map, assets };
}

/**
 * Euclidean, not geodesic: on a Simple map `distance()` is straight Pythagoras
 * in whatever unit the coordinates are in — here, metres of warehouse floor.
 */
export function pathLength(map, points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += map.distance(points[i - 1], points[i]);
  return total;
}

/** Hatched floor, drawn once into a data URI so the demo needs no asset. */
function floorPlanImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 520;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(18, 49, 43, 0.10)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(18, 49, 43, 0.45)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvas.width - 3, canvas.height - 3);
  return canvas.toDataURL("image/png");
}
