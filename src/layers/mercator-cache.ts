import { clampLat, scale, wrapLng } from "../geo.js";
import type { Orihon } from "../map.js";

/**
 * Normalised Web Mercator (0..1) for a run of coordinates, so that layers which
 * redraw every frame do not re-run the projection every frame.
 *
 * Projecting a coordinate is camera-independent: zoom and the pixel origin only
 * scale and translate the result. Caching the normalised pair turns each later
 * frame into a multiply and a subtract per vertex, instead of a `Math.sin` and a
 * `Math.log`. Building the cache costs one full projection pass, so it pays for
 * itself on the second frame and every frame after that.
 *
 * Only valid under EPSG:3857. `CameraTransform.of()` returns null for anything
 * else, which is the signal to fall back to `map.latLngToContainerPoint`.
 */

/** Fills `mx`/`my` with normalised mercator for `count` coordinates. */
export function fillMercator01(
  lat: ArrayLike<number>,
  lng: ArrayLike<number>,
  mx: Float64Array,
  my: Float64Array,
  count: number
): void {
  for (let i = 0; i < count; i++) {
    const sin = Math.sin((clampLat(lat[i]) * Math.PI) / 180);
    mx[i] = (wrapLng(lng[i]) + 180) / 360;
    my[i] = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  }
}

/**
 * Same, for a list that carries its coordinates as `lat`/`lng` fields. Saves
 * copying them into parallel arrays first only to throw those away.
 */
export function fillMercator01From(
  items: ArrayLike<{ lat: number; lng: number }>,
  mx: Float64Array,
  my: Float64Array,
  count: number
): void {
  for (let i = 0; i < count; i++) {
    const item = items[i];
    const sin = Math.sin((clampLat(item.lat) * Math.PI) / 180);
    mx[i] = (wrapLng(item.lng) + 180) / 360;
    my[i] = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
  }
}

/**
 * The camera half of the projection: what to multiply normalised mercator by, and
 * what to subtract, to land in container pixels for the map's current view.
 */
export class CameraTransform {
  private constructor(
    readonly size: number,
    readonly originX: number,
    readonly originY: number
  ) {}

  /** Returns null when the map's CRS is not Web Mercator, so callers keep the slow path. */
  static of(map: Orihon): CameraTransform | null {
    if (map.crs.code !== "EPSG:3857") return null;
    const origin = map.pixelOrigin;
    return new CameraTransform(scale(map.zoom), origin.x, origin.y);
  }

  x(mx: number): number {
    return mx * this.size - this.originX;
  }

  y(my: number): number {
    return my * this.size - this.originY;
  }
}

/**
 * Grows `buffer` to hold at least `count` entries, reusing it when it already does.
 * Returns the buffer to use.
 */
export function ensureCapacity(buffer: Float64Array | null, count: number): Float64Array {
  if (buffer && buffer.length >= count) return buffer;
  return new Float64Array(count);
}
