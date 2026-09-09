import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createMap } from "../dist/core.js";
import { objectManager } from "../dist/object-manager-entry.js";

/*
 * The scene sync builds one entry per object in view, each carrying whatever icon, label,
 * path or polygon the object resolved to. Clusters draw through the cluster layer and their
 * singletons through the point layer, so for a plain clustered point set those entries hold
 * nothing anyone reads — and the guard used to build them anyway, on the strength of the
 * visualization not being "objects". These pin the guard both ways.
 */

function installDom(width = 800, height = 600) {
  const dom = new JSDOM("<!doctype html><div id='map'></div>", { pretendToBeVisual: true, url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLDivElement = dom.window.HTMLDivElement;
  globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
  globalThis.Image = dom.window.Image;
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  const el = document.getElementById("map");
  Object.defineProperty(el, "clientWidth", { get: () => width });
  Object.defineProperty(el, "clientHeight", { get: () => height });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height });
  return el;
}

const points = (n) => Array.from({ length: n }, (_, i) => ({
  id: i,
  coordinates: { lat: 50 + (i % 40) / 100, lng: 14 + Math.floor(i / 40) / 100 },
  properties: { active: i % 3 !== 0 }
}));

const settle = () => new Promise((r) => setTimeout(r, 30));

test("a plain clustered point set builds no scene entries", async () => {
  const map = createMap(installDom(), { center: { lat: 50.2, lng: 14.2 }, zoom: 9, controls: false });
  const manager = objectManager({ clusterize: true, visualization: "clusters", marker: { interactive: false } });
  manager.add(points(400));
  manager.addTo(map);
  await settle();
  assert.equal(manager._sceneEntries.size, 0, "nothing in the scene reads an entry for an undecorated cluster member");
  assert.ok(manager.getStats().objects === 400, "the objects are still there");
  map.destroy();
});

test("clusters with a style resolver keep their scene entries", async () => {
  const map = createMap(installDom(), { center: { lat: 50.2, lng: 14.2 }, zoom: 9, controls: false });
  const manager = objectManager({
    clusterize: true,
    visualization: "clusters",
    marker: { interactive: false },
    // A resolver is what can hand an object an icon or a label, so the scene has to run.
    style: () => ({ label: { text: "x" } })
  });
  manager.add(points(400));
  manager.addTo(map);
  await settle();
  assert.ok(manager._sceneEntries.size > 0, "decorated objects still get their scene entries");
  map.destroy();
});

test("the objects visualization is unchanged by the guard", async () => {
  const map = createMap(installDom(), { center: { lat: 50.2, lng: 14.2 }, zoom: 9, controls: false });
  const manager = objectManager({ visualization: "objects", marker: { interactive: false } });
  manager.add(points(400));
  manager.addTo(map);
  await settle();
  // Undecorated points in objects mode never built entries either; that must stay true.
  assert.equal(manager._sceneEntries.size, 0);
  map.destroy();
});
