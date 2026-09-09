/** Validate and compare stable-id datasets before any mutation. */
export function diffRecords<T, K extends string | number>(current: ReadonlyMap<K, T>, values: Iterable<T>,
  idOf: (value: T) => K | undefined, equals: (a: T, b: T) => boolean = recordsEqual): { added: T[]; updated: T[]; removed: K[] } {
  const ids = new Set<K>();
  const added: T[] = [], updated: T[] = [];
  for (const value of values) {
    const id = idOf(value);
    if (id == null) throw new TypeError("Reconciliation requires stable ids");
    if (ids.has(id)) throw new TypeError(`Duplicate reconciliation id: ${String(id)}`);
    ids.add(id);
    if (!current.has(id)) added.push(value);
    else if (!equals(current.get(id)!, value)) updated.push(value);
  }
  return { added, updated, removed: [...current.keys()].filter(id => !ids.has(id)) };
}

/** JSON-like record equality without serialization or key-order sensitivity. */
export function recordsEqual(a: unknown, b: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (seen.has(a)) return seen.get(a) === b;
  seen.set(a, b);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.byteLength !== b.byteLength) return false;
    const aa = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return aa.every((value, i) => value === bb[i]);
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) &&
    recordsEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], seen));
}
