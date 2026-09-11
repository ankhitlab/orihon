import test from "node:test";
import assert from "node:assert/strict";
import { GeoJSONLayer, Marker, circleMarker } from "../dist/full-entry.js";

/**
 * `style` used to reach path features only. A layer produced by `pointToLayer`
 * kept the vector defaults until the application called `setStyle()` by hand, so
 * the documented option silently did nothing for point collections — and
 * `resetStyle()` disagreed with construction on the very same layers.
 */

const station = (name, lng, lat, trains) => ({
  type: "Feature",
  id: `s-${name}`,
  properties: { name, trains },
  geometry: { type: "Point", coordinates: [lng, lat] }
});

const STATIONS = {
  type: "FeatureCollection",
  features: [station("busy", 13.37, 52.52, 320), station("quiet", 13.41, 52.51, 40)]
};

const PAIR = {
  type: "Feature",
  id: "pair",
  properties: { name: "pair" },
  geometry: { type: "MultiPoint", coordinates: [[13.37, 52.52], [13.41, 52.51]] }
};

const dot = (feature, position) => circleMarker(position, { radiusPixels: 9 });

test("a style object reaches layers built by pointToLayer", () => {
  const layer = new GeoJSONLayer(STATIONS, {
    pointToLayer: dot,
    style: { fill: "#c1501f", fillOpacity: 0.85 }
  });

  for (const point of layer.getLayers()) {
    assert.equal(point.options.fill, "#c1501f");
    assert.equal(point.options.fillOpacity, 0.85);
    // Untouched by the style, so what pointToLayer asked for survives.
    assert.equal(point.options.radiusPixels, 9);
  }
});

test("a style function is resolved per feature for points", () => {
  const layer = new GeoJSONLayer(STATIONS, {
    pointToLayer: dot,
    style: (feature) => ({ fill: feature.properties.trains > 150 ? "#c1501f" : "#2d7285" })
  });

  const [busy, quiet] = layer.getLayers();
  assert.equal(busy.options.fill, "#c1501f");
  assert.equal(quiet.options.fill, "#2d7285");
});

test("top-level path options on the layer reach points as well", () => {
  const layer = new GeoJSONLayer(STATIONS, { pointToLayer: dot, stroke: "#0b463c", strokeWidth: 4 });

  for (const point of layer.getLayers()) {
    assert.equal(point.options.stroke, "#0b463c");
    assert.equal(point.options.strokeWidth, 4);
  }
});

test("the resolved style wins over the options pointToLayer passed", () => {
  const layer = new GeoJSONLayer(STATIONS, {
    pointToLayer: (feature, position) => circleMarker(position, { fill: "#000000", radiusPixels: 9 }),
    style: { fill: "#c1501f" }
  });

  for (const point of layer.getLayers()) {
    assert.equal(point.options.fill, "#c1501f");
    assert.equal(point.options.radiusPixels, 9);
  }
});

test("every point of a MultiPoint is styled, and the style is asked once", () => {
  let calls = 0;
  const layer = new GeoJSONLayer(PAIR, {
    pointToLayer: dot,
    style: () => {
      calls += 1;
      return { fill: "#b6820a", fillOpacity: 0.5 };
    }
  });

  const group = layer.getLayers()[0];
  const points = group.getLayers();
  assert.equal(points.length, 2);
  for (const point of points) {
    assert.equal(point.options.fill, "#b6820a");
    assert.equal(point.options.fillOpacity, 0.5);
  }
  // One feature, one question — not one per coordinate.
  assert.equal(calls, 1);
});

test("a GeometryCollection styles its point without disturbing its line", () => {
  // The collection branch resolves the style per child, which is why it is
  // reached before the shared per-feature resolution.
  const layer = new GeoJSONLayer(
    {
      type: "Feature",
      id: "mixed",
      properties: { name: "mixed" },
      geometry: {
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [13.37, 52.52] },
          { type: "LineString", coordinates: [[13.37, 52.52], [13.41, 52.51]] }
        ]
      }
    },
    { pointToLayer: dot, style: { fill: "#c1501f", stroke: "#0b463c" } }
  );

  const [point, line] = layer.getLayers()[0].getLayers();
  assert.equal(point.options.fill, "#c1501f");
  assert.equal(point.options.radiusPixels, 9);
  assert.equal(line.options.stroke, "#0b463c");
});

test("a plain marker takes no path options", () => {
  // No pointToLayer, so the default is a Marker. `PathOptions` mean nothing to it
  // and must not be assigned over the glyph's own fields.
  const untouched = new Marker({ lat: 52.52, lng: 13.37 }).options;
  const layer = new GeoJSONLayer(STATIONS, { style: { fill: "#c1501f", strokeWidth: 9 } });

  for (const point of layer.getLayers()) {
    assert.ok(point instanceof Marker);
    assert.equal(point.options.fill, undefined);
    assert.equal(point.options.strokeWidth, untouched.strokeWidth);
  }
});

test("resetStyle puts back what construction resolved", () => {
  const style = (feature) => ({
    fill: feature.properties.trains > 150 ? "#c1501f" : "#2d7285",
    fillOpacity: 0.85
  });
  const layer = new GeoJSONLayer(STATIONS, { pointToLayer: dot, style });

  const constructed = layer.getLayers().map((point) => ({
    fill: point.options.fill,
    fillOpacity: point.options.fillOpacity,
    radiusPixels: point.options.radiusPixels
  }));

  layer.setStyle({ fill: "#123456", fillOpacity: 0.1 });
  assert.equal(layer.getLayers()[0].options.fill, "#123456");

  layer.resetStyle();

  // Both `setStyle` and `resetStyle` merge, here as on paths: every key the
  // feature style names comes back, and `radiusPixels` was never in play.
  layer.getLayers().forEach((point, index) => {
    assert.equal(point.options.fill, constructed[index].fill);
    assert.equal(point.options.fillOpacity, constructed[index].fillOpacity);
    assert.equal(point.options.radiusPixels, constructed[index].radiusPixels);
  });
});
