import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mapInChunks, waitForEvent, summarizeResources, rotatedOrder } from '../examples/bench-compare/harness.js';
import ts from 'typescript';

test('chunked preparation preserves all million IDs and yields between batches', async () => {
  let yields = 0;
  const values = { length: 1000000 };
  const result = await mapInChunks(values, (_, i) => i, { chunkSize: 2000, yieldTask: async () => { yields++; } });
  assert.equal(result.length, 1000000);
  assert.equal(result[999999], 999999);
  assert.equal(yields, 499);
});

test('cancellation stops preparation before the next chunk', async () => {
  const controller = new AbortController(); let converted = 0;
  await assert.rejects(mapInChunks({ length: 20 }, () => converted++, {
    signal: controller.signal, chunkSize: 5, yieldTask: async () => controller.abort(),
  }), { name: 'AbortError' });
  assert.equal(converted, 5);
});

test('readiness waits for the actual event and releases listeners on completion/abort', async () => {
  const emitter = new EventEmitter(); let ready = false;
  const pending = waitForEvent(emitter, 'ready', { ready: () => ready });
  emitter.emit('ready'); assert.equal(emitter.listenerCount('ready'), 1);
  ready = true; emitter.emit('ready'); await pending;
  assert.equal(emitter.listenerCount('ready'), 0);
  const controller = new AbortController();
  const cancelled = waitForEvent(emitter, 'ready', { signal: controller.signal });
  controller.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(emitter.listenerCount('ready'), 0);
});

test('transfer keeps cache hits distinct from unavailable timing and sums every request', () => {
  const cache = { transferSize: 0, encodedBodySize: 40, decodedBodySize: 100 };
  const network = { transferSize: 70, encodedBodySize: 40, decodedBodySize: 100 };
  const hidden = { transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 };
  assert.deepEqual(summarizeResources([cache, network]), {
    requests: 2, knownRequests: 2, transferBytes: 70, encodedBytes: 80, decodedBytes: 200, complete: true,
  });
  assert.equal(summarizeResources([cache, hidden]).complete, false);
  assert.equal(summarizeResources([]).complete, false);
});

test('each repetition rotates engine order without dropping an engine', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(rotatedOrder(ids, 1), ['b', 'c', 'd', 'a']);
  assert.deepEqual(rotatedOrder(ids, 4), ids);
});

test('embedded benchmark remains parseable and every offered scenario has an adapter table', async () => {
  const html = await readFile(new URL('../examples/bench-compare/index.html', import.meta.url), 'utf8');
  const helper = (await readFile(new URL('../examples/bench-compare/harness.js', import.meta.url), 'utf8')).replace(/^export /gm, '').trim();
  assert.equal(html.match(/\/\/ BEGIN BENCH HARNESS\r?\n([\s\S]*?)\r?\n\/\/ END BENCH HARNESS/)[1].replaceAll('\r\n', '\n'), helper.replaceAll('\r\n', '\n'));
  const start = html.indexOf('import * as maplibregl');
  const script = html.slice(start, html.indexOf('    </script>', start));
  const tree = ts.createSourceFile('bench.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.deepEqual(tree.parseDiagnostics, []);
  let runners;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'ENGINE_RUNNERS') runners = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const names = new Set(runners.properties.map(prop => prop.name.getText(tree).replace(/["']/g, '')));
  const select = html.match(/<select id="scenario">([\s\S]*?)<\/select>/)[1];
  for (const match of select.matchAll(/value="([^"]+)"/g)) assert.ok(names.has(match[1]), match[1]);
});
