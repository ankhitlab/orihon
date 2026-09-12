import test from "node:test";
import assert from "node:assert/strict";
import { webglPointLayer, projectMercator01 } from "../dist/full-entry.js";

/** Deterministic spread of valid coordinates. */
function makePoints(count) {
  const points = new Array(count);
  for (let i = 0; i < count; i++) {
    points[i] = { lat: -60 + ((i * 7) % 12000) / 100, lng: -170 + ((i * 13) % 34000) / 100 };
  }
  return points;
}

function* iterate(points) {
  for (const point of points) yield point;
}

/* --------------------------------------------------- source object retention - */

test("an interactive layer keeps source objects for a small iterable", () => {
  const points = makePoints(1000);
  const layer = webglPointLayer(iterate(points), { interactive: true });

  assert.equal(layer.points.length, 2000);
  assert.equal(layer.pointData.length, 1000);
  assert.equal(layer.pointData[0], points[0]);
  assert.equal(layer.pointData[999], points[999]);
});

test("an interactive layer stops retaining source objects past the cap, even without a length", () => {
  // The cap used to be checked with `points.length`, which an iterable does not have,
  // so a generator of a million objects was retained in full.
  const points = makePoints(40_001);
  const fromIterable = webglPointLayer(iterate(points), { interactive: true });
  const fromArray = webglPointLayer(points, { interactive: true });

  assert.equal(fromIterable.points.length, 80_002);
  assert.deepEqual(fromIterable.pointData, [], "iterable over the cap must not retain sources");
  assert.deepEqual(fromArray.pointData, [], "array over the cap behaves the same way");
});

test("a non-interactive layer never retains source objects", () => {
  const points = makePoints(100);
  const layer = webglPointLayer(iterate(points), { interactive: false });

  assert.equal(layer.points.length, 200);
  assert.deepEqual(layer.pointData, []);
});

/* ------------------------------------------------------------ packed ingest - */

test("an iterable packs identically to the equivalent array across buffer growth", () => {
  // 5 000 pairs crosses several doublings of the growable store.
  const points = makePoints(5000);
  const fromArray = webglPointLayer(points, { interactive: false });
  const fromIterable = webglPointLayer(iterate(points), { interactive: false });

  assert.equal(fromIterable.points.length, fromArray.points.length);
  assert.deepEqual(
    Array.from(fromIterable.points),
    Array.from(fromArray.points),
    "lat/lng must not drift when the source has no length"
  );
  assert.deepEqual(Array.from(fromIterable.getMercator64()), Array.from(fromArray.getMercator64()));
});

test("a sized iterable that is not an array packs correctly", () => {
  const points = makePoints(300);
  const layer = webglPointLayer(new Set(points), { interactive: false });

  assert.equal(layer.points.length, 600);
  assert.equal(layer.points[0], Math.fround(points[0].lat));
});

test("invalid entries are skipped without leaving gaps in the packed buffers", () => {
  const points = makePoints(10);
  const mixed = [...points.slice(0, 5), {}, { lat: Number.NaN, lng: 0 }, ...points.slice(5)];
  const layer = webglPointLayer(iterate(mixed), { interactive: false });

  assert.equal(layer.points.length, 20, "two invalid entries drop out");
  assert.deepEqual(
    Array.from(layer.points),
    Array.from(webglPointLayer(points, { interactive: false }).points)
  );
});

test("setDataAsync packs an unsized source the same way as an array", async () => {
  const points = makePoints(3000);
  const fromArray = webglPointLayer([], { interactive: false });
  const fromIterable = webglPointLayer([], { interactive: false });

  await fromArray.setDataAsync(points, { chunkSize: 512 });
  await fromIterable.setDataAsync(iterate(points), { chunkSize: 512 });

  assert.equal(fromIterable.points.length, 6000);
  assert.deepEqual(Array.from(fromIterable.points), Array.from(fromArray.points));
  assert.deepEqual(Array.from(fromIterable.getMercator64()), Array.from(fromArray.getMercator64()));
});

/* ------------------------------------------------------- adopted buffer safety - */

/** Pack points the way ObjectManager does before handing them over with `adopt`. */
function pack(points) {
  const latlng = new Float32Array(points.length * 2);
  const merc64 = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    latlng[i * 2] = points[i].lat;
    latlng[i * 2 + 1] = points[i].lng;
    merc64[i * 2] = points[i].lat / 180;
    merc64[i * 2 + 1] = points[i].lng / 360;
  }
  return { latlng, merc64 };
}

test("setData does not write over buffers it adopted from the caller", () => {
  // ObjectManager hands its packs over with `adopt` and keeps the same references,
  // so reusing them for an unrelated dataset would corrupt its state.
  const owned = pack(makePoints(500));
  const latlngCopy = Float32Array.from(owned.latlng);
  const merc64Copy = Float64Array.from(owned.merc64);

  const layer = webglPointLayer([], { interactive: false });
  layer.setPackedData(owned.latlng, owned.merc64, { adopt: true });

  // Smaller than the adopted buffers, so the old code reused them in place.
  layer.setData(makePoints(100));

  assert.equal(layer.points.length, 200);
  assert.deepEqual(Array.from(owned.latlng), Array.from(latlngCopy), "adopted lat/lng must be untouched");
  assert.deepEqual(Array.from(owned.merc64), Array.from(merc64Copy), "adopted mercator must be untouched");
});

test("an adopted buffer survives a replacement fed from an iterable too", () => {
  const owned = pack(makePoints(500));
  const latlngCopy = Float32Array.from(owned.latlng);

  const layer = webglPointLayer([], { interactive: false });
  layer.setPackedData(owned.latlng, owned.merc64, { adopt: true });
  layer.setData(iterate(makePoints(100)));

  assert.equal(layer.points.length, 200);
  assert.deepEqual(Array.from(owned.latlng), Array.from(latlngCopy));
});

/* --------------------------------------------------------- mercator precision - */

test("f32 mercator halves the derived mercator, and degree-fed data keeps its degrees exact", () => {
  const points = makePoints(1000);
  const wide = webglPointLayer(points, { interactive: false });
  const narrow = webglPointLayer(points, { interactive: false, mercatorPrecision: "f32" });

  assert.ok(wide.getMercatorAbs() instanceof Float64Array);
  assert.ok(narrow.getMercatorAbs() instanceof Float32Array);
  assert.equal(narrow.getMercatorAbs().byteLength, wide.getMercatorAbs().byteLength / 2);

  // Data that arrived as degrees is stored as float64 degrees and projected on the GPU;
  // the mercator is a derived copy for CPU readers. So the option narrows that copy but
  // cannot touch the degrees handed back — they are the same under either width.
  const wideDeg = wide.points;
  const narrowDeg = narrow.points;
  assert.equal(narrowDeg.length, wideDeg.length);
  assert.deepEqual([...narrowDeg], [...wideDeg], "degrees never pass through the mercator, so its width cannot show here");
  for (let i = 0; i < points.length; i++) {
    assert.equal(narrowDeg[i * 2], Math.fround(points[i].lat), `lat ${i} is the input narrowed to float32, nothing more`);
    assert.equal(narrowDeg[i * 2 + 1], Math.fround(points[i].lng), `lng ${i} is the input narrowed to float32, nothing more`);
  }
});

test("packed data still derives its degrees from the mercator, so f32 storage shows there", () => {
  // The old contract, kept for callers who hand over projected data: there are no
  // degrees to keep, so `points` is an inverse projection of whatever width was stored.
  const points = makePoints(1000);
  const merc = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    const m = projectMercator01(points[i].lat, points[i].lng);
    merc[i * 2] = m.x;
    merc[i * 2 + 1] = m.y;
  }
  const wide = webglPointLayer([], { interactive: false });
  const narrow = webglPointLayer([], { interactive: false, mercatorPrecision: "f32" });
  wide.setPackedData(null, merc);
  narrow.setPackedData(null, Float32Array.from(merc));
  const wideDeg = wide.points;
  const narrowDeg = narrow.points;
  let worst = 0;
  for (let i = 0; i < wideDeg.length; i++) worst = Math.max(worst, Math.abs(wideDeg[i] - narrowDeg[i]));
  assert.ok(worst < 1e-4, `degrees drifted ${worst}°, expected well under 1e-4`);
  assert.ok(worst > 0, "f32 must actually quantise on the packed path, otherwise this proves nothing");
});

test("f64 mercator round-trips degrees back to float32 exactness", () => {
  // Degrees are no longer stored separately, so the derived values must still match
  // what float32 storage of the original input would have produced.
  const points = makePoints(500);
  const layer = webglPointLayer(points, { interactive: false });
  const degrees = layer.points;

  let worst = 0;
  for (let i = 0; i < points.length; i++) {
    worst = Math.max(
      worst,
      Math.abs(degrees[i * 2] - points[i].lat),
      Math.abs(degrees[i * 2 + 1] - points[i].lng)
    );
  }
  assert.ok(worst < 1e-5, `float64 round-trip drifted ${worst}°`);
});

test("f32 mercator stays within a pixel of f64 up to zoom 16", () => {
  const points = makePoints(500);
  const wide = webglPointLayer(points, { interactive: false }).getMercatorAbs();
  const narrow = webglPointLayer(points, {
    interactive: false,
    mercatorPrecision: "f32"
  }).getMercatorAbs();

  let worst = 0;
  for (let i = 0; i < wide.length; i++) worst = Math.max(worst, Math.abs(wide[i] - narrow[i]));

  // world pixels = 256 * 2 ** zoom
  assert.ok(worst * 256 * 2 ** 16 < 1, `zoom 16 drift ${worst * 256 * 2 ** 16}px must stay under 1px`);
  assert.ok(worst > 0, "f32 must actually quantise, otherwise this test proves nothing");
});

test("getMercator64 still returns float64 under f32 storage", () => {
  const layer = webglPointLayer(makePoints(50), { interactive: false, mercatorPrecision: "f32" });
  const wide = layer.getMercator64();

  assert.ok(wide instanceof Float64Array, "the documented return type must not change");
  assert.equal(wide.length, 100);
  assert.deepEqual(Array.from(wide), Array.from(layer.getMercatorAbs()));
});

test("an iterable source honours f32 precision through the growable store", () => {
  const points = makePoints(3000);
  const layer = webglPointLayer(iterate(points), { interactive: false, mercatorPrecision: "f32" });

  assert.ok(layer.getMercatorAbs() instanceof Float32Array);
  assert.equal(layer.points.length, 6000);
});

test("setDataAsync honours f32 precision for sized and unsized sources", async () => {
  const points = makePoints(2000);
  const sized = webglPointLayer([], { interactive: false, mercatorPrecision: "f32" });
  const unsized = webglPointLayer([], { interactive: false, mercatorPrecision: "f32" });

  await sized.setDataAsync(points, { chunkSize: 512 });
  await unsized.setDataAsync(iterate(points), { chunkSize: 512 });

  assert.ok(sized.getMercatorAbs() instanceof Float32Array);
  assert.ok(unsized.getMercatorAbs() instanceof Float32Array);
  assert.deepEqual(Array.from(unsized.getMercatorAbs()), Array.from(sized.getMercatorAbs()));
});

test("setPackedData copies rather than adopting a buffer of the wrong precision", () => {
  const owned = pack(makePoints(400));
  const merc64Copy = Float64Array.from(owned.merc64);

  // An f32 layer cannot take ownership of a float64 buffer.
  const layer = webglPointLayer([], { interactive: false, mercatorPrecision: "f32" });
  layer.setPackedData(owned.latlng, owned.merc64, { adopt: true });

  assert.ok(layer.getMercatorAbs() instanceof Float32Array, "storage must stay f32");
  assert.equal(layer.points.length, 800);

  // Not adopted, so a later replacement must leave the caller's buffer alone.
  layer.setData(makePoints(100));
  assert.deepEqual(Array.from(owned.merc64), Array.from(merc64Copy));
});

/* --------------------------------------------------------------------- clear - */

test("clear empties the pick index instead of leaving a dataset behind", () => {
  // The rest of what clear() releases — `_latlngBuf`, scratch and patch buffers —
  // is private and sized off `points.length` in getStats(), so the pick index is
  // the one piece of that cleanup the public API can actually see.
  const layer = webglPointLayer(makePoints(2000), { interactive: true });
  assert.ok(layer.getStats().pickIndex > 0, "an interactive layer builds a pick index");

  layer.clear();

  assert.equal(layer.getStats().pickIndex, 0, "the pick index must be emptied too");
  assert.equal(layer.points.length, 0);
  assert.equal(layer.getLatLngBuf().length, 0);
  assert.equal(layer.getMercator64().length, 0);
  assert.deepEqual(layer.pointData, []);
});

test("a layer stays usable after clear", () => {
  const layer = webglPointLayer(makePoints(300), { interactive: false });
  layer.clear();
  layer.setData(makePoints(120));

  assert.equal(layer.points.length, 240);
  assert.deepEqual(
    Array.from(layer.points),
    Array.from(webglPointLayer(makePoints(120), { interactive: false }).points)
  );
});

test("replacing an iterable dataset with a smaller one reports the new length", () => {
  const layer = webglPointLayer(iterate(makePoints(2000)), { interactive: false });
  assert.equal(layer.points.length, 4000);

  layer.setData(iterate(makePoints(50)));
  assert.equal(layer.points.length, 100);
  assert.equal(layer.getLatLngBuf().length, 100);
  assert.equal(layer.getMercator64().length, 100);
});
