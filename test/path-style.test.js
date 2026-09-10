import test from "node:test";
import assert from "node:assert/strict";
import { CanvasPathBatch } from "../dist/layers/canvas-path-batch.js";
import { Circle, Polygon, Polyline, normalizeDashArray, pixelDistance } from "../dist/layers/vector.js";

test("dash arrays accept strings, arrays and clearing values", () => {
  assert.deepEqual(normalizeDashArray("8 4"), [8, 4]);
  assert.deepEqual(normalizeDashArray([6, 2]), [6, 2]);
  assert.deepEqual(normalizeDashArray(null), []);
});

test("geodesic circle bounds widen in longitude at high latitude", () => {
  const geodesic = new Circle({ lat: 60, lng: 10 }, { radiusMeters: 50_000 }, { geodesic: true });
  const bounds = geodesic.getBounds();
  assert.ok(bounds.east - bounds.west > bounds.north - bounds.south);
});

test("polyline geodesic option remains mutable through setStyle", () => {
  const line = new Polyline([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }], { dashArray: "6 4", arrow: "end", geodesic: true });
  line.setStyle({ dashArray: null });
  assert.equal(line.options.dashArray, null);
  assert.equal(line.options.arrow, "end");
});

test("geodesic line and polygon bounds include great-circle bulges", () => {
  const line = new Polyline([{ lat: 60, lng: -60 }, { lat: 60, lng: 60 }], { geodesic: true });
  const area = new Polygon([{ lat: 60, lng: -60 }, { lat: 60, lng: 60 }, { lat: 20, lng: 0 }], { geodesic: true });
  assert.ok(line.getBounds().north > 60);
  assert.ok(area.getBounds().north > 60);
});

test("setStyle redraws when geodesic changes", () => {
  class CountingPolyline extends Polyline {
    renders = 0;
    render() { this.renders++; super.render(); }
  }
  const line = new CountingPolyline([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]);
  line.setStyle({ geodesic: true });
  assert.equal(line.renders, 1);
});

test("CanvasPathBatch densifies geodesic paths", () => {
  const batch = new CanvasPathBatch();
  batch.addPath([[{ lat: 60, lng: -60 }, { lat: 60, lng: 60 }]], false, { geodesic: true });
  assert.ok(batch.records[0].geodesicRings[0].lat.length > 2);
});

test("Circle uses map units for bounds on Simple CRS", () => {
  const shape = new Circle({ lat: 200, lng: 300 }, { radiusMapUnits: 50 }, { geodesic: true });
  shape.map = { crs: { code: "Simple" } };
  const southWest = shape.getBounds().getSouthWest();
  const northEast = shape.getBounds().getNorthEast();
  assert.deepEqual([southWest.lat, southWest.lng], [150, 250]);
  assert.deepEqual([northEast.lat, northEast.lng], [250, 350]);
});

/*
 * pixelDistance replaces Math.hypot in the hit-test loops. hypot guards against
 * intermediate overflow near the float limit, which screen coordinates never reach,
 * and costs about 7x for it. The two are not bit-identical, so pin how far apart
 * they are allowed to drift instead of asserting equality.
 */
test("pixelDistance tracks Math.hypot far below any usable tolerance", () => {
  let worst = 0;
  for (const [dx, dy] of [
    [0, 0], [3, 4], [-3, -4], [1e-8, 1e-8], [40000, -40000],
    [0.5, 123456.75], [-29915.250083733634, 36825.13810146707]
  ]) {
    worst = Math.max(worst, Math.abs(pixelDistance(dx, dy) - Math.hypot(dx, dy)));
  }
  assert.ok(worst < 1e-6, `expected sub-micropixel agreement, saw ${worst}`);
  assert.equal(pixelDistance(0, 0), 0);
  assert.equal(pixelDistance(3, 4), 5);
});
