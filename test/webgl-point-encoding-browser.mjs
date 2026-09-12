/*
 * Camera-relative mercator is encoded straight out of the absolute buffer into a
 * small upload window instead of being stored per point. None of that is visible
 * to the node tests — there is no WebGL there — so this checks what would really
 * break: whether points land on the right pixels, whether a patch moves one, and
 * whether they survive the re-encode that a long pan forces by moving the
 * reference origin.
 *
 * The layer's context is created without `preserveDrawingBuffer`, so the test
 * patches `getContext` before the layer exists. That changes nothing about the
 * layer's own logic; it only keeps the buffer readable after compositing.
 */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createOrihonTestServer } from "../scripts/browser-test-server.mjs";

const server = createOrihonTestServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to bind point-encoding server");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);

  const result = await page.evaluate(async () => {
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (type === "webgl" || type === "webgl2") {
        return nativeGetContext.call(this, type, { ...(attrs || {}), preserveDrawingBuffer: true });
      }
      return nativeGetContext.call(this, type, attrs);
    };

    const api = await import("/dist/orihon.esm.js");
    const host = document.createElement("div");
    host.style.cssText = "width:640px;height:480px";
    document.body.appendChild(host);
    const map = api.createMap(host, { center: { lat: 50, lng: 10 }, zoom: 6, controls: false });

    /** Spread out enough that each point owns its own patch of canvas. */
    const points = [
      { lat: 50, lng: 10 },
      { lat: 50.4, lng: 10 },
      { lat: 49.6, lng: 10 },
      { lat: 50, lng: 10.8 },
      { lat: 50, lng: 9.2 }
    ];
    const layer = api
      .webglPointLayer(points, { pointSize: 11, color: "#ff0000", opacity: 1, maxDpr: 1 })
      .addTo(map);
    const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));
    await settle();

    const read = () => {
      const gl = layer.gl;
      const canvas = layer.canvas;
      const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return { data, width: canvas.width, height: canvas.height };
    };

    /**
     * Is anything drawn near where the map projects `latlng`? The canvas is offset
     * by its overscan pad, and readPixels returns rows bottom-up.
     */
    const drawnAt = (image, latlng, radius = 9) => {
      const canvas = layer.canvas;
      const pad = -parseFloat(canvas.style.left || "0") || 0;
      const scale = canvas.width / (parseFloat(canvas.style.width) || canvas.width);
      const container = map.latLngToContainerPoint(latlng);
      const cx = Math.round((container.x + pad) * scale);
      const cyTop = Math.round((container.y + pad) * scale);
      const cy = image.height - 1 - cyTop;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
          if (image.data[(y * image.width + x) * 4 + 3] > 40) return true;
        }
      }
      return false;
    };

    const litCount = (image) => {
      let lit = 0;
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i] > 40) lit++;
      return lit;
    };

    const initial = read();
    const initialHits = points.map((p) => drawnAt(initial, p));
    const initialLit = litCount(initial);

    // Move one point a long way: exercises the patch path, which now encodes from
    // the absolute buffer at upload time rather than from a stored copy.
    const moved = { lat: 50.4, lng: 10.8 };
    layer.patchPoint(1, moved.lat, moved.lng);
    // A patch alone does not necessarily repaint: with the camera unchanged
    // `render()` takes its shortcut, which is true of the old code too. Nudge the
    // camera so the buffer is actually drawn, then check what landed in it.
    map.panBy([2, 0]);
    await settle();
    const patched = read();
    const patchedHit = drawnAt(patched, moved);
    const vacated = drawnAt(patched, { lat: 50.4, lng: 10 });

    // Pan far past the 8192px drift threshold and back, forcing a new reference
    // origin and a full re-upload streamed out of the absolute buffer.
    map.setView({ lat: 20, lng: -40 }, 6);
    await settle(600);
    map.setView({ lat: 50, lng: 10 }, 6);
    await settle(600);
    const reencoded = read();
    const afterPan = [points[0], moved, points[2], points[3], points[4]];
    const reencodedHits = afterPan.map((p) => drawnAt(reencoded, p));

    // Hit-testing reads degrees, which an interactive layer now derives from the
    // mercator buffer rather than storing. Check a pick still lands on the right point.
    const probe = { lat: 49.6, lng: 10 };
    const pickLayer = api
      .webglPointLayer(points, { pointSize: 11, interactive: true, maxDpr: 1 })
      .addTo(map);
    await settle();
    const probePoint = map.latLngToContainerPoint(probe);
    const hostBox = host.getBoundingClientRect();
    const hit = pickLayer.hitTestAt(hostBox.left + probePoint.x, hostBox.top + probePoint.y, 8);
    const pickIndexSize = pickLayer.getStats().pickIndex;
    const hitLatLng = hit ? { lat: pickLayer.points[hit.index * 2], lng: pickLayer.points[hit.index * 2 + 1] } : null;
    pickLayer.remove();

    return {
      hitIndex: hit ? hit.index : -1,
      hitLatLng,
      pickIndexSize,
      initialHits,
      initialLit,
      patchedHit,
      vacated,
      reencodedHits,
      reencodedLit: litCount(reencoded),
      points: layer.getStats().points,
      mercatorLength: layer.mercator.length,
      absLength: layer.getMercatorAbs().length
    };
  });

  assert.ok(result.initialLit > 0, "the layer must actually draw something");
  assert.deepEqual(
    result.initialHits,
    [true, true, true, true, true],
    "every point must be drawn where the map projects it"
  );
  assert.equal(result.patchedHit, true, "patchPoint must upload the moved position");
  assert.equal(result.vacated, false, "the point must no longer be drawn at its old position");
  assert.deepEqual(
    result.reencodedHits,
    [true, true, true, true, true],
    "points must survive the reference re-encode a long pan forces"
  );
  assert.equal(result.pickIndexSize, 5, "an interactive layer must still index every point");
  assert.equal(result.hitIndex, 2, "hit-testing must find the point under the cursor");
  assert.ok(
    Math.abs(result.hitLatLng.lat - 49.6) < 1e-4 && Math.abs(result.hitLatLng.lng - 10) < 1e-4,
    `derived degrees must match the input, got ${JSON.stringify(result.hitLatLng)}`
  );
  assert.equal(result.points, 5);
  assert.equal(result.mercatorLength, 10, "the compatibility getter still reports 2 floats per point");
  assert.equal(result.absLength, 10);

  console.log(
    `webgl point encoding browser ok · ${result.initialLit} lit px initially, ${result.reencodedLit} after re-encode`
  );
} finally {
  await browser.close();
  server.close();
}
