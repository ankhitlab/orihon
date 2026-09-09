import assert from "node:assert/strict";
import test from "node:test";
import { objectManager } from "../dist/object-manager-entry.js";

/*
 * `sceneFeatures: "auto"` is the default now: the per-object scene — geometries, spatial
 * index, decoration entries — stays down until something would draw through it. That
 * saved ~300 bytes an object at a million plain points, so these pin every way it can
 * come up, and the one way it must not.
 */

const points = (n) => Array.from({ length: n }, (_, i) => ({
  id: i,
  coordinates: { lat: 50 + (i % 20) / 100, lng: 14 + Math.floor(i / 20) / 100 }
}));

test("plain points under the default leave the scene down", () => {
  const manager = objectManager();
  manager.add(points(200));
  assert.equal(manager.options.sceneFeatures, "auto");
  assert.equal(manager._sceneActive, false);
  assert.equal(manager.scene.geometries.size, 0, "no per-object scene geometry was built");
  assert.equal(manager.getStats().objects, 200, "the objects themselves are all there");
});

test("a style resolver brings the scene up and backfills existing objects", () => {
  const manager = objectManager();
  manager.add(points(200));
  manager.setStyle(() => ({ label: { text: "x" } }));
  assert.equal(manager._sceneActive, true);
  assert.equal(manager.scene.geometries.size, 200, "objects added before the style are rebuilt into the scene");
});

test("registering an icon brings the scene up", () => {
  const manager = objectManager();
  manager.add(points(50));
  assert.equal(manager._sceneActive, false);
  manager.registerIcon("pin", "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>");
  assert.equal(manager._sceneActive, true);
  assert.equal(manager.scene.geometries.size, 50);
});

test("a line or polygon brings the scene up, since only the scene draws it", () => {
  const manager = objectManager();
  manager.add(points(50));
  assert.equal(manager._sceneActive, false);
  manager.add({ id: "road", geometry: { type: "LineString", coordinates: [[14, 50], [14.1, 50.1], [14.2, 50.05]] } });
  assert.equal(manager._sceneActive, true);
  assert.equal(manager.scene.geometries.size, 51, "the points were backfilled alongside the line");
});

test("declutter at construction brings the scene up from the start", () => {
  const manager = objectManager({ declutter: true });
  assert.equal(manager._sceneActive, true);
});

test("an explicit false stays off even after a style arrives", () => {
  const manager = objectManager({ sceneFeatures: false });
  manager.add(points(50));
  manager.setStyle(() => ({ label: { text: "x" } }));
  assert.equal(manager._sceneActive, false, "false is a promise, not a hint");
  assert.equal(manager.scene.geometries.size, 0);
});

test("an explicit true is on from the start with plain points", () => {
  const manager = objectManager({ sceneFeatures: true });
  manager.add(points(50));
  assert.equal(manager._sceneActive, true);
  assert.equal(manager.scene.geometries.size, 50);
});

test("setSceneFeatures moves between all three values", () => {
  const manager = objectManager();
  manager.add(points(50));
  manager.setSceneFeatures(true);
  assert.equal(manager._sceneActive, true);
  manager.setSceneFeatures("auto");
  assert.equal(manager._sceneActive, false, "auto with nothing decorated resolves to off");
  manager.setStyle(() => ({}));
  assert.equal(manager._sceneActive, true, "and back on once a style exists");
  manager.setSceneFeatures(false);
  assert.equal(manager._sceneActive, false);
});
