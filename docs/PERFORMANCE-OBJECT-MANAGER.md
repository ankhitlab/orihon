# ObjectManager and headless AI updates

## Data changes

`ObjectManager.update` / `updateObjects` change existing IDs only. If even one ID is missing, the whole batch is rejected before anything is written. Use `add` to insert and `reconcile` for a complete set with stable IDs.

```js
manager.beginBulk();
try {
  manager.updateObjects(changedObjects);
  manager.removeObjects(deletedIds);
} finally {
  manager.endBulk();
}
```

Nested bulk blocks defer invalidation and rendering until the outermost `endBulk`. Coordinate and property changes that keep the topology preserve the GPU batch. Mixed batches of points, lines and polygons are processed as a whole.

`FeatureSource.reconcile(features, equals?)` and `ObjectManager.reconcile(objects, equals?)` share one diff by ID. Unchanged records keep their references and state. By default JSON-like records are compared structurally; for versioned data pass `(previous, next) => previous.properties.version === next.properties.version`. The comparator must account for every change that affects rendering. Do not mutate previously passed objects in place.

```js
const manager = remoteObjectManager({
  loader: loadVisibleObjects,
  reconcile: true,
});
```

Remote reconciliation is opt-in and incompatible with `replace: false`. IDs must be unique and stable across loads.

## Scene and map queries

The scene uses a bbox index, a padded visible window and a journal of changed IDs. With the camera unchanged, only the styles and geometric representations of changed visible objects are recomputed. Icons and labels share one collision-layout result. Symbols update individual 16-float GPU records; lines and polygons keep their unchanged prepared records.

The `style` function must be pure with respect to the object and the context it receives. When external settings change, call `setStyle` to reset the cache. Moving the camera or changing the filter, zoom, atlas or object set can require a full refresh of the visible scene. Collision layout and drawing still scale with the number of visible items; the whole frame does not become O(k).

`map.query` returns the ID and the owning object for a manager's child layers without a second hit test. Standalone layers keep their own query contract.

## AI: context, transactions and transport

`points.replace` replaces the named collection; `clearMap` separately controls clearing the other collections. Required fields are checked as own properties. A `__proto__` JSON key is kept as data.

`engine.getContextSummary(idLimit = 24)` returns bounded metadata without serialising geometries. `engine.getObjects(collection, ids?)` returns isolated copies of the selected objects. `engine.queryObjects` is the headless API for a server adapter:

```js
const page = engine.queryObjects({
  collection: 'places',
  bbox: [37, 55, 38, 56], // west, south, east, north
  where: { active: true },
  search: 'park',
  fields: ['title'],
  limit: 100,
});
// page.objects, count, geometryCounts, revision, nextCursor
```

Geometry is included only with `includeGeometry: true`. The page limit is 1–1000 and up to 64 fields. A cursor is valid only for the same revision and parameters; after the data changes, start the query again. The bbox test checks bounding-box intersection, not exact geometry intersection. The result is bounded in size, but search and counting still scan the collection. No ready-made HTTP endpoint is provided for this method: authorisation and the exposed collections and fields remain the host's responsibility.

A transaction event carries ordered deltas without a full `snapshot`. The `executeTransaction` result keeps a lazy `value.snapshot` for compatibility: reading or serialising it materialises the snapshot. The projection applies deltas in one shared batch and rolls back data, scene and routes on error. Unchanged records of the internal state are shared; a changed collection still requires a shallow copy of its Map.

`createAILLMAgent({ ..., maxToolCalls: 64 })` caps tool executions per run (1–1024 allowed). Cancellation is checked after the model's response and between tools. An external tool that has already started must honour the signal it was given on its own.

The HTTP adapter accepts `maxEventQueueBytes` (default 1 MiB, minimum 1024). On overflow the SSE stream sends `resync_required` with reason `slow_consumer`, closes the stream and drops the subscription. The client must close the EventSource, fetch a fresh snapshot and reconnect with revision checks. Automatic reconnection without a resync does not recover the missed deltas. The queue may exceed its budget by the size of one small terminating event; serialising a single large event remains a temporary allocation.
