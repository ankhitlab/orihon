import test from "node:test";
import assert from "node:assert/strict";
import { WebGLPathBatch } from "../dist/layers/webgl-path-batch.js";
import { GeoJSONLayer } from "../dist/layers/geojson.js";
import "../dist/advanced-entry.js";

/*
 * What the WebGL path batch keeps per path decided a 660 MB heap at a million lines
 * where the draw buffer itself was 60. Three things have to stay true for that not to
 * come back: a batch nobody can click keeps nothing but the draw buffer, a layer that
 * said `retainFeatures: false` does not get its features pinned by the batch anyway,
 * and an interactive batch packs its vertices into one buffer rather than one typed
 * array per ring.
 */

const SQUARE = [[{ lat: 0, lng: 0 }, { lat: 0, lng: 10 }, { lat: 10, lng: 10 }, { lat: 10, lng: 0 }, { lat: 0, lng: 0 }]];
const feature = (id) => ({
  type: "Feature",
  id,
  properties: {},
  geometry: { type: "LineString", coordinates: [[0, 0], [1, 1], [2, 0], [3, 1]] }
});

test("a non-interactive batch retains no records at all", () => {
  const batch = new WebGLPathBatch();
  for (let i = 0; i < 50; i++) batch.addPath(SQUARE, true, {}, { id: i });
  assert.equal(batch._records.length, 0, "records exist only to answer clicks");
  assert.equal(batch._vtxBuf.length, 0, "and so does the vertex buffer");
  assert.equal(batch.count, 50 * 4, "the draw buffer still has every segment");
  assert.ok(Number.isFinite(batch.getBounds().north), "bounds do not depend on records");
});

test("retainFeatures: false keeps the feature out of the batch", () => {
  const layer = new GeoJSONLayer(
    { type: "FeatureCollection", features: [feature("a"), feature("b")] },
    { renderer: "webgl", interactive: true, retainFeatures: false }
  );
  const batch = layer.getLayers()[0];
  assert.equal(batch instanceof WebGLPathBatch, true);
  assert.equal(batch._records.length, 2, "interactive, so records exist");
  for (const record of batch._records) assert.equal(record.feature, undefined, "but none pins a feature");
});

test("retainFeatures left alone still carries the feature to a hit", () => {
  const layer = new GeoJSONLayer(feature("kept"), { renderer: "webgl", interactive: true });
  const batch = layer.getLayers()[0];
  assert.equal(batch._records[0].feature.id, "kept");
});

test("an interactive batch packs rings into one shared vertex buffer", () => {
  const batch = new WebGLPathBatch({ interactive: true });
  batch.addPath(SQUARE, true);
  batch.addPath([[{ lat: 5, lng: 5 }, { lat: 6, lng: 6 }, { lat: 7, lng: 5 }]], false);
  assert.equal(batch._records.length, 2);
  const [first, second] = batch._records;
  assert.deepEqual(first.rings[0], { start: 0, count: 5 });
  assert.deepEqual(second.rings[0], { start: 5, count: 3 });
  assert.equal(batch._vtxCount, 8);
  // The buffer holds lat, lng pairs in ring order.
  assert.deepEqual([...batch._vtxBuf.subarray(10, 16)], [5, 5, 6, 6, 7, 5]);
  batch.clearPaths();
  assert.equal(batch._vtxCount, 0);
  assert.equal(batch._records.length, 0);
});
