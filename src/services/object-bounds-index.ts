import type { ObjectId } from "./object-types.js";

type BBox = readonly [number, number, number, number];
const intersects = (a: BBox, b: BBox): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** Coarse bbox grid for scene culling; oversized geometries remain queryable without cell explosion. */
export class ObjectBoundsIndex {
  private readonly records = new Map<ObjectId, { bbox: BBox; cells: string[] }>();
  private readonly cells = new Map<string, Set<ObjectId>>();
  private readonly oversized = new Set<ObjectId>();

  set(id: ObjectId, bbox: BBox): void {
    this.remove(id);
    const keys = this.keys(bbox);
    this.records.set(id, { bbox, cells: keys ?? [] });
    if (!keys) { this.oversized.add(id); return; }
    for (const key of keys) {
      let ids = this.cells.get(key);
      if (!ids) this.cells.set(key, ids = new Set());
      ids.add(id);
    }
  }

  remove(id: ObjectId): void {
    const record = this.records.get(id);
    if (!record) return;
    for (const key of record.cells) {
      const ids = this.cells.get(key)!;
      ids.delete(id); if (!ids.size) this.cells.delete(key);
    }
    this.oversized.delete(id); this.records.delete(id);
  }

  clear(): void { this.records.clear(); this.cells.clear(); this.oversized.clear(); }

  search(bbox: BBox): Set<ObjectId> {
    const result = new Set<ObjectId>();
    // Wrapped viewport intervals, including repeated worlds, must not miss the dateline.
    const width = bbox[3] - bbox[1];
    if (width >= 360) return this.searchUnwrapped([bbox[0], -180, bbox[2], 180]);
    const west = ((bbox[1] + 180) % 360 + 360) % 360 - 180;
    const east = west + (width < 0 ? width + 360 : width);
    for (const part of east > 180
      ? [[bbox[0], west, bbox[2], 180], [bbox[0], -180, bbox[2], east - 360]] as BBox[]
      : [[bbox[0], west, bbox[2], east]] as BBox[]) {
      for (const id of this.searchUnwrapped(part)) result.add(id);
    }
    return result;
  }

  private searchUnwrapped(bbox: BBox): Set<ObjectId> {
    const keys = this.keys(bbox);
    const candidates = new Set(this.oversized);
    if (!keys) for (const id of this.records.keys()) candidates.add(id);
    else for (const key of keys) for (const id of this.cells.get(key) ?? []) candidates.add(id);
    return new Set([...candidates].filter(id => intersects(this.records.get(id)!.bbox, bbox)));
  }

  private keys(bbox: BBox): string[] | null {
    const south = Math.floor(bbox[0] / 5), north = Math.floor(bbox[2] / 5);
    const west = Math.floor(bbox[1] / 5), east = Math.floor(bbox[3] / 5);
    if ((north - south + 1) * (east - west + 1) > 256) return null;
    const keys: string[] = [];
    for (let y = south; y <= north; y++) for (let x = west; x <= east; x++) keys.push(`${x}:${y}`);
    return keys;
  }
}
