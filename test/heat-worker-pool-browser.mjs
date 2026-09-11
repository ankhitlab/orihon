/*
 * A removed heat layer hands its worker to the next one instead of terminating it,
 * because starting one costs more than the field it computes. Two things have to hold
 * for that to be safe, and both are checked here:
 *
 *   - the reused worker answers from the new layer's points, never the old layer's,
 *   - reuse actually happens, so the saving is real rather than assumed.
 *
 * The datasets differ in density rather than position: with static evaluation the field
 * is fitted to whatever points it was given, so a cluster always lands mid-grid and its
 * location tells you nothing. Its peak value does.
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
if (!address || typeof address === "string") throw new Error("Unable to bind heat worker pool server");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);

  const result = await page.evaluate(async () => {
    const { createMap, heatLayer } = await import("/dist/advanced-entry.js");

    const host = document.createElement("div");
    host.style.width = "640px";
    host.style.height = "480px";
    document.body.appendChild(host);

    let spawned = 0;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        spawned++;
      }
    };

    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const settle = async () => { for (let i = 0; i < 3; i++) await frame(); };

    // Same footprint, different counts, so the peak of the field separates them.
    const cluster = (count) => Array.from({ length: count }, (_, i) => [
      50.08 + Math.sin(i * 0.11) * 0.02,
      14.40 + Math.cos(i * 0.11) * 0.02,
      1
    ]);

    async function run(points) {
      const map = createMap(host, { center: { lat: 50.08, lng: 14.4 }, zoom: 8, controls: false });
      const layer = heatLayer([], {
        mode: "heatmap", backend: "wasm", evaluation: "static", worker: true,
        cols: 64, rows: 48, scaleZoom: 8, radius: 20, blur: 10
      });
      await layer.setDataAsync(points);
      layer.addTo(map);
      await layer.rebuildAsync();
      await settle();
      const stats = layer.getStats();
      const out = { peak: stats.peak, usedWorker: stats.worker };
      layer.clear();
      map.removeLayer(layer);
      map.destroy();
      return out;
    }

    const dense = await run(cluster(2000));
    const sparse = await run(cluster(150));
    const denseAgain = await run(cluster(2000));

    window.Worker = NativeWorker;
    return { dense, sparse, denseAgain, spawned };
  });

  assert.ok(result.dense.usedWorker, "first layer should have used a worker");
  assert.ok(result.sparse.usedWorker, "second layer should have used a worker");
  assert.ok(result.denseAgain.usedWorker, "third layer should have used a worker");

  // The pool is what this test is about: three layers, one worker.
  assert.equal(result.spawned, 1, `expected one worker across three layers, saw ${result.spawned}`);

  // Reuse must not carry data across. A sparse layer answered from the dense points
  // would report the dense peak.
  assert.ok(
    result.dense.peak > result.sparse.peak * 2,
    `reused worker looks like it answered from stale points: dense ${result.dense.peak}, sparse ${result.sparse.peak}`
  );
  assert.ok(
    Math.abs(result.denseAgain.peak - result.dense.peak) < result.dense.peak * 0.02,
    `the same dataset should give the same peak: ${result.dense.peak} then ${result.denseAgain.peak}`
  );

  console.log(
    `heat worker pool ok · 3 layers, ${result.spawned} worker · peaks ` +
    `${result.dense.peak.toFixed(2)}/${result.sparse.peak.toFixed(2)}/${result.denseAgain.peak.toFixed(2)}`
  );
} finally {
  await browser.close();
  server.close();
}
