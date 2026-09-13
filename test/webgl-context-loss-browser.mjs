import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createOrihonTestServer } from "../scripts/browser-test-server.mjs";

const server = createOrihonTestServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Unable to bind WebGL context-loss browser server");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.goto(`http://127.0.0.1:${address.port}/`);

  const result = await page.evaluate(async () => {
    // Force preserveDrawingBuffer so contexts stay inspectable after composite.
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, attrs) {
      if (type === "webgl" || type === "webgl2") {
        return originalGetContext.call(this, type, { ...(attrs || {}), preserveDrawingBuffer: true });
      }
      return originalGetContext.call(this, type, attrs);
    };

    const api = await import("/dist/orihon.esm.js");
    const host = document.createElement("div");
    host.style.cssText = "width:640px;height:480px";
    document.body.appendChild(host);
    const map = api.createMap(host, { center: { lat: 50, lng: 10 }, zoom: 5, controls: false });
    map.invalidateSize();
    const points = [];
    for (let i = 0; i < 2_000; i += 1) {
      points.push({ lat: 40 + (i % 50) * 0.1, lng: 0 + Math.floor(i / 50) * 0.2 });
    }
    const layer = api.webglPointLayer(points, { pointSize: 3, fallbackCanvas: false }).addTo(map);
    await new Promise((resolve) => setTimeout(resolve, 400));

    if (layer.renderer !== "webgl") {
      return { skipped: true, reason: `renderer=${layer.renderer}` };
    }
    if (typeof layer.loseContextForTest !== "function") {
      return { skipped: true, reason: "loseContextForTest missing" };
    }

    const states = [];
    layer.on("gpulost", () => states.push("gpulost"));
    layer.on("gpurestored", (event) => states.push(event.ok ? "gpurestored-ok" : "gpurestored-fail"));

    layer.loseContextForTest();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const afterLost = { gpuState: layer.gpuState, renderer: layer.renderer, pointCount: layer.points.length };

    layer.restoreContextForTest();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const afterRestore = {
      gpuState: layer.gpuState,
      renderer: layer.renderer,
      pointCount: layer.points.length,
      hasProgram: Boolean(layer.program),
      hasGl: Boolean(layer.gl)
    };

    map.remove();
    return { skipped: false, states, afterLost, afterRestore };
  });

  if (result.skipped) {
    console.log(`webgl-context-loss-browser: skipped (${result.reason})`);
  } else {
    assert.equal(result.afterLost.gpuState, "lost");
    assert.equal(result.afterLost.renderer, "none");
    assert.equal(result.afterLost.pointCount, 4_000, "CPU packs survive context loss");
    assert.ok(result.states.includes("gpulost"));
    assert.equal(result.afterRestore.gpuState, "active");
    assert.equal(result.afterRestore.renderer, "webgl");
    assert.equal(result.afterRestore.pointCount, 4_000);
    assert.equal(result.afterRestore.hasGl, true);
    assert.equal(result.afterRestore.hasProgram, true);
    assert.ok(result.states.includes("gpurestored-ok"));
    console.log("webgl-context-loss-browser: ok");
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
