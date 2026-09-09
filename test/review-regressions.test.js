import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectManager } from '../dist/services/object-manager.js';
import { AICommandEngine } from '../dist/ai/engine.js';
import { AIAgentRuntime } from '../dist/ai/runtime.js';
import { validateObjectCommand } from '../dist/ai/engine-validation.js';
import { createAILLMAgent } from '../dist/ai/agent.js';
import { createAIHTTPHandler } from '../dist/ai/http.js';
import { FeatureSource } from '../dist/feature-source.js';
import { RemoteObjectManager } from '../dist/services/remote-object-manager.js';
import { ObjectBoundsIndex } from '../dist/services/object-bounds-index.js';
import { ObjectSceneController } from '../dist/services/object-scene.js';
import { Evented } from '../dist/events.js';
import { Point, LatLng } from '../dist/geo.js';
import { Orihon } from '../dist/map.js';
import { WebGLSymbolLayer } from '../dist/layers/webgl-symbol-layer.js';
import { AIMapProjection } from '../dist/ai/projection.js';

class ReviewMap extends Evented {
  zoom = 10; crs = { code: 'EPSG:3857' }; layers = new Set(); size = { width: 800, height: 600 };
  pixelOrigin = { x: 0, y: 0 }; viewport = { children: [] };
  getBounds() { return [{ lat: -2, lng: -2 }, { lat: 2, lng: 2 }]; }
  getCenter() { return new LatLng(0, 0); }
  getZoom() { return this.zoom; }
  setView() { return this; }
  stop() { return this; }
  getPane() { return null; }
  latLngToContainerPoint(p) { return new Point(400 + p.lng * 100, 300 - p.lat * 100); }
  latLngToLayerPoint(p) { return this.latLngToContainerPoint(p); }
  containerPointToLatLng(p) { return new LatLng((300 - p.y) / 100, (p.x - 400) / 100); }
  addLayer(layer) { layer.map = this; this.layers.add(layer); return this; }
  removeLayer(layer) { layer.map = null; this.layers.delete(layer); return this; }
}

const point = (id, title = 'old', lat = 1) => ({ id, coordinates: { lat, lng: 1 }, properties: { title } });
const feature = id => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [1, 1] }, properties: { title: 'old' } });
const manager = (options = {}) => new ObjectManager({ clusterize: false, sceneFeatures: false, ...options });

test('property updates synchronize index values and validate the whole batch before mutation', () => {
  const m = manager();
  try {
    m.add(point('a')); m.update(point('a', 'new'));
    assert.equal(m.index.get('a').value, m.getObject('a'));
    assert.throws(() => m.update([point('a', 'wrong'), point('missing')]), RangeError);
    assert.equal(m.getObject('a').properties.title, 'new');
  } finally { m.destroy(); }
});

test('GPU topology changes do not discard the rest of an update batch', () => {
  const m = manager({ clusterRenderer: 'webgl', styleByCategory: false });
  try {
    m.add([point('a'), point('b')]);
    m._webglLayer = { patchPoint() {}, render() {}, remove() {}, off() {} };
    m._webglIdToIndex = new Map([['a', 0], ['b', 1]]);
    m.update([{ id: 'a', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }, point('b', 'new', 2)]);
    assert.equal(m.getObject('b').properties.title, 'new');
    assert.equal(m.index.get('b').position.lat, 2);
  } finally { m.destroy(); }
});

test('bulk update/remove invalidates once and empty endBulk is a no-op', () => {
  const m = manager();
  try {
    m.add([point('a'), point('b')]);
    const before = m._layoutGeneration;
    m.beginBulk(); m.update(point('a', 'moved', 2)); m.removeObjects('b');
    assert.equal(m._layoutGeneration, before);
    m.endBulk(); assert.equal(m._layoutGeneration, before + 1);
    m.endBulk(); assert.equal(m._layoutGeneration, before + 1);
  } finally { m.destroy(); }
});

test('points.replace replaces one collection while preserving other collections', () => {
  const e = new AICommandEngine({ collections: { other: [feature('keep')] } });
  const command = id => ({ op: 'points.replace', collection: 'places', points: [{ id, position: { lat: 1, lng: 1 } }] });
  for (const id of ['a', 'a', 'b']) assert.equal(e.execute(command(id)).ok, true);
  assert.deepEqual(e.getSnapshot().collections.places.map(x => x.id), ['b']);
  assert.equal(e.getSnapshot().collections.other[0].id, 'keep');
});

test('JSON properties preserve own __proto__ without changing prototypes', () => {
  const object = feature('a'); object.properties = JSON.parse('{"__proto__":{"alert":true}}');
  const validated = validateObjectCommand({ op: 'objects.add', collection: 'c', objects: [object] });
  const props = validated.objects[0].properties;
  assert.equal(Object.getPrototypeOf(props), Object.prototype);
  assert.equal(props.alert, undefined);
  assert.equal(Object.hasOwn(props, '__proto__'), true);
  assert.equal(JSON.stringify(props), JSON.stringify(object.properties));
});

test('agent abort stops remaining tools and tool budget bounds a single response', async () => {
  for (const cancel of [true, false]) {
    const abort = new AbortController(); let calls = 0;
    const agent = createAILLMAgent({ systemPrompt: 'test', maxTurns: 1, maxToolCalls: 1,
      adapter: { async complete() { return { content: null, usage: {}, toolCalls: [1, 2].map(id => ({ id: String(id), name: 'mutate', arguments: {} })) }; } },
      tools: [{ definition: { name: 'mutate', parameters: {} }, execute() { calls++; if (cancel) abort.abort(); return {}; } }]
    });
    const result = await agent.run('test', { signal: abort.signal });
    assert.equal(calls, 1); assert.equal(result.ok, false);
  }
});

test('AI updates avoid serializing untouched features; summaries are bounded and copies stay isolated', () => {
  const e = new AICommandEngine({ collections: { c: Array.from({ length: 1000 }, (_, i) => feature(i)) } });
  const runtime = new AIAgentRuntime(e);
  const original = JSON.stringify; let calls = 0;
  JSON.stringify = function (...args) { calls++; return original.apply(this, args); };
  try {
    assert.equal(e.execute({ op: 'objects.update', collection: 'c', objects: [feature(0)] }).ok, true);
    assert.ok(calls < 20);
    calls = 0; assert.equal(runtime.getContext().collections[0].count, 1000); assert.ok(calls < 10);
  } finally { JSON.stringify = original; }
  const preview = e.previewTransaction([{ op: 'objects.remove', collection: 'c', ids: [0] }]);
  assert.equal(preview.ok, true); assert.equal(e.getSnapshot().collections.c.length, 1000);
  const result = e.executeTransaction([{ op: 'objects.remove', collection: 'c', ids: [0] }]);
  assert.equal(result.ok, true);
  e.execute({ op: 'objects.clear', collection: 'c' });
  assert.equal(result.value.snapshot.collections.c.length, 999);
});

test('reconciliation preserves retained state, references and no-op versions', async () => {
  const source = new FeatureSource([feature('a'), feature('b')]);
  const old = source.get('a'), version = source.version;
  source.reconcile([feature('a'), feature('b')]);
  assert.equal(source.version, version); assert.equal(source.get('a'), old);
  const m = new RemoteObjectManager({ loader: () => [point('a'), point('b')], reconcile: true, clusterize: false, sceneFeatures: false });
  try {
    // Reload needs only viewport context; bypass rendering for this transport test.
    m.map = new ReviewMap();
    await m.reload(); m.setSelected('a'); m.setObjectState('a', { alarm: true });
    const oldObject = m.getObject('a');
    await m.reload();
    assert.equal(m.getObject('a'), oldObject); assert.equal(m.getSelectedId(), 'a');
    assert.equal(m.getObjectState('a').alarm, true);
    assert.throws(() => m.reconcile([point('a'), point('a')]), /Duplicate/);
    assert.equal(m.items.size, 2);
  } finally { m.destroy(); }
});

test('SSE bounds a stalled reader and ends with an explicit snapshot resync requirement', async () => {
  const e = new AICommandEngine();
  const response = await createAIHTTPHandler(e, { maxEventQueueBytes: 1024 })(new Request('http://localhost/api/orihon/events'));
  for (let i = 0; i < 100; i++) e.execute({ op: 'objects.add', collection: 'c', objects: [feature(i)] });
  const body = await response.text();
  assert.match(body, /event: resync_required/);
  assert.ok(new TextEncoder().encode(body).length < 1300);
});

test('headless object queries page results, isolate properties and reject expired cursors', () => {
  const e = new AICommandEngine({ collections: { c: [feature('a'), feature('b'), feature('c')] } });
  const query = { collection: 'c', limit: 1, fields: ['title'], bbox: [0, 0, 2, 2], search: 'old' };
  const first = e.queryObjects(query), second = e.queryObjects({ ...query, cursor: first.nextCursor });
  assert.equal(first.count, 3); assert.equal(first.objects[0].id, 'a'); assert.equal(second.objects[0].id, 'b');
  assert.equal(first.objects[0].geometry, undefined);
  first.objects[0].properties.title = 'changed';
  assert.equal(e.getObjects('c', ['a'])[0].properties.title, 'old');
  e.execute({ op: 'objects.remove', collection: 'c', ids: ['c'] });
  assert.throws(() => e.queryObjects({ ...query, cursor: first.nextCursor }), error => error.code === 'REVISION_CONFLICT');
});

test('scene bbox index retains crossing polygons and dateline points', () => {
  const index = new ObjectBoundsIndex();
  index.set('polygon', [-20, -20, 20, 20]); index.set('west', [0, -179, 0, -179]); index.set('east', [0, 179, 0, 179]);
  assert.ok(index.search([-1, -1, 1, 1]).has('polygon'));
  assert.deepEqual([...index.search([-1, 170, 1, -170])].sort(), ['east', 'west']);
  index.remove('east'); assert.equal(index.search([-1, 170, 1, 190]).has('east'), false);
});

test('scene updates resolve only changed visible object styles and keep untouched packed geometry', () => {
  let calls = 0;
  const m = manager({ sceneFeatures: true, clusterRenderer: 'webgl', style: () => { calls++; return { line: { stroke: 'red' } }; } });
  const line = (id, lng = 0, title = 'old') => ({ id, geometry: { type: 'LineString', coordinates: [[lng, 0], [lng + 0.1, 1]] }, properties: { title } });
  try {
    m.add([line('a'), line('b'), line('offscreen', 100)]); m.addTo(new ReviewMap());
    const layer = m.scene.pathBatch, untouched = layer.paths[1];
    calls = 0;
    m.update({ ...m.getObject('a'), properties: { title: 'new' } });
    assert.equal(calls, 1); assert.equal(layer.paths[1], untouched);
    assert.equal(m.scene.dirty.size, 0);
    assert.equal(m._sceneEntries.has('offscreen'), false);
  } finally { m.destroy(); }
});

test('map.query maps renderer hits to managed objects without a second hit-test', () => {
  const map = new ReviewMap(), m = manager({ clusterRenderer: 'webgl' });
  try {
    m.add(point('a')); m.addTo(map);
    const layer = [...map.layers].find(layer => typeof layer.patchPoint === 'function');
    let queries = 0;
    layer.queryHit = () => { queries++; return { layer, source: 'webgl', index: 0, latlng: new LatLng(1, 1) }; };
    const hits = Orihon.prototype.query.call(map, new Point(0, 0));
    assert.equal(queries, 1); assert.equal(hits[0].source, 'object'); assert.equal(hits[0].id, 'a');
    assert.equal(hits[0].feature, m.getObject('a'));
  } finally { m.destroy(); }
});

test('source batches patch GPU points once without rebuilding packed topology', () => {
  const source = new FeatureSource([feature('a'), feature('b')]);
  const m = manager({ source, clusterRenderer: 'webgl' });
  try {
    m.addTo(new ReviewMap()); const pack = m._webglPack, generation = m._layoutGeneration;
    source.batch(() => {
      source.update('a', { geometry: { type: 'Point', coordinates: [1.1, 1.1] } });
      source.update('b', { geometry: { type: 'Point', coordinates: [1.2, 1.2] } });
    });
    assert.equal(m._layoutGeneration, generation); assert.equal(m._webglPack, pack);
    assert.equal(m.index.get('b').position.lat, 1.2);
  } finally { m.destroy(); }
});

test('symbol patches upload one 16-float record and preserve adjacent records and motion attributes', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  try {
    const layer = new WebGLSymbolLayer();
    const instance = id => ({ id, lat: 1, lng: 1, icon: 'x', size: 10, rotation: 0, opacity: 1, tint: [1, 1, 1, 1] });
    layer.setInstances([instance('a'), instance('b'), instance('c')]);
    let uploads = 0; const patches = [];
    layer.gl = new Proxy({ bufferData() { uploads++; }, bufferSubData(_target, offset, data) { patches.push({ offset, data: [...data] }); },
      getExtension: () => ({ vertexAttribDivisorANGLE() {}, drawArraysInstancedANGLE() {} }) },
      { get(target, key) { return key in target ? target[key] : () => {}; } });
    layer.map = new ReviewMap(); layer.canvas = { width: 800, height: 600, style: {} }; layer.renderer = 'webgl';
    layer.program = {}; layer.locs = {}; layer.instanceBuffer = {};
    layer.render(); const before = layer.instanceData.slice();
    layer.patchById('b', { size: 20, startTimeMs: 123, durationMs: 456 }); layer.render();
    assert.equal(uploads, 1); assert.equal(patches.length, 1); assert.equal(patches[0].offset, 16 * 4);
    assert.equal(patches[0].data.length, 16); assert.equal(patches[0].data[8], 20);
    assert.equal(patches[0].data[14], 123); assert.equal(patches[0].data[15], 456);
    assert.deepEqual(layer.instanceData.slice(0, 16), before.slice(0, 16));
    assert.deepEqual(layer.instanceData.slice(32), before.slice(32));
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});

test('multi-command projection uses deltas and rolls back a failed transaction before source publication', () => {
  const e = new AICommandEngine({ collections: { c: [feature('a'), feature('b')] } });
  const projection = new AIMapProjection(new ReviewMap(), { objectManager: { clusterize: false, sceneFeatures: false, clusterRenderer: 'webgl' }, objectPopups: false });
  try {
    assert.equal(projection.applySnapshot(e.getSnapshot()).ok, true);
    const source = projection.getCollectionSource('c'), original = source.get('a');
    const result = e.executeTransaction([{ op: 'objects.update', collection: 'c', objects: [{ ...feature('a'), properties: { title: 'changed' } }] },
      { op: 'objects.remove', collection: 'c', ids: ['b'] }]);
    assert.equal(result.value.event.snapshot, undefined);
    let notifications = 0; source.subscribe(() => notifications++);
    assert.equal(projection.applyEvent(result.value.event).ok, true);
    assert.equal(notifications, 1); assert.equal(source.size, 1); assert.notEqual(source.get('a'), original);
    const before = source.get('a');
    const failed = projection.applyEvent({ type: 'transaction', revision: 2, events: [
      { type: 'objects', revision: 2, collection: 'c', command: { op: 'objects.update', collection: 'c', objects: [feature('a')] } },
      { type: 'objects', revision: 2, collection: 'c', command: { op: 'objects.update', collection: 'c', objects: [feature('missing')] } }
    ] });
    assert.equal(failed.ok, false); assert.equal(projection.revision, 1); assert.equal(source.get('a'), before);
    assert.equal(projection.getCollectionManager('c').getObject('a').properties.title, 'changed');
  } finally { projection.destroy(); }
});


test('failed transaction restores contents of an existing route layer', () => {
  const engine = new AICommandEngine({ collections: { c: [feature('a'), feature('b')] } });
  const projection = new AIMapProjection(new ReviewMap(), { objectManager: { clusterize: false, sceneFeatures: false }, objectPopups: false });
  const route = { id: 'r', collection: 'c', waypointIds: ['a', 'b'], routes: [{ coordinates: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }], distance: 10 }], selectedIndex: 0 };
  try {
    assert.equal(projection.applySnapshot({ ...engine.getSnapshot(), routes: { r: route } }).ok, true);
    const layer = projection.getRouteLayer('r'), before = layer.getRoutes();
    const result = projection.applyEvent({ type: 'transaction', revision: 1, events: [
      { type: 'route', revision: 1, command: { op: 'route.plan', annotateStops: false }, route: { ...route, routes: [{ ...route.routes[0], distance: 99 }] } },
      { type: 'objects', revision: 1, collection: 'c', command: { op: 'objects.update', collection: 'c', objects: [feature('missing')] } }
    ] });
    assert.equal(result.ok, false); assert.equal(projection.revision, 0);
    assert.equal(projection.getRouteLayer('r'), layer); assert.deepEqual(layer.getRoutes(), before);
  } finally { projection.destroy(); }
});
