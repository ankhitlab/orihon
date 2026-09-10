import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createOrihonTestServer } from '../scripts/browser-test-server.mjs';

const server = createOrihonTestServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const core = await import('/dist/orihon.core.esm.js');
    const { objectManager } = await import('/dist/orihon.object-manager.esm.js');
    const host = document.createElement('div'); host.style.cssText = 'width:600px;height:400px'; document.body.append(host);
    const map = core.createMap(host, { center: { lat: 0, lng: 0 }, zoom: 6 });
    const first = objectManager({ clusterize: false, sceneFeatures: true }).addTo(map);
    first.add([{ id: 1, coordinates: { lat: 0, lng: 0 } }]);
    const before = performance.getEntriesByType('resource').filter(e => /orihon-heat-/.test(e.name)).length;
    first.setVisualization('heatmap');
    first.render();
    // Detach while the chunk is in flight: no stale layer may be resurrected.
    first.destroy();
    const manager = objectManager({ clusterize: false, sceneFeatures: true });
    manager.add([{ id: 2, coordinates: { lat: 0.01, lng: 0.01 } }]);
    const ready = new Promise((resolve, reject) => {
      manager.on('sceneerror', event => reject(event.error));
      manager.on('render', () => { if (manager.scene.heatLayer) resolve(); });
    });
    manager.setVisualization('heatmap').addTo(map);
    await ready;
    const heat = manager.scene.heatLayer;
    const advanced = await import('/dist/orihon.esm.js');
    const result = { before, after: performance.getEntriesByType('resource').filter(e => /orihon-heat-/.test(e.name)).length,
      destroyed: first.isDestroyed, staleHeat: Boolean(first.scene.heatLayer), heat: Boolean(heat), identity: core.Orihon === advanced.Orihon };
    manager.setVisualization('objects');
    manager.render();
    result.heatRemoved = manager.scene.heatLayer === null;
    manager.destroy(); map.destroy(); host.remove();
    return result;
  });
  assert.equal(result.before, 0);
  assert.equal(result.after, 1);
  assert.equal(result.staleHeat, false);
  for (const key of ['destroyed', 'heat', 'identity', 'heatRemoved']) assert.equal(result[key], true, key);
  assert.deepEqual(errors, []);
  console.log('shared browser entries and lazy heat lifecycle ok', result);

  const failedPage = await browser.newPage();
  const unexpected = [];
  failedPage.on('pageerror', error => unexpected.push(error.message));
  await failedPage.route(/orihon-heat-[A-Z0-9]+\.js$/, route => route.abort());
  await failedPage.goto(origin);
  const failed = await failedPage.evaluate(async () => {
    const { createMap } = await import('/dist/orihon.core.esm.js');
    const { objectManager } = await import('/dist/orihon.object-manager.esm.js');
    const host = document.createElement('div'); host.style.cssText = 'width:600px;height:400px'; document.body.append(host);
    const map = createMap(host, { center: { lat: 0, lng: 0 }, zoom: 6 });
    const manager = objectManager({ visualization: 'heatmap' });
    manager.add([{ id: 1, coordinates: { lat: 0, lng: 0 } }]);
    const error = new Promise(resolve => manager.once('sceneerror', event => resolve(Boolean(event.error))));
    manager.addTo(map);
    const received = await error;
    manager.destroy(); map.destroy(); host.remove();
    return received;
  });
  assert.equal(failed, true);
  assert.deepEqual(unexpected, []);
  await failedPage.close();
  console.log('lazy heat download failure emits sceneerror without unhandled rejection');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
