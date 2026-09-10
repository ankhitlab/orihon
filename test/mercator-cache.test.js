import test from "node:test";
import assert from "node:assert/strict";
import { CameraTransform, fillMercator01, fillMercator01From } from "../dist/layers/mercator-cache.js";
import { Orihon } from "../dist/map.js";

class FakeClassList { add() {} remove() {} toggle() {} contains() { return false; } }
class FakeElement {
  constructor() {
    this.children = []; this.classList = new FakeClassList(); this.style = {};
    this.attributes = new Map(); this.listeners = new Map();
    this.clientWidth = 800; this.clientHeight = 600;
  }
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

/*
 * The cache only earns its keep if it is indistinguishable from projecting directly.
 * These compare it against latLngToContainerPoint rather than against a fixed table,
 * so a change to the projection cannot leave the two silently disagreeing.
 */

test("cached mercator reproduces latLngToContainerPoint exactly across zooms", () => {
  const count = 400;
  const lat = new Float64Array(count);
  const lng = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    lat[i] = -89 + (178 * i) / count;
    lng[i] = -180 + (360 * ((i * 7919) % count)) / count;
  }
  const mx = new Float64Array(count);
  const my = new Float64Array(count);
  fillMercator01(lat, lng, mx, my, count);

  for (const zoom of [0, 5, 11, 16, 19]) {
    const map = new Orihon(new FakeElement(), { center: { lat: 51.5, lng: -0.12 }, zoom, controls: false });
    const camera = CameraTransform.of(map);
    assert.ok(camera, "Web Mercator maps must get a transform");
    for (let i = 0; i < count; i++) {
      const reference = map.latLngToContainerPoint({ lat: lat[i], lng: lng[i] });
      assert.equal(camera.x(mx[i]), reference.x, `x at zoom ${zoom}, index ${i}`);
      assert.equal(camera.y(my[i]), reference.y, `y at zoom ${zoom}, index ${i}`);
    }
    map.destroy();
  }
});

test("the object-list form agrees with the parallel-array form", () => {
  const items = [
    { lat: 0, lng: 0 },
    { lat: 51.5, lng: -0.12 },
    { lat: -33.87, lng: 151.21 },
    { lat: 85.1, lng: 179.9 },
    { lat: -85.1, lng: -179.9 }
  ];
  const lat = Float64Array.from(items, (i) => i.lat);
  const lng = Float64Array.from(items, (i) => i.lng);

  const a = { mx: new Float64Array(items.length), my: new Float64Array(items.length) };
  const b = { mx: new Float64Array(items.length), my: new Float64Array(items.length) };
  fillMercator01(lat, lng, a.mx, a.my, items.length);
  fillMercator01From(items, b.mx, b.my, items.length);

  assert.deepEqual([...b.mx], [...a.mx]);
  assert.deepEqual([...b.my], [...a.my]);
});

test("a non-Mercator CRS gets no transform, so callers keep projecting directly", () => {
  const map = new Orihon(new FakeElement(), { crs: "Simple", center: { lat: 200, lng: 300 }, zoom: 0, minZoom: -5, controls: false });
  assert.equal(CameraTransform.of(map), null);
  map.destroy();
});

test("latitudes beyond the Mercator limit clamp the same way the projection does", () => {
  const map = new Orihon(new FakeElement(), { center: { lat: 0, lng: 0 }, zoom: 4, controls: false });
  const camera = CameraTransform.of(map);
  const items = [{ lat: 89.9, lng: 10 }, { lat: -89.9, lng: -10 }, { lat: 0, lng: 200 }];
  const mx = new Float64Array(items.length);
  const my = new Float64Array(items.length);
  fillMercator01From(items, mx, my, items.length);
  for (let i = 0; i < items.length; i++) {
    const reference = map.latLngToContainerPoint(items[i]);
    assert.equal(camera.x(mx[i]), reference.x);
    assert.equal(camera.y(my[i]), reference.y);
  }
  map.destroy();
});
