import test from "node:test";
import assert from "node:assert/strict";
import React, { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { Map as OrihonMap } from "../dist/react/map.js";
import { ObjectManager } from "../dist/react/object-manager.js";

test("React Map rejects removed camera units before forwarding DOM props", () => {
  assert.throws(() => OrihonMap({ center: { lat: 0, lng: 0 }, zoom: 4, zoomAnimationDuration: 0.25 }), /zoomAnimationDurationMs/);
});

test("React Map survives Strict Mode without leaking map instances", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  let creates = 0;
  let removes = 0;
  let current;
  const ready = (map) => {
    creates++;
    current = map;
    // `destroy()` is the real teardown the binding calls; `remove()` is its
    // documented ecosystem alias, asserted separately below.
    assert.equal(typeof map.remove, "function");
    const original = map.destroy.bind(map);
    map.destroy = () => { removes++; return original(); };
  };
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(StrictMode, null,
      React.createElement(OrihonMap, { center: { lat: 10, lng: 20 }, zoom: 4, zoomAnimationDurationMs: 125, controls: false, onMapReady: ready, style: { height: 300 } })
    ));
  });
  assert.equal(creates, 2);
  assert.equal(current.options.zoomAnimationDurationMs, 125);
  assert.equal(removes, 1);
  assert.equal(document.querySelectorAll(".oh-viewport").length, 1);

  await act(async () => {
    root.render(React.createElement(StrictMode, null,
      React.createElement(OrihonMap, { center: { lat: 11, lng: 21 }, zoom: 5, controls: false, onMapReady: ready, style: { height: 300 } })
    ));
  });
  assert.equal(creates, 2);
  assert.equal(current.getZoom(), 5);
  assert.ok(current.getCenter().equals({ lat: 11, lng: 21 }));

  await act(async () => { root.unmount(); });
  assert.equal(removes, 2);
  assert.equal(document.querySelectorAll(".oh-viewport").length, 0);
  dom.window.close();
  delete globalThis.ResizeObserver;
});

test("React ObjectManager keeps id-diffed objects through Strict Mode replay", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let manager;
  let subscriptions = 0;
  const instances = [];
  const source = {
    getSnapshot: () => ({ version: 0, features: [] }),
    subscribe() { subscriptions++; return () => { subscriptions--; }; }
  };
  const objects = [{ id: 1, coordinates: ({ lat: 10, lng: 20 }) }, { id: 2, coordinates: ({ lat: 11, lng: 21 }) }];
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(StrictMode, null,
      React.createElement(OrihonMap, { center: { lat: 10, lng: 20 }, zoom: 4, controls: false },
        React.createElement(ObjectManager, { objects, source, clusterRenderer: "dom", onReady: (value) => { manager = value; instances.push(value); } })
      )
    ));
  });
  assert.equal(manager.getObjects().length, 2);
  assert.equal(subscriptions, 1);
  assert.ok(instances.slice(0, -1).every((value) => value.isDestroyed));
  await act(async () => { root.unmount(); });
  assert.equal(manager.map, null);
  assert.equal(manager.isDestroyed, true);
  assert.equal(subscriptions, 0);
  dom.window.close();
  delete globalThis.ResizeObserver;
});

function withReactDom(run) {
  return async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>", { pretendToBeVisual: true });
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.Node = dom.window.Node;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
    globalThis.cancelAnimationFrame = clearTimeout;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await run(dom);
    } finally {
      dom.window.close();
      delete globalThis.ResizeObserver;
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    }
  };
}

test("React Map syncs maxZoom, minZoom, maxBounds and behaviors after mount", withReactDom(async () => {
  let map;
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(OrihonMap, {
      center: { lat: 10, lng: 20 },
      zoom: 4,
      controls: false,
      maxZoom: 12,
      onMapReady: (value) => { map = value; }
    }));
  });
  assert.equal(map.options.maxZoom, 12);

  await act(async () => {
    root.render(React.createElement(OrihonMap, {
      center: { lat: 10, lng: 20 },
      zoom: 4,
      controls: false,
      minZoom: 3,
      maxZoom: 8,
      maxBounds: [{ lat: 0, lng: 0 }, { lat: 20, lng: 20 }],
      behaviors: { drag: false, scrollZoom: false },
      onMapReady: (value) => { map = value; }
    }));
  });

  assert.equal(map.options.minZoom, 3);
  assert.equal(map.options.maxZoom, 8);
  assert.ok(map.getMaxBounds());
  assert.equal(map.behaviors.isEnabled("drag"), false);
  assert.equal(map.behaviors.isEnabled("scrollZoom"), false);
  assert.equal(map.behaviors.isEnabled("dblClick"), true);

  await act(async () => { root.unmount(); });
}));

test("React Marker syncs color and draggable after mount", withReactDom(async () => {
  const { Marker } = await import("../dist/react/layers.js");
  let map;
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(OrihonMap, {
      center: { lat: 10, lng: 20 },
      zoom: 4,
      controls: false,
      onMapReady: (value) => { map = value; }
    }, React.createElement(Marker, { position: { lat: 10, lng: 20 }, color: "#111111" })));
  });

  const markerLayer = [...map.layers][0];
  assert.equal(markerLayer.options.color, "#111111");
  assert.equal(markerLayer.isDraggable(), false);

  await act(async () => {
    root.render(React.createElement(OrihonMap, {
      center: { lat: 10, lng: 20 },
      zoom: 4,
      controls: false,
      onMapReady: (value) => { map = value; }
    }, React.createElement(Marker, {
      position: { lat: 10, lng: 20 },
      color: "#22c55e",
      draggable: true
    })));
  });

  assert.equal(markerLayer.options.color, "#22c55e");
  assert.equal(markerLayer.isDraggable(), true);

  await act(async () => { root.unmount(); });
}));

test("React ObjectManager syncs clusterize after mount", withReactDom(async () => {
  let manager;
  const objects = [{ id: 1, coordinates: ({ lat: 10, lng: 20 }) }];
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(OrihonMap, { center: { lat: 10, lng: 20 }, zoom: 4, controls: false },
      React.createElement(ObjectManager, {
        objects,
        clusterize: false,
        clusterRenderer: "dom",
        onReady: (value) => { manager = value; }
      })
    ));
  });
  assert.equal(manager.options.clusterize, false);

  await act(async () => {
    root.render(React.createElement(OrihonMap, { center: { lat: 10, lng: 20 }, zoom: 4, controls: false },
      React.createElement(ObjectManager, {
        objects,
        clusterize: true,
        clusterRenderer: "dom",
        onReady: (value) => { manager = value; }
      })
    ));
  });
  assert.equal(manager.options.clusterize, true);

  await act(async () => { root.unmount(); });
}));

test("React Popup rebinds when options change", withReactDom(async () => {
  const { Marker } = await import("../dist/react/layers.js");
  const { Popup } = await import("../dist/react/overlays.js");
  let map;
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(OrihonMap, {
      center: { lat: 10, lng: 20 },
      zoom: 4,
      controls: false,
      onMapReady: (value) => { map = value; }
    }, React.createElement(Marker, { position: { lat: 10, lng: 20 } },
      React.createElement(Popup, { closeButton: true }, "Hello")
    )));
  });

  const markerLayer = [...map.layers][0];
  assert.equal(markerLayer.getPopup()?.options.closeButton, true);

  await act(async () => {
    root.render(React.createElement(OrihonMap, {
      center: { lat: 10, lng: 20 },
      zoom: 4,
      controls: false,
      onMapReady: (value) => { map = value; }
    }, React.createElement(Marker, { position: { lat: 10, lng: 20 } },
      React.createElement(Popup, { closeButton: false }, "Hello")
    )));
  });

  assert.equal(markerLayer.getPopup()?.options.closeButton, false);

  await act(async () => { root.unmount(); });
}));
