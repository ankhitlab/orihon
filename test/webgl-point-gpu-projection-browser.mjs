/*
 * Degree-fed data is projected on the GPU from float32 degree offsets; packed data is
 * projected on the CPU in float64 and uploaded as mercator offsets. Both must put a point
 * on the same pixel, and they must keep doing so at the zooms where a naive float32
 * projection falls apart — that was 1.6 px off at zoom 18 and 43 px off at 85° latitude.
 *
 * Same points, same camera, two encodings, compared by the centroid of the pixels each
 * lights. A whole-pixel disagreement anywhere fails the run.
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
if (!address || typeof address === "string") throw new Error("Unable to bind gpu-projection server");

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
    const settle = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));

    /** Lit-pixel centroid per point, found by flood-filling the canvas after a draw. */
    const centroids = (layer) => {
      const gl = layer.gl;
      const canvas = layer.canvas;
      const w = canvas.width, h = canvas.height;
      const data = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const seen = new Uint8Array(w * h);
      const blobs = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (seen[i] || data[i * 4 + 3] < 40) continue;
          let sx = 0, sy = 0, n = 0;
          const stack = [i];
          seen[i] = 1;
          while (stack.length) {
            const k = stack.pop();
            const kx = k % w, ky = (k - kx) / w;
            sx += kx; sy += ky; n++;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = kx + dx, ny = ky + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const j = ny * w + nx;
              if (seen[j] || data[j * 4 + 3] < 40) continue;
              seen[j] = 1;
              stack.push(j);
            }
          }
          blobs.push({ x: sx / n, y: sy / n, n });
        }
      }
      return blobs.sort((a, b) => a.x - b.x || a.y - b.y);
    };

    const cases = [];
    // Latitude 51.5 at zoom 18 is the everyday high-zoom case; 84.5 at zoom 20 is the
    // corner where float32 projection of absolute degrees was 170 px out.
    for (const [lat, lng, zoom] of [[51.5, -0.12, 18], [51.5, -0.12, 20], [84.5, 20, 20], [0, 0, 22]]) {
      const host = document.createElement("div");
      host.style.cssText = "width:640px;height:480px";
      document.body.appendChild(host);
      const map = api.createMap(host, { center: { lat, lng }, zoom, controls: false });
      await settle(120);

      // A cross of points a few dozen pixels apart, so each blob is its own.
      const scale = 256 * 2 ** zoom;
      const dLat = (60 / scale) * 360 * Math.cos((lat * Math.PI) / 180);
      const dLng = (60 / scale) * 360;
      const points = [
        { lat, lng },
        { lat: lat + dLat, lng },
        { lat: lat - dLat, lng },
        { lat, lng: lng + dLng },
        { lat, lng: lng - dLng }
      ];

      const gpu = api.webglPointLayer(points, { pointSize: 7, color: "#ff0000", opacity: 1, maxDpr: 1 }).addTo(map);
      await settle();
      const gpuBlobs = centroids(gpu);
      map.removeLayer(gpu);

      const merc = new Float64Array(points.length * 2);
      for (let i = 0; i < points.length; i++) {
        const m = api.projectMercator01(points[i].lat, points[i].lng);
        merc[i * 2] = m.x;
        merc[i * 2 + 1] = m.y;
      }
      const cpu = api.webglPointLayer([], { pointSize: 7, color: "#ff0000", opacity: 1, maxDpr: 1 }).addTo(map);
      cpu.setPackedData(null, merc);
      await settle();
      const cpuBlobs = centroids(cpu);

      let worst = 0;
      for (let i = 0; i < Math.min(gpuBlobs.length, cpuBlobs.length); i++) {
        worst = Math.max(worst, Math.abs(gpuBlobs[i].x - cpuBlobs[i].x), Math.abs(gpuBlobs[i].y - cpuBlobs[i].y));
      }
      cases.push({ lat, zoom, gpuBlobs: gpuBlobs.length, cpuBlobs: cpuBlobs.length, worstPx: +worst.toFixed(3) });
      map.destroy();
      host.remove();
    }
    return cases;
  });

  for (const c of result) {
    assert.equal(c.gpuBlobs, 5, `zoom ${c.zoom} lat ${c.lat}: GPU projection must draw all five points`);
    assert.equal(c.cpuBlobs, 5, `zoom ${c.zoom} lat ${c.lat}: mercator path must draw all five points`);
    assert.ok(c.worstPx < 0.5, `zoom ${c.zoom} lat ${c.lat}: the two encodings disagree by ${c.worstPx} px`);
  }
  console.log(
    "webgl gpu projection ok · " +
    result.map((c) => `z${c.zoom}@${c.lat}° Δ${c.worstPx}px`).join(" · ")
  );
} finally {
  await browser.close();
  server.close();
}
