import test from "node:test";
import assert from "node:assert/strict";
import { CRS, CRSCompatibilityError } from "../dist/crs.js";
import { Orihon } from "../dist/map.js";
import { Point } from "../dist/geo.js";

class FakeClassList { add() {} remove() {} }
class FakeElement {
  constructor() { this.children = []; this.classList = new FakeClassList(); this.style = {}; this.attributes = new Map(); this.listeners = new Map(); this.clientWidth = 800; this.clientHeight = 600; }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  addEventListener(type, handler) { const list = this.listeners.get(type) ?? []; list.push(handler); this.listeners.set(type, list); }
  removeEventListener() {}
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  remove() {}
}

globalThis.document = { createElement: () => new FakeElement(), getElementById: () => null };
globalThis.window = new FakeElement();
globalThis.requestAnimationFrame = () => 1;

test("CRS.Simple projects map units without Mercator clamping", () => {
  const projected = CRS.Simple.project({ lat: 4000, lng: 1500 }, 2);
  assert.deepEqual(projected.toArray(), [6000, -16000]);
  assert.ok(CRS.Simple.unproject(projected, 2).equals({ lat: 4000, lng: 1500 }));
  assert.equal(CRS.Simple.scale(2), 4);
});

test("Simple maps use Euclidean units and viewport-local projection", () => {
  const map = new Orihon(new FakeElement(), { crs: "Simple", center: { lat: 200, lng: 300 }, zoom: 0, minZoom: -5, controls: false });
  assert.equal(map.crs, CRS.Simple);
  assert.deepEqual(map.latLngToContainerPoint({ lat: 200, lng: 300 }).toArray(), [400, 300]);
  assert.equal(map.distance({ lat: 0, lng: 0 }, { lat: 3, lng: 4 }), 5);
  map.fitWorld({ padding: 0 });
  assert.deepEqual([map.getCenter().lat, map.getCenter().lng], [128, 128]);
  map.destroy();
});

test("CRS compatibility errors are typed", () => {
  const error = new CRSCompatibilityError();
  assert.equal(error.name, "CRSCompatibilityError");
  assert.equal(error.message, "WebGL layers require EPSG:3857");
});

/*
 * latLngToContainerPoint folds the pixel origin into the Point the built-in CRS
 * returns instead of allocating a second one. These pin the two things that makes
 * unsafe: handing the same Point to two callers, and writing through a Point that
 * a caller-supplied CRS still owns.
 */

test("projection results are never shared between calls", () => {
  const map = new Orihon(new FakeElement(), { center: { lat: 51.5, lng: -0.12 }, zoom: 12, controls: false });
  const first = map.latLngToContainerPoint({ lat: 51.5, lng: -0.12 });
  const before = first.toArray();
  const second = map.latLngToContainerPoint({ lat: 48.85, lng: 2.35 });
  assert.notEqual(first, second, "each call must return its own Point");
  assert.deepEqual(first.toArray(), before, "an earlier result must not move");
  assert.notEqual(map.latLngToLayerPoint({ lat: 51.5, lng: -0.12 }), first);
  map.destroy();
});

test("a caller-supplied CRS keeps ownership of the Point it returns", () => {
  const cached = new Point(4096, 2048);
  let handedOut = 0;
  const crs = {
    code: "EPSG:3857",
    // Deliberately hostile: hands back the same instance every time, which is legal
    // for an implementer and would break if the map wrote through it.
    project() { handedOut++; return cached; },
    unproject: CRS.EPSG3857.unproject,
    scale: CRS.EPSG3857.scale,
    wrapLng: true,
    wrapLat: false
  };
  const map = new Orihon(new FakeElement(), { crs, center: { lat: 0, lng: 0 }, zoom: 3, controls: false });
  map.latLngToContainerPoint({ lat: 10, lng: 20 });
  map.latLngToContainerPoint({ lat: 30, lng: 40 });
  assert.ok(handedOut >= 2, "the custom CRS should have been consulted");
  assert.deepEqual(cached.toArray(), [4096, 2048], "the map must not write through a borrowed Point");
  map.destroy();
});
