import { createEl, listen, listenTap } from "../dom.js";
import { cameraWarpCoversViewport } from "../camera.js";
import { TILE_SIZE, latLng, projectMercator01, type LatLngLike, type Point } from "../geo.js";
import { InteractiveLayer } from "../interactive-layer.js";
import { type LayerOptions, type QueryHit, type ResolvedQueryOptions } from "../layer.js";
import type { Orihon } from "../map.js";
import { assertMercator } from "../crs.js";
import type { OverlayContent, PopupOptions } from "../overlays/div-overlay.js";
import { SpatialGridIndex } from "../services/spatial-grid-index.js";
import {
  isAsyncIterable,
  resolveAsyncBatchOptions,
  throwIfAsyncAborted,
  yieldAsyncBatch,
  type AsyncBatchOptions
} from "../services/async-batch.js";
import { compileShader, linkProgram, parseCssColor, type RgbColor } from "../webgl-utils.js";

export type WebGLPointInput = LatLngLike | { coordinates?: LatLngLike; latlng?: LatLngLike; lat?: number; lng?: number };

export interface WebGLPointDataOptions {
  /** Interleaved RGBA floats in 0..1, length = pointCount * 4. */
  colors?: ArrayLike<number> | null;
  /** Per-point sizes in CSS pixels, length = pointCount. */
  sizes?: ArrayLike<number> | null;
  /**
   * Take ownership of `latlng` / `merc64` typed arrays (no copy).
   * Callers must not reuse those buffers after `setPackedData`.
   */
  adopt?: boolean;
}

export interface WebGLPointAsyncDataOptions extends WebGLPointDataOptions, AsyncBatchOptions {}

export interface WebGLPointLayerOptions extends LayerOptions {
  pointSize?: number;
  color?: string;
  opacity?: number;
  maxDpr?: number;
  fallbackCanvas?: boolean;
  rotation?: number;
  pitch?: number;
  interactive?: boolean;
  hitTolerance?: number;
  /** When true, canvas fallback still CPU-culls. WebGL always transforms on GPU. */
  cull?: boolean;
  /**
   * Storage for the absolute world mercator, 16 bytes per point at `"f64"` (the
   * default) and 8 at `"f32"`.
   *
   * Float32 has ~24 bits of mantissa, so a normalized 0..1 mercator quantises to
   * roughly 3e-8 — about 0.1px at zoom 14, 0.5px at 16, 2px at 18 and 8px at 20.
   * Choose `"f32"` only for datasets that stay below roughly zoom 16; above that
   * points visibly wobble as the camera moves.
   *
   * What this governs depends on how the data arrived. Data handed over already
   * projected (`setPackedData`) is stored as mercator and drawn from it, so
   * `points`, click payloads and the hit-test index all inherit this precision.
   * Data that arrives as degrees (`setData`, `setDataAsync`, the constructor) is
   * kept as float64 degrees and projected on the GPU; the mercator then exists only
   * for CPU readers — `getMercatorAbs()`, the canvas fallback — and this option sets
   * the width of that derived copy, while degrees come back exactly as given.
   */
  mercatorPrecision?: "f64" | "f32";
}

/** Absolute mercator storage; float32 halves it at the cost of high-zoom precision. */
export type MercatorBuffer = Float64Array | Float32Array;

type ResolvedWebGLPointLayerOptions = Required<WebGLPointLayerOptions>;

interface GLLocations {
  aMerc: number;
  aColor: number;
  aSize: number;
  uScale: WebGLUniformLocation | null;
  uOrigin: WebGLUniformLocation | null;
  uResolution: WebGLUniformLocation | null;
  uDpr: WebGLUniformLocation | null;
  uPointSize: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uUseVertexColor: WebGLUniformLocation | null;
  uUseVertexSize: WebGLUniformLocation | null;
  uCenter: WebGLUniformLocation | null;
  uRotate: WebGLUniformLocation | null;
  uPitch: WebGLUniformLocation | null;
  uRound: WebGLUniformLocation | null;
  uGpuProject: WebGLUniformLocation | null;
  uRefTan: WebGLUniformLocation | null;
}

export interface WebGLPointLayerStats {
  points: number;
  rendered: number;
  renderer: "webgl" | "canvas" | "none";
  bufferBytes: number;
  vertexColors: boolean;
  vertexSizes: boolean;
  /** Spatial pick-index size; 0 when `interactive` is false. */
  pickIndex: number;
}

export interface WebGLPointEventMap {
  click: { originalEvent: MouseEvent | PointerEvent; latlng: LatLngLike; containerPoint: { x: number; y: number }; index: number; data: WebGLPointInput | undefined };
  hover: { originalEvent: MouseEvent; latlng: LatLngLike | null; containerPoint: { x: number; y: number } | null; index: number; data: WebGLPointInput | null | undefined };
}

/**
 * Above this many points an interactive layer stops holding the caller's source
 * objects: `pointData` is what feeds click/hover payloads, and a million of them
 * costs far more than the packed buffers they sit beside.
 */
const SOURCE_RETENTION_MAX = 40_000;

/** Upload window for camera-relative mercator: 64k floats, one 256 KB buffer. */
const STAGE_FLOATS = 65_536;

export class WebGLPointLayer extends InteractiveLayer<ResolvedWebGLPointLayerOptions, WebGLPointEventMap> {
  canvas: HTMLCanvasElement | null = null;
  gl: WebGLRenderingContext | null = null;
  program: WebGLProgram | null = null;
  buffer: WebGLBuffer | null = null;
  colorBuffer: WebGLBuffer | null = null;
  sizeBuffer: WebGLBuffer | null = null;
  /**
   * Packed lat/lng pairs.
   *
   * Degrees are only needed for hit-testing, `addData()` and event payloads —
   * drawing works off the mercator buffer — so a non-interactive layer no longer
   * stores them, saving 8 bytes per point. Reading this property rebuilds them
   * from `_merc64` once and caches the result, which is why the getter is cheap
   * on repeat but not free the first time.
   */
  get points(): Float32Array {
    if (!this._latlngValid) this.#materialiseLatLng();
    return this._latlngBuf.subarray(0, this._count);
  }

  /** Floats in the current dataset; two per point. */
  private _count = 0;
  /** False when `_latlngBuf` has not been derived for the current data yet. */
  private _latlngValid = true;
  /**
   * Camera-relative float32 mercator, as uploaded to the GPU.
   *
   * @deprecated The layer no longer keeps a full-size copy of this — it encodes
   * straight from `_merc64` into a small staging window while uploading, which
   * saves 8 bytes per point. Reading this property materialises a fresh array
   * every time; prefer `getMercatorAbs()` for the stored absolute buffer.
   */
  get mercator(): Float32Array {
    const count = this._count;
    const out = new Float32Array(count);
    if (count && Number.isFinite(this._refMx)) this.#encodeInto(out, 0, 0, count);
    return out;
  }
  /** Interleaved RGBA bytes (0..255) when per-point colors are enabled. */
  colors: Uint8Array = new Uint8Array();
  /** Per-point sizes in CSS pixels when vertex sizes are enabled. */
  sizes: Float32Array = new Float32Array();
  pointData: WebGLPointInput[] = [];
  renderer: "webgl" | "canvas" | "none" = "none";
  readonly color: RgbColor;
  private _interactionUnsub: (() => void) | null = null;
  private _lastRendered = 0;
  private _glLocations: GLLocations | null = null;
  private _bufferDirty = true;
  private _colorDirty = true;
  private _sizeDirty = true;
  private _useVertexColor = false;
  private _useVertexSize = false;
  private _scratch: Float32Array = new Float32Array(0);
  private _scratchColors: Float32Array = new Float32Array(0);
  private _latlngBuf = new Float32Array(0);
  private _merc64: MercatorBuffer = new Float64Array(0);
  /**
   * Which store is canonical. Data that arrives as degrees is kept as degrees in
   * float64 and projected on the GPU: the staging buffer then carries degree offsets
   * from a reference, and moving a point costs a subtraction rather than a sine and a
   * logarithm — which was 85% of every live-update frame at a million points.
   * `_merc64` still exists in this mode, but derived, and only once something on the
   * CPU — a hit test, the canvas fallback, the mercator getters — actually needs it.
   *
   * Data that arrives already projected (`setPackedData`) stays in mercator mode, as
   * before: there are no float64 degrees to take offsets from.
   */
  private _gpuProject = false;
  /** Degrees in float64, lat then lng; the canonical store under `_gpuProject`. */
  private _latlng64: Float64Array<ArrayBufferLike> = new Float64Array(0);
  /** Float range of `_latlng64` that `_merc64` has not been rebuilt from yet; `from < 0` means clean. */
  private _mercStaleFrom = -1;
  private _mercStaleTo = -1;
  /**
   * Staging window for GPU uploads. Camera-relative mercator used to be kept for
   * every point (8 bytes each); it is derived from `_merc64` a window at a time
   * instead, because nothing but the upload ever reads it.
   */
  private _stage = new Float32Array(0);
  /** Floats already encoded against `_refMx/_refMy`; 0 forces a full re-encode. */
  private _encodedCount = 0;
  private _colorBuf = new Uint8Array(0);
  private _colorFloat = new Float32Array(0);
  private _sizeBuf = new Float32Array(0);
  /** Reused sorted GPU-slot scratch for batched style updates. */
  private _stylePatchIndexScratch = new Uint32Array(0);
  /** The same, for batched coordinate updates; kept apart so one cannot clobber the other. */
  private _pointPatchIndexScratch = new Uint32Array(0);
  private _gpuMercBytes = 0;
  private _gpuColorBytes = 0;
  private _gpuSizeBytes = 0;
  private _refMx = 0;
  private _refMy = 0;
  /** The same reference in degrees, for the GPU-projected encoding, plus the tangent the shader needs. */
  private _refLat = 0;
  private _refLng = 0;
  private _refTan = 1;
  private _refZoom = Number.NaN;
  private _refOriginX = 0;
  private _refOriginY = 0;
  private _pickIndex = new SpatialGridIndex<number, number>(1);
  private _maxVertexSize = 0;
  /** True when `_latlngBuf` / `_merc64` were adopted from the caller (may be shared). */
  private _packedAdopted = false;
  private _hidden = false;
  private _forceGpu = true;
  private _hasPainted = false;
  private _paintedZoom = Number.NaN;
  private _paintedOriginX = 0;
  private _paintedOriginY = 0;
  private _paintedPad = 0;
  private _lastGpuMs = 0;
  private _settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(points: Iterable<WebGLPointInput> = [], options: WebGLPointLayerOptions = {}) {
    super({
      pane: "overlay",
      attribution: "",
      pointSize: 5,
      color: "#e11d48",
      opacity: 0.82,
      maxDpr: 2,
      fallbackCanvas: true,
      rotation: 0,
      pitch: 0,
      interactive: false,
      hitTolerance: 5,
      cull: true,
      mercatorPrecision: "f64",
      ...options
    });
    this.color = parseCssColor(this.options.color, { r: 225, g: 29, b: 72 });
    this.setData(points);
  }

  override onAdd(map: Orihon): void {
    assertMercator(map.crs);
    super.onAdd(map);
    const pane = this.getPane();
    if (!pane) throw new Error(`Orihon pane not found: ${this.options.pane}`);
    this.canvas = createEl("canvas", "oh-webgl-point-layer", pane);
    this.canvas.style.position = "absolute";
    this.canvas.style.pointerEvents = this.options.interactive ? "auto" : "none";
    this.canvas.style.willChange = "transform";
    this.gl = this.canvas.getContext("webgl", {
      antialias: false,
      alpha: true,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
      premultipliedAlpha: true
    });
    if (this.gl) {
      this.renderer = "webgl";
      this.#initWebGL();
    } else if (this.options.fallbackCanvas && this.canvas.getContext("2d")) {
      this.renderer = "canvas";
    } else {
      this.renderer = "none";
    }
    this.#syncInteraction();
    this.render();
  }

  override onRemove(): void {
    this.#clearSettleTimer();
    if (this.gl) {
      try {
        if (this.buffer) this.gl.deleteBuffer(this.buffer);
        if (this.colorBuffer) this.gl.deleteBuffer(this.colorBuffer);
        if (this.sizeBuffer) this.gl.deleteBuffer(this.sizeBuffer);
        if (this.program) this.gl.deleteProgram(this.program);
        this.gl.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        /* context may already be lost */
      }
    }
    this.buffer = null;
    this.colorBuffer = null;
    this.sizeBuffer = null;
    this.program = null;
    this.gl = null;
    this._glLocations = null;
    this._gpuMercBytes = 0;
    this._gpuColorBytes = 0;
    this._gpuSizeBytes = 0;
    this.renderer = "none";
    this._interactionUnsub?.();
    this._interactionUnsub = null;
    if (this.canvas) {
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.canvas.remove();
    }
    this.canvas = null;
    this._count = 0;
    this._latlngValid = true;
    this.colors = new Uint8Array();
    this.sizes = new Float32Array();
    this._merc64 = this.#newMerc(0);
    this._stage = new Float32Array(0);
    this._encodedCount = 0;
    this.#enterMercatorMode();
    this._colorBuf = new Uint8Array(0);
    this._colorFloat = new Float32Array(0);
    this._sizeBuf = new Float32Array(0);
    this.pointData = [];
    this._latlngBuf = new Float32Array(0);
    this._packedAdopted = false;
    this._scratch = new Float32Array(0);
    this._scratchColors = new Float32Array(0);
    this._useVertexColor = false;
    this._useVertexSize = false;
    this._maxVertexSize = 0;
    this._refZoom = Number.NaN;
    this._pickIndex.clear();
    super.onRemove();
  }

  /**
   * Rebuild lat/lng degrees from the stored mercator. Exact inverse of
   * `projectMercator01`, so a float64 layer round-trips to within float32 anyway;
   * under `mercatorPrecision: "f32"` the degrees inherit that buffer's precision.
   */
  #materialiseLatLng(): void {
    const n = this._count;
    if (this._latlngBuf.length < n) this._latlngBuf = new Float32Array(n);
    if (this._gpuProject) {
      // The degrees are already here in float64; this is just the float32 narrowing.
      this._latlngBuf.set(this._latlng64.subarray(0, n));
      this._latlngValid = true;
      return;
    }
    const merc = this._merc64;
    const toDeg = 180 / Math.PI;
    for (let i = 0; i < n; i += 2) {
      this._latlngBuf[i] = Math.atan(Math.sinh((0.5 - merc[i + 1]) * 2 * Math.PI)) * toDeg;
      this._latlngBuf[i + 1] = merc[i] * 360 - 180;
    }
    this._latlngValid = true;
  }

  /** Reusable upload window, capped so a million points cost one 256 KB buffer. */
  #stageWindow(floats: number): Float32Array {
    const want = Math.min(floats, STAGE_FLOATS);
    if (this._stage.length < want) this._stage = new Float32Array(want);
    return this._stage;
  }

  /**
   * Encode `floatCount` camera-relative floats starting at `srcOffset` of the
   * absolute buffer into `dst[dstOffset…]`. This is the whole reason the layer no
   * longer needs a second full-size array.
   */
  #encodeInto(dst: Float32Array, dstOffset: number, srcOffset: number, floatCount: number): void {
    if (this._gpuProject) {
      // Degree offsets, subtracted in float64 so the small result keeps its full precision
      // in float32. The shader turns them into a mercator delta; see mercDeltaY there.
      // Order is (lng, lat) to match the (x, y) the mercator encoding uses. No wrapping:
      // the mercator encoding never wrapped either — a point across the antimeridian from
      // the reference is a world away in both — and this loop runs over every point the
      // dirty ranges cover, so it has to stay as cheap as the two subtractions it replaces.
      const src = this._latlng64;
      const refLat = this._refLat;
      const refLng = this._refLng;
      for (let i = 0; i < floatCount; i += 2) {
        dst[dstOffset + i] = src[srcOffset + i + 1] - refLng;
        dst[dstOffset + i + 1] = src[srcOffset + i] - refLat;
      }
      return;
    }
    const src = this._merc64;
    const refX = this._refMx;
    const refY = this._refMy;
    for (let i = 0; i < floatCount; i += 2) {
      dst[dstOffset + i] = src[srcOffset + i] - refX;
      dst[dstOffset + i + 1] = src[srcOffset + i + 1] - refY;
    }
  }

  /**
   * The mercator reference expressed as degrees, and the tangent the shader's stable
   * delta formula needs. All float64 here; the shader receives them as float32, which
   * the measurement showed costs nothing visible: relative error in the tangent stays
   * relative in the result, and the result is a small delta.
   */
  #deriveDegreeReference(): void {
    this._refLng = this._refMx * 360 - 180;
    const latRad = Math.atan(Math.sinh((0.5 - this._refMy) * 2 * Math.PI));
    this._refLat = (latRad * 180) / Math.PI;
    this._refTan = Math.tan(Math.PI / 4 + latRad / 2);
  }

  /**
   * Brings `_merc64` up to date with `_latlng64` over whatever range moved since the last
   * CPU consumer looked. Under GPU projection nothing on the render path needs it, so a
   * non-interactive layer never pays for this at all.
   */
  #ensureMerc(): void {
    if (!this._gpuProject || this._mercStaleFrom < 0) return;
    let from = this._mercStaleFrom;
    let to = Math.min(this._mercStaleTo, this._count);
    if (this._merc64.length < this._count) {
      // A buffer that has never held the whole set has no clean prefix worth keeping.
      this._merc64 = this.#newMerc(this._count);
      from = 0;
      to = this._count;
    }
    const src = this._latlng64;
    const merc = this._merc64;
    for (let i = from; i < to; i += 2) {
      const m = projectMercator01(src[i], src[i + 1]);
      merc[i] = m.x;
      merc[i + 1] = m.y;
    }
    this._mercStaleFrom = -1;
    this._mercStaleTo = -1;
  }

  /**
   * Writes one point's new position at float offset `slot`. This is the whole of what
   * moving a point costs on the CPU under GPU projection: two stores and a bookkeeping
   * range, with the projection left to the shader. In mercator mode it is what it always
   * was — a sine, a logarithm and four stores.
   */
  #storePosition(slot: number, lat: number, lng: number): void {
    if (this._gpuProject) {
      this._latlng64[slot] = lat;
      this._latlng64[slot + 1] = lng;
      this._latlngValid = false;
      this.#markMercStale(slot, slot + 2);
      return;
    }
    const m = projectMercator01(lat, lng);
    if (this._latlngBuf.length > slot + 1) {
      this._latlngBuf[slot] = lat;
      this._latlngBuf[slot + 1] = lng;
    }
    this._merc64[slot] = m.x;
    this._merc64[slot + 1] = m.y;
  }

  /** Widens the stale range to cover `[from, to)` floats of `_latlng64`. */
  #markMercStale(from: number, to: number): void {
    if (this._mercStaleFrom < 0) {
      this._mercStaleFrom = from;
      this._mercStaleTo = to;
      return;
    }
    if (from < this._mercStaleFrom) this._mercStaleFrom = from;
    if (to > this._mercStaleTo) this._mercStaleTo = to;
  }

  /** Absolute-mercator storage in whichever precision this layer was configured for. */
  #newMerc(length: number): MercatorBuffer {
    return this.options.mercatorPrecision === "f32"
      ? new Float32Array(length)
      : new Float64Array(length);
  }

  /** True when `buffer` already matches the configured precision and can be kept as-is. */
  #mercMatches(buffer: MercatorBuffer): boolean {
    return this.options.mercatorPrecision === "f32"
      ? buffer instanceof Float32Array
      : buffer instanceof Float64Array;
  }

  setData(points: Iterable<WebGLPointInput>, options: WebGLPointDataOptions = {}): this {
    // Arrays can be checked outright; an iterable is provisional and the loop below
    // stops retaining as soon as it passes the cap.
    const keepData =
      this.options.interactive && (!Array.isArray(points) || points.length <= SOURCE_RETENTION_MAX);
    // Degrees are only needed for hit-testing and event payloads. A non-interactive
    // layer skips storing them entirely and derives them on demand instead.
    const needLatLng = this.options.interactive;
    let keptCount = 0;

    if (Array.isArray(points)) {
      const need = points.length * 2;
      // Adopted buffers are the caller's storage — ObjectManager keeps its own
      // reference to them rather than copying — so a new dataset allocates instead
      // of overwriting them, the same rule `setPackedData()` follows.
      if (this._packedAdopted) {
        this._latlngBuf = new Float32Array(0);
        this._merc64 = this.#newMerc(0);
        this._packedAdopted = false;
      }
      // Degrees arrive here, so this dataset is projected on the GPU: keep the degrees in
      // float64 and leave the mercator to be derived if anything on the CPU asks. The
      // float32 degree copy the `points` getter hands out is derived the same way.
      if (this._latlng64.length < need) this._latlng64 = new Float64Array(need);
      const latlng64 = this._latlng64;
      const data: WebGLPointInput[] = keepData ? new Array(points.length) : [];
      let write = 0;
      let kept = 0;
      for (let index = 0; index < points.length; index++) {
        const item = points[index];
        const next = normalizePoint(item);
        if (!next) continue;
        latlng64[write] = next.lat;
        latlng64[write + 1] = next.lng;
        write += 2;
        if (keepData) data[kept++] = item;
      }
      this._count = write;
      this.#enterGpuProjection();
      // slice() copied the whole array even when nothing had been filtered out, which is the usual
      // case. Truncating in place costs nothing and keeps the same array when every point was kept.
      if (!keepData) this.pointData = [];
      else {
        if (kept !== data.length) data.length = kept;
        this.pointData = data;
      }
      keptCount = write / 2;
    } else {
      const store = new PointPairStore(sizeHintOf(points));
      // An iterable has no length to check up front, so the retention cap is enforced
      // as we go: once the source outgrows it, drop what was collected rather than
      // leaving `pointData` half filled, which is what the array path does too.
      let retainSource = keepData;
      const data: WebGLPointInput[] = [];
      for (const item of points) {
        const next = normalizePoint(item);
        if (!next) continue;
        store.push(next.lat, next.lng);
        if (retainSource) {
          if (data.length >= SOURCE_RETENTION_MAX) {
            retainSource = false;
            data.length = 0;
          } else data.push(item);
        }
      }
      const write = store.length;
      if (this._packedAdopted) {
        this._latlngBuf = new Float32Array(0);
        this._merc64 = this.#newMerc(0);
        this._packedAdopted = false;
      }
      this._latlng64 = store.take();
      this._count = write;
      this.#enterGpuProjection();
      this.pointData = retainSource ? data : [];
      keptCount = write / 2;
    }

    this.#applyColors(options.colors, keptCount);
    this.#applySizes(options.sizes, keptCount);
    this.#rebuildPickIndex();
    this._refZoom = Number.NaN;
    this._bufferDirty = true;
    this._forceGpu = true;
    this.render();
    return this;
  }

  /**
   * Project and pack a large point iterable across bounded main-thread tasks,
   * then replace the live GPU dataset atomically.
   */
  async setDataAsync(
    points: Iterable<WebGLPointInput> | AsyncIterable<WebGLPointInput>,
    options: WebGLPointAsyncDataOptions = {}
  ): Promise<this> {
    const resolved = resolveAsyncBatchOptions(options, 50_000);
    const total = Array.isArray(points) ? points.length : null;
    throwIfAsyncAborted(resolved.signal);

    // Preserve source objects for the small interactive path just like setData().
    if (Array.isArray(points) && this.options.interactive && points.length <= SOURCE_RETENTION_MAX) {
      this.setData(points, options);
      resolved.onProgress?.(points.length, points.length);
      return this;
    }

    // Degrees only, in float64: the dataset will be projected on the GPU, and the
    // mercator any CPU consumer needs is derived later, on demand.
    let degrees: Float64Array | null = total == null ? null : new Float64Array(total * 2);
    /* Unsized sources grow typed arrays rather than staging boxed numbers. */
    const store = total == null ? new PointPairStore(sizeHintOf(points)) : null;
    let processed = 0;
    let write = 0;
    const append = (item: WebGLPointInput): void => {
      const next = normalizePoint(item);
      if (!next) return;
      if (degrees) {
        degrees[write] = next.lat;
        degrees[write + 1] = next.lng;
      } else {
        store!.push(next.lat, next.lng);
      }
      write += 2;
    };
    const checkpoint = async (final: boolean): Promise<void> => {
      resolved.onProgress?.(processed, total);
      if (!final) await yieldAsyncBatch(resolved.yieldMode);
      throwIfAsyncAborted(resolved.signal);
    };

    if (Array.isArray(points)) {
      for (let index = 0; index < points.length; index++) {
        append(points[index]);
        processed++;
        if (processed % resolved.chunkSize === 0) await checkpoint(index === points.length - 1);
      }
    } else if (isAsyncIterable<WebGLPointInput>(points)) {
      for await (const item of points) {
        append(item);
        processed++;
        if (processed % resolved.chunkSize === 0) await checkpoint(false);
      }
    } else {
      for (const item of points) {
        append(item);
        processed++;
        if (processed % resolved.chunkSize === 0) await checkpoint(false);
      }
    }
    if (processed % resolved.chunkSize !== 0) await checkpoint(true);

    if (!degrees) degrees = store!.take();
    else if (write !== degrees.length) degrees = degrees.slice(0, write);
    this.#adoptDegrees(degrees, write, options);
    return this;
  }

  /**
   * Installs a float64 degree buffer as the layer's dataset and switches to GPU
   * projection. The buffer is taken over, not copied: the async ingest built it for
   * exactly this, and `setData` already made its own.
   */
  #adoptDegrees(degrees: Float64Array<ArrayBufferLike>, count: number, options: WebGLPointDataOptions): void {
    if (this._packedAdopted) {
      this._latlngBuf = new Float32Array(0);
      this._merc64 = this.#newMerc(0);
      this._packedAdopted = false;
    }
    this._latlng64 = degrees;
    this._count = count;
    this.pointData = [];
    this.#enterGpuProjection();
    this.#applyColors(options.colors, count / 2);
    this.#applySizes(options.sizes, count / 2);
    this.#rebuildPickIndex();
    this._refZoom = Number.NaN;
    this._bufferDirty = true;
    this._forceGpu = true;
    this.render();
  }

  /**
   * `_latlng64` is now canonical: the whole mercator is stale, the float32 degree copy
   * is stale, and whatever the staging buffer held was encoded the other way.
   */
  #enterGpuProjection(): void {
    this._gpuProject = true;
    this._latlngValid = false;
    this._mercStaleFrom = 0;
    this._mercStaleTo = this._count;
    this._encodedCount = 0;
  }

  /** `_merc64` is canonical again; there are no float64 degrees to take offsets from. */
  #enterMercatorMode(): void {
    this._gpuProject = false;
    this._latlng64 = new Float64Array(0);
    this._mercStaleFrom = -1;
    this._mercStaleTo = -1;
    this._encodedCount = 0;
  }

  /** Replace per-point RGBA (0..1). Pass null to fall back to uniform `color`. */
  setColors(colors: ArrayLike<number> | null): this {
    this.#applyColors(colors, this._count / 2);
    this.render();
    return this;
  }

  /** Replace per-point sizes in CSS pixels. Pass null to fall back to uniform `pointSize`. */
  setSizes(sizes: ArrayLike<number> | null): this {
    this.#applySizes(sizes, this._count / 2);
    this.render();
    return this;
  }

  /**
   * Patch a single point in place (no full re-encode). Used by ObjectManager live updates.
   *
   * Unlike `setData()`, the patch methods deliberately write through to buffers taken with
   * `setPackedData(..., { adopt: true })`: an owner that kept its own reference sees the same
   * update, which is how ObjectManager shares one set of arrays with this layer rather than
   * holding a second copy. Replacing the dataset is the case that must not reuse borrowed
   * storage; moving a point inside it is not.
   */
  patchPoint(index: number, lat: number, lng: number): this {
    const i = index * 2;
    if (i < 0 || i + 1 >= this._count) return this;
    this.#storePosition(i, lat, lng);
    if (this.options.interactive) this._pickIndex.set(index, { lat: lat, lng: lng }, index);
    // The new position is already in `_merc64`; the upload encodes it from there.
    if (Number.isFinite(this._refMx)) this.#uploadMercatorRange(i, 2);
    else this._bufferDirty = true;
    // Moving a point has to ask for a repaint, exactly as changing its colour or size does.
    // Without this the new coordinates sit in the GPU buffer and `render()` takes its
    // camera-unchanged shortcut, so positions only appeared the next time the camera moved.
    this.#requestGpuPaint();
    return this;
  }

  /**
   * Move many points in one pass. `latLngs` is interleaved lat,lng for each entry of `indices`.
   *
   * `patchPoint()` issues its own `bufferSubData` per point, which is right for the tens of moving
   * objects a live map usually has. A fleet or a telemetry feed moves thousands at once, and that
   * became thousands of driver calls a tick. This runs the same plan `patchStyles()` already uses
   * for colours and sizes: sort the slots, merge what is adjacent, and let a dense or scattered
   * batch fall back to one full upload when that works out cheaper.
   */
  patchPoints(indices: ArrayLike<number>, latLngs: ArrayLike<number>, count = indices.length): this {
    const n = Math.min(indices.length, Math.max(0, Math.floor(count)));
    if (n <= 0) return this;
    if (this._pointPatchIndexScratch.length < n) this._pointPatchIndexScratch = new Uint32Array(n);

    const pointCount = this._count / 2;
    const canUploadRanges = Number.isFinite(this._refMx);
    let dirtyCount = 0;

    for (let i = 0; i < n; i++) {
      const index = Math.trunc(Number(indices[i]));
      if (!Number.isFinite(index) || index < 0 || index >= pointCount) continue;
      const src = i * 2;
      if (src + 1 >= latLngs.length) continue;
      const lat = Number(latLngs[src]);
      const lng = Number(latLngs[src + 1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const slot = index * 2;
      this.#storePosition(slot, lat, lng);
      if (this.options.interactive) this._pickIndex.set(index, { lat, lng }, index);

      if (canUploadRanges) {
        // `_merc64` now holds the new position; the range upload encodes it.
        this._pointPatchIndexScratch[dirtyCount++] = index;
      } else {
        // No camera reference yet, so there is nothing to encode against: let the next render
        // rebuild the whole buffer instead of uploading garbage.
        this._bufferDirty = true;
      }
    }

    if (dirtyCount > 0 && !this._bufferDirty) {
      const dirty = this._pointPatchIndexScratch.subarray(0, dirtyCount);
      // #uploadPatchRanges needs ascending indices to coalesce runs, but callers that
      // walk their data in order — the common case for an animation loop — already
      // hand them over sorted. Checking costs a linear scan and skips an O(n log n)
      // sort that was re-running every frame on up to a million indices.
      let ascending = true;
      for (let i = 1; i < dirtyCount; i++) {
        if (dirty[i] < dirty[i - 1]) {
          ascending = false;
          break;
        }
      }
      if (!ascending) dirty.sort();
      this.#uploadPatchRanges(dirty, pointCount, (start, points) =>
        this.#uploadMercatorRange(start * 2, points * 2)
      );
    }
    this.#requestGpuPaint();
    return this;
  }

  /** Patch one vertex RGBA (0..1) without rebuilding the full color buffer. */
  patchColor(index: number, rgba: ArrayLike<number>): this {
    if (!this._useVertexColor || index < 0 || index * 4 + 3 >= this.colors.length) return this;
    const o = index * 4;
    this._colorBuf[o] = floatToByte(Number(rgba[0]) || 0);
    this._colorBuf[o + 1] = floatToByte(Number(rgba[1]) || 0);
    this._colorBuf[o + 2] = floatToByte(Number(rgba[2]) || 0);
    this._colorBuf[o + 3] = floatToByte(Number(rgba[3]) || this.options.opacity);
    this.#uploadColorRange(o, 4);
    this.#requestGpuPaint();
    return this;
  }

  /** Patch one vertex size without rebuilding coordinates or color buffers. */
  patchSize(index: number, size: number): this {
    if (!this._useVertexSize || index < 0 || index >= this.sizes.length) return this;
    const next = normalizePointSize(size, this.options.pointSize);
    const prev = this._sizeBuf[index];
    if (next === prev) return this;
    this._sizeBuf[index] = next;
    if (next > this._maxVertexSize) {
      this._maxVertexSize = next;
    } else if (prev === this._maxVertexSize && next < prev) {
      this.#recomputeMaxVertexSize();
    }
    this.#uploadSizeRange(index, 1);
    this.#requestGpuPaint();
    return this;
  }

  /**
   * Patch many vertex colors/sizes in one pass. GPU writes are merged into
   * contiguous ranges and large/fragmented batches fall back to one full upload.
   */
  patchStyles(
    indices: ArrayLike<number>,
    colors: ArrayLike<number> | null = null,
    sizes: ArrayLike<number> | null = null,
    count = indices.length
  ): this {
    const n = Math.min(indices.length, Math.max(0, Math.floor(count)));
    if (n <= 0 || (!colors && !sizes)) return this;

    if (this._stylePatchIndexScratch.length < n) {
      this._stylePatchIndexScratch = new Uint32Array(n);
    }

    let maxCouldShrink = false;
    let dirtyCount = 0;
    let hasColorPatch = false;
    let hasSizePatch = false;

    for (let i = 0; i < n; i++) {
      const index = Math.trunc(Number(indices[i]));
      if (!Number.isFinite(index) || index < 0 || index >= this._count / 2) continue;

      let patched = false;
      if (colors && this._useVertexColor && index * 4 + 3 < this.colors.length && i * 4 + 3 < colors.length) {
        const src = i * 4;
        const dst = index * 4;
        this._colorBuf[dst] = floatToByte(Number(colors[src]) || 0);
        this._colorBuf[dst + 1] = floatToByte(Number(colors[src + 1]) || 0);
        this._colorBuf[dst + 2] = floatToByte(Number(colors[src + 2]) || 0);
        this._colorBuf[dst + 3] = floatToByte(Number(colors[src + 3]) || this.options.opacity);
        hasColorPatch = true;
        patched = true;
      }

      if (sizes && this._useVertexSize && index < this.sizes.length && i < sizes.length) {
        const prev = this._sizeBuf[index];
        const next = normalizePointSize(sizes[i], this.options.pointSize);
        if (next !== prev) {
          if (prev === this._maxVertexSize && next < prev) maxCouldShrink = true;
          this._sizeBuf[index] = next;
          if (next > this._maxVertexSize) this._maxVertexSize = next;
        }
        hasSizePatch = true;
        patched = true;
      }

      if (patched) this._stylePatchIndexScratch[dirtyCount++] = index;
    }

    if (dirtyCount <= 0) return this;
    if (maxCouldShrink) this.#recomputeMaxVertexSize();

    const dirty = this._stylePatchIndexScratch.subarray(0, dirtyCount);
    dirty.sort();
    if (hasColorPatch) this.#uploadColorPatchRanges(dirty);
    if (hasSizePatch) this.#uploadSizePatchRanges(dirty);
    this.#requestGpuPaint();
    return this;
  }

  /**
   * Load precomputed lat/lng + absolute mercator buffers (skips normalize + merc encode).
   * Used by ObjectManager filter restore / compact paths at 100k–1M.
   */
  setPackedData(
    latlng: Float32Array | null,
    merc64: MercatorBuffer,
    options: WebGLPointDataOptions = {}
  ): this {
    // `latlng` may be null: a non-interactive layer derives degrees from the mercator
    // anyway, so requiring the caller to build and hold a second array forced 8 bytes
    // per point on them for data neither side reads.
    const count = latlng ? Math.min(latlng.length, merc64.length) : merc64.length;
    const even = count - (count % 2);
    // Degrees are only kept for an interactive layer, matching `setData()`. Holding
    // them here as well cost 8 bytes per point for data nothing reads — a third of a
    // million-point layer — when they can be derived from the mercator on demand.
    const needLatLng = this.options.interactive;
    // `adopt` can only keep a buffer whose element type matches this layer's
    // `mercatorPrecision`; a mismatch falls through to the copying path below.
    const keepLatLng = needLatLng && latlng !== null;
    if (options.adopt && this.#mercMatches(merc64)) {
      if (even === merc64.length && (!latlng || even === latlng.length)) {
        this._latlngBuf = keepLatLng ? (latlng as Float32Array<ArrayBuffer>) : new Float32Array(0);
        this._merc64 = merc64;
      } else {
        this._latlngBuf = keepLatLng ? new Float32Array(even) : new Float32Array(0);
        this._merc64 = this.#newMerc(even);
        if (keepLatLng) this._latlngBuf.set(latlng!.subarray(0, even));
        this._merc64.set(merc64.subarray(0, even));
      }
      this._packedAdopted = true;
    } else {
      if (this._packedAdopted || this._latlngBuf.length < even) {
        this._latlngBuf = keepLatLng ? new Float32Array(even) : new Float32Array(0);
        this._merc64 = this.#newMerc(even);
        this._packedAdopted = false;
      }
      if (keepLatLng) this._latlngBuf.set(latlng!.subarray(0, even));
      this._merc64.set(merc64.subarray(0, even));
    }
    this._count = even;
    this._latlngValid = keepLatLng;
    this.pointData = [];
    this.#enterMercatorMode();
    this.#applyColors(options.colors, even / 2);
    this.#applySizes(options.sizes, even / 2);
    this.#rebuildPickIndex();
    this._refZoom = Number.NaN;
    this._bufferDirty = true;
    this._forceGpu = true;
    this.render();
    return this;
  }

  /**
   * Absolute float64 mercator pairs (same length as `points`).
   *
   * Under `mercatorPrecision: "f32"` the layer has no float64 copy to hand back, so
   * this widens into a new array instead of returning a view. Use `getMercatorAbs()`
   * to read the stored buffer without that copy.
   */
  getMercator64(): Float64Array {
    this.#ensureMerc();
    const stored = this._merc64.subarray(0, this._count);
    return stored instanceof Float64Array ? stored : Float64Array.from(stored);
  }

  /** Stored absolute mercator, in whichever precision this layer uses. No copy. */
  getMercatorAbs(): MercatorBuffer {
    this.#ensureMerc();
    return this._merc64.subarray(0, this._count);
  }

  /** Packed lat/lng pairs, derived from the mercator buffer if not already stored. */
  getLatLngBuf(): Float32Array {
    return this.points;
  }

  /** Interleaved RGBA floats in 0..1 (converted from the packed GPU bytes). */
  getColorBuf(): Float32Array {
    const n = this.colors.length;
    if (this._colorFloat.length < n) this._colorFloat = new Float32Array(n);
    const src = this._colorBuf;
    const dst = this._colorFloat;
    for (let i = 0; i < n; i++) dst[i] = src[i] * (1 / 255);
    return dst.subarray(0, n);
  }

  getSizeBuf(): Float32Array {
    return this._sizeBuf.subarray(0, this.sizes.length);
  }

  addData(points: Iterable<WebGLPointInput>): this {
    const existing: WebGLPointInput[] = [];
    for (let i = 0; i < this._count; i += 2) {
      existing.push({ lat: this.points[i], lng: this.points[i + 1] });
    }
    for (const item of points) existing.push(item);
    return this.setData(existing);
  }

  clear(): this {
    this._count = 0;
    this._latlngValid = true;
    this.colors = new Uint8Array();
    this.sizes = new Float32Array();
    this._merc64 = this.#newMerc(0);
    this._stage = new Float32Array(0);
    this._encodedCount = 0;
    this.#enterMercatorMode();
    this._colorBuf = new Uint8Array(0);
    this._colorFloat = new Float32Array(0);
    this._sizeBuf = new Float32Array(0);
    this.pointData = [];
    // Everything else that scales with the point count, so an emptied layer stops
    // holding a dataset's worth of memory — `_latlngBuf` especially, which may be
    // storage the caller lent us through `setPackedData(..., { adopt: true })`.
    this._latlngBuf = new Float32Array(0);
    this._packedAdopted = false;
    this._scratch = new Float32Array(0);
    this._scratchColors = new Float32Array(0);
    this._stylePatchIndexScratch = new Uint32Array(0);
    this._pointPatchIndexScratch = new Uint32Array(0);
    this._pickIndex.clear();
    this._gpuMercBytes = 0;
    this._gpuColorBytes = 0;
    this._gpuSizeBytes = 0;
    this._useVertexColor = false;
    this._useVertexSize = false;
    this._maxVertexSize = 0;
    this._refZoom = Number.NaN;
    this._bufferDirty = true;
    this._colorDirty = true;
    this._sizeDirty = true;
    this._hasPainted = false;
    this._forceGpu = true;
    this.#clearSettleTimer();
    this.render();
    return this;
  }

  override bindPopup(content: OverlayContent, options?: PopupOptions): this {
    this.setInteractive(true);
    return super.bindPopup(content, options);
  }

  setInteractive(enabled: boolean): this {
    const next = Boolean(enabled);
    const was = this.options.interactive;
    this.writableOptions.interactive = next;
    if (this.canvas) this.canvas.style.pointerEvents = next ? "auto" : "none";
    if (next && !was) this.#rebuildPickIndex();
    else if (!next && was) this._pickIndex.clear();
    this.#syncInteraction();
    return this;
  }

  setViewTransform(options: { rotation?: number; pitch?: number }): this {
    if (typeof options.rotation === "number") this.writableOptions.rotation = options.rotation;
    if (typeof options.pitch === "number") this.writableOptions.pitch = Math.max(0, Math.min(60, options.pitch));
    this.render();
    return this;
  }

  /** Public hit-test for ObjectManager hover / bench sampling. */
  hitTestAt(clientX: number, clientY: number, tolerance = this.options.hitTolerance): {
    index: number;
    latlng: LatLngLike;
    containerPoint: { x: number; y: number };
  } | null {
    return this.#hitTest(clientX, clientY, tolerance);
  }

  queryHit(point: Point, options: ResolvedQueryOptions): QueryHit | null {
    if (!this.map || !this.options.interactive) return null;
    const rect = this.map.container.getBoundingClientRect();
    const hit = this.#hitTest(rect.left + point.x, rect.top + point.y, options.tolerance);
    return hit ? {
      layer: this,
      latlng: latLng(hit.latlng),
      source: "webgl",
      index: hit.index,
      feature: this.pointData[hit.index]
    } : null;
  }

  getStats(): WebGLPointLayerStats {
    // Count used mercator slots (not spare capacity from over-allocation on filtered
    // inputs), at whatever `mercatorPrecision` this layer actually stores them in.
    // Under GPU projection the mercator is derived and may not exist at all; what is always
    // resident is the float64 degree store.
    const merc64Bytes = (this._gpuProject ? Math.min(this._merc64.length, this._count) : this._count) * this._merc64.BYTES_PER_ELEMENT
      + (this._gpuProject ? this._count * Float64Array.BYTES_PER_ELEMENT : 0);
    // Degrees only cost anything once something has asked for them.
    const latlngBytes = this._latlngValid ? this._count * Float32Array.BYTES_PER_ELEMENT : 0;
    return {
      points: this._count / 2,
      rendered: this._lastRendered,
      renderer: this.renderer,
      // What the dataset itself costs. Camera-relative mercator is no longer stored
      // per point — it is streamed to the GPU through a shared window capped at
      // 256 KB, which is not counted here because it does not scale with the data.
      bufferBytes: latlngBytes + merc64Bytes + this.colors.byteLength + this.sizes.byteLength,
      vertexColors: this._useVertexColor,
      vertexSizes: this._useVertexSize,
      pickIndex: this._pickIndex.size
    };
  }

  /** Hide the canvas without dropping GPU buffers (heatmap / cluster overlays). */
  setHidden(hidden: boolean): this {
    this._hidden = hidden;
    if (hidden) this.#clearSettleTimer();
    if (this.canvas) {
      this.canvas.style.display = hidden ? "none" : "";
      if (!hidden) {
        this.canvas.style.transform = "none";
        this._forceGpu = true;
      }
    }
    return this;
  }

  override wantsFrameRender(): boolean {
    return !this._hidden && this._count > 0;
  }

  override render(): void {
    if (this._hidden || !this.map || !this.canvas) return;
    const dpr = Math.min(this.options.maxDpr, window.devicePixelRatio || 1);
    const cssW = this.map.size.width;
    const cssH = this.map.size.height;
    const pad = this.#overscanPad(cssW, cssH);
    const drawW = cssW + pad * 2;
    const drawH = cssH + pad * 2;
    const width = Math.max(1, Math.round(drawW * dpr));
    const height = Math.max(1, Math.round(drawH * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this._forceGpu = true;
      this._hasPainted = false;
    }

    const zoom = this.map.zoom;
    const ox = this.map.pixelOrigin.x;
    const oy = this.map.pixelOrigin.y;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const canWarp =
      this.renderer === "webgl" &&
      this._hasPainted &&
      Number.isFinite(this._paintedZoom) &&
      !this._forceGpu &&
      !this._bufferDirty &&
      !this._colorDirty &&
      !this._sizeDirty;

    if (canWarp) {
      const warpCovers = cameraWarpCoversViewport(
        { x: this._paintedOriginX, y: this._paintedOriginY },
        this._paintedZoom,
        { x: ox, y: oy },
        zoom,
        { width: cssW, height: cssH },
        undefined,
        this._paintedPad
      );
      // A large layer cannot repaint every frame of a gesture: a 1M-point GPU pass overruns the
      // frame budget, and the repaint path resets the transform, so a stalled frame shows the
      // stale surface unwarped — points visibly jump and snap back when the pass lands. While
      // the budget is spent, keep warping the exact frame we have even though it no longer
      // covers the viewport: briefly missing overdraw at the edges beats a moving picture.
      const minInterval = this._count / 2 >= 250_000 ? 150 : 80;
      const throttled = !warpCovers && now - this._lastGpuMs < minInterval;
      if (warpCovers || throttled) {
        const s = 2 ** (zoom - this._paintedZoom);
        // The canvas sits at `-paintedPad`, so its own origin is that far outside the container and
        // scaling about it moves that offset too: without the last term every point lands
        // `paintedPad * (s - 1)` px away — 120 px at one zoom level in — and snaps back when the
        // repaint lands. Panning kept `s === 1`, which is why only zoom showed it.
        const tx = this._paintedOriginX * s - ox - this._paintedPad * (s - 1);
        const ty = this._paintedOriginY * s - oy - this._paintedPad * (s - 1);
        if (s === 1 && tx * tx + ty * ty < 1e-4) return;
        this.canvas.style.left = `${-this._paintedPad}px`;
        this.canvas.style.top = `${-this._paintedPad}px`;
        this.canvas.style.transformOrigin = "0 0";
        this.canvas.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${s})`;
        this.#scheduleSettledGpu(throttled ? Math.max(16, minInterval - (now - this._lastGpuMs)) : 120);
        return;
      }
    }

    this.canvas.style.left = `${-pad}px`;
    this.canvas.style.top = `${-pad}px`;
    this.canvas.style.width = `${drawW}px`;
    this.canvas.style.height = `${drawH}px`;
    this.canvas.style.transform = "none";
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    if (this.renderer === "webgl") this.#renderWebGL(dpr, pad);
    else if (this.renderer === "canvas") this.#renderCanvas(dpr);
    this._paintedZoom = zoom;
    this._paintedOriginX = ox;
    this._paintedOriginY = oy;
    this._paintedPad = pad;
    this._hasPainted = true;
    this._forceGpu = false;
    this._lastGpuMs = now;
    this.#clearSettleTimer();
  }

  #overscanPad(cssW: number, cssH: number): number {
    if (this.renderer !== "webgl") return 0;
    const count = this._count / 2;
    if (count < 8_000) return 0;
    return Math.round(Math.min(280, Math.max(120, Math.min(cssW, cssH) * 0.24)));
  }

  #cameraMovedFromPaint(): boolean {
    if (!this.map || !this._hasPainted) return false;
    return (
      this.map.zoom !== this._paintedZoom ||
      this.map.pixelOrigin.x !== this._paintedOriginX ||
      this.map.pixelOrigin.y !== this._paintedOriginY
    );
  }

  /** Color/size patches: draw now when idle, wait for CSS-warp settle while gesturing. */
  #requestGpuPaint(): void {
    if (this.#cameraMovedFromPaint()) this.#scheduleSettledGpu();
    else this._forceGpu = true;
  }

  #scheduleSettledGpu(delay = 120): void {
    this.#clearSettleTimer();
    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      this._forceGpu = true;
      this.render();
    }, delay);
  }

  #clearSettleTimer(): void {
    if (this._settleTimer == null) return;
    clearTimeout(this._settleTimer);
    this._settleTimer = null;
  }

  #applyColors(colors: ArrayLike<number> | null | undefined, pointCount: number): void {
    if (!colors || pointCount <= 0) {
      this._useVertexColor = false;
      this.colors = new Uint8Array();
      this._colorBuf = new Uint8Array(0);
      this._colorDirty = true;
      this._gpuColorBytes = 0;
      return;
    }
    const need = pointCount * 4;
    if (this._colorBuf.length < need) this._colorBuf = new Uint8Array(need);
    const dst = this._colorBuf;
    const n = Math.min(need, colors.length);
    for (let i = 0; i < n; i++) dst[i] = floatToByte(Number(colors[i]) || 0);
    const alphaByte = floatToByte(this.options.opacity);
    for (let i = n; i < need; i++) dst[i] = i % 4 === 3 ? alphaByte : 0;
    this.colors = dst.subarray(0, need);
    this._useVertexColor = true;
    this._colorDirty = true;
  }

  #applySizes(sizes: ArrayLike<number> | null | undefined, pointCount: number): void {
    if (!sizes || pointCount <= 0) {
      this._useVertexSize = false;
      this.sizes = new Float32Array();
      this._sizeBuf = new Float32Array(0);
      this._sizeDirty = true;
      this._gpuSizeBytes = 0;
      this._maxVertexSize = 0;
      return;
    }
    if (this._sizeBuf.length < pointCount) this._sizeBuf = new Float32Array(pointCount);
    const dst = this._sizeBuf;
    const fallback = this.options.pointSize;
    let maxSize = 0;
    const n = Math.min(pointCount, sizes.length);
    for (let i = 0; i < n; i++) {
      const size = normalizePointSize(sizes[i], fallback);
      dst[i] = size;
      if (size > maxSize) maxSize = size;
    }
    for (let i = n; i < pointCount; i++) {
      dst[i] = fallback;
      if (fallback > maxSize) maxSize = fallback;
    }
    this.sizes = dst.subarray(0, pointCount);
    this._useVertexSize = true;
    this._maxVertexSize = maxSize;
    this._sizeDirty = true;
  }

  #recomputeMaxVertexSize(): void {
    let maxSize = 0;
    const sizes = this.sizes;
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] > maxSize) maxSize = sizes[i];
    }
    this._maxVertexSize = maxSize;
  }

  #initWebGL(): void {
    const gl = this.gl;
    if (!gl) return;
    const vertex = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 a_merc;
      attribute vec4 a_color;
      attribute float a_size;
      uniform float u_scale;
      uniform vec2 u_origin;
      uniform vec2 u_resolution;
      uniform float u_dpr;
      uniform float u_pointSize;
      uniform vec2 u_center;
      uniform float u_rotate;
      uniform float u_pitch;
      uniform float u_useVertexColor;
      uniform float u_useVertexSize;
      uniform vec4 u_color;
      // When set, a_merc carries (dLng, dLat) in degrees against a reference the CPU
      // subtracted in float64, and the mercator delta is computed here. u_refTan is
      // tan(pi/4 + refLat/2), computed on the CPU in float64.
      uniform float u_gpuProject;
      uniform float u_refTan;
      varying vec4 v_color;

      // log(1 + x) loses its leading digits for small x, which is the common case below.
      // Eight alternating terms hold float32 accuracy over |x| < 0.25; log() covers the rest.
      float log1p(float x) {
        if (abs(x) < 0.25) {
          float term = x;
          float sum = 0.0;
          for (int n = 1; n <= 8; n++) {
            sum += term / float(n);
            term *= -x;
          }
          return sum;
        }
        return log(1.0 + x);
      }

      // Mercator delta for a latitude offset, without ever forming two large mercator
      // values and subtracting them. With T = tan(pi/4 + ref/2) and t = tan(d/2):
      //   merc(ref + d) - merc(ref) = -(log1p(t/T) - log1p(-T*t)) / (2*pi)
      // Both log arguments are near zero, so float32 keeps its relative precision.
      // The GPU's tan() is not IEEE: for the ~1e-7 radian arguments a point a few pixels
      // from the reference produces at zoom 20, it came back with an absolute error near
      // 1e-6, which is forty pixels at latitude 84. Below a twentieth of a radian the
      // series is exact to float32 in five terms; past that the offset is degrees wide
      // and only reachable at zooms where a pixel is kilometres, so tan() is fine there.
      float halfAngleTan(float x) {
        if (abs(x) < 0.05) {
          float x2 = x * x;
          return x * (1.0 + x2 * (0.3333333333 + x2 * (0.1333333333 + x2 * 0.05396825397)));
        }
        return tan(x);
      }

      float mercDeltaY(float dLatDeg) {
        float t = halfAngleTan(radians(dLatDeg) * 0.5);
        float a = t / u_refTan;
        float b = -u_refTan * t;
        return -(log1p(a) - log1p(b)) / 6.283185307179586;
      }

      void main() {
        vec2 merc = u_gpuProject > 0.5
          ? vec2(a_merc.x / 360.0, mercDeltaY(a_merc.y))
          : a_merc;
        vec2 pixel = merc * u_scale - u_origin;
        if (u_rotate != 0.0 || u_pitch != 1.0) {
          vec2 d = pixel - u_center;
          d.y *= u_pitch;
          float c = cos(u_rotate);
          float s = sin(u_rotate);
          pixel = u_center + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
        }
        vec2 clip = ((pixel * u_dpr) / u_resolution) * 2.0 - 1.0;
        float pointSize = (u_useVertexSize > 0.5 ? a_size : u_pointSize);
        vec2 cssRes = u_resolution / max(u_dpr, 0.0001);
        if (pixel.x < -pointSize || pixel.y < -pointSize || pixel.x > cssRes.x + pointSize || pixel.y > cssRes.y + pointSize) {
          gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
          gl_PointSize = 0.0;
          v_color = vec4(0.0);
          return;
        }
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        gl_PointSize = pointSize * u_dpr;
        v_color = u_useVertexColor > 0.5 ? a_color : u_color;
      }
    `);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec4 v_color;
      uniform float u_round;
      void main() {
        if (u_round > 0.5) {
          vec2 offset = gl_PointCoord - vec2(0.5);
          if (dot(offset, offset) > 0.25) discard;
        }
        gl_FragColor = v_color;
      }
    `);
    if (!vertex || !fragment) {
      this.renderer = this.options.fallbackCanvas ? "canvas" : "none";
      return;
    }
    this.program = linkProgram(gl, vertex, fragment);
    if (!this.program) {
      this.renderer = this.options.fallbackCanvas ? "canvas" : "none";
      return;
    }
    this.buffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    this.sizeBuffer = gl.createBuffer();
    this._glLocations = {
      aMerc: gl.getAttribLocation(this.program, "a_merc"),
      aColor: gl.getAttribLocation(this.program, "a_color"),
      aSize: gl.getAttribLocation(this.program, "a_size"),
      uScale: gl.getUniformLocation(this.program, "u_scale"),
      uOrigin: gl.getUniformLocation(this.program, "u_origin"),
      uResolution: gl.getUniformLocation(this.program, "u_resolution"),
      uDpr: gl.getUniformLocation(this.program, "u_dpr"),
      uPointSize: gl.getUniformLocation(this.program, "u_pointSize"),
      uColor: gl.getUniformLocation(this.program, "u_color"),
      uUseVertexColor: gl.getUniformLocation(this.program, "u_useVertexColor"),
      uUseVertexSize: gl.getUniformLocation(this.program, "u_useVertexSize"),
      uCenter: gl.getUniformLocation(this.program, "u_center"),
      uRotate: gl.getUniformLocation(this.program, "u_rotate"),
      uPitch: gl.getUniformLocation(this.program, "u_pitch"),
      uRound: gl.getUniformLocation(this.program, "u_round"),
      uGpuProject: gl.getUniformLocation(this.program, "u_gpuProject"),
      uRefTan: gl.getUniformLocation(this.program, "u_refTan")
    };
    this._bufferDirty = true;
    this._colorDirty = true;
    this._sizeDirty = true;
  }

  #uploadMercatorIfNeeded(): void {
    const gl = this.gl;
    if (!gl || !this.buffer || !this._bufferDirty) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const floats = this._count;
    const bytes = floats * Float32Array.BYTES_PER_ELEMENT;
    // Reuse GPU storage on live updates — repeated bufferData(STATIC) leaks VRAM on some drivers.
    if (bytes === 0 || bytes !== this._gpuMercBytes) {
      // Allocate without data, then stream the contents in through the window.
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
      this._gpuMercBytes = bytes;
    }
    if (bytes > 0) this.#streamMercator(gl, 0, floats);
    this._bufferDirty = false;
  }

  /** Encode `[floatOffset, floatOffset + floatCount)` window by window into the bound buffer. */
  #streamMercator(gl: WebGLRenderingContext, floatOffset: number, floatCount: number): void {
    const window = this.#stageWindow(floatCount);
    for (let done = 0; done < floatCount; done += window.length) {
      const chunk = Math.min(window.length, floatCount - done);
      this.#encodeInto(window, 0, floatOffset + done, chunk);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        (floatOffset + done) * Float32Array.BYTES_PER_ELEMENT,
        chunk === window.length ? window : window.subarray(0, chunk)
      );
    }
  }

  #uploadColorsIfNeeded(): void {
    const gl = this.gl;
    if (!gl || !this.colorBuffer || !this._colorDirty) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    if (!this._useVertexColor || !this.colors.length) {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
      this._gpuColorBytes = 0;
      this._colorDirty = false;
      return;
    }
    const bytes = this.colors.byteLength;
    if (bytes > 0 && bytes === this._gpuColorBytes) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.colors);
    } else {
      gl.bufferData(gl.ARRAY_BUFFER, this.colors, gl.DYNAMIC_DRAW);
      this._gpuColorBytes = bytes;
    }
    this._colorDirty = false;
  }

  #uploadSizesIfNeeded(): void {
    const gl = this.gl;
    if (!gl || !this.sizeBuffer || !this._sizeDirty) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    if (!this._useVertexSize || !this.sizes.length) {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
      this._gpuSizeBytes = 0;
      this._sizeDirty = false;
      return;
    }
    const bytes = this.sizes.byteLength;
    if (bytes > 0 && bytes === this._gpuSizeBytes) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sizes);
    } else {
      gl.bufferData(gl.ARRAY_BUFFER, this.sizes, gl.DYNAMIC_DRAW);
      this._gpuSizeBytes = bytes;
    }
    this._sizeDirty = false;
  }

  #uploadMercatorRange(floatOffset: number, floatCount: number): void {
    const gl = this.gl;
    if (!gl || !this.buffer || floatCount <= 0) return;
    if (this._gpuMercBytes !== this._count * Float32Array.BYTES_PER_ELEMENT) {
      this._bufferDirty = true;
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    this.#streamMercator(gl, floatOffset, floatCount);
  }

  #uploadColorRange(byteOffset: number, byteCount: number): void {
    const gl = this.gl;
    if (!gl || !this.colorBuffer || byteCount <= 0 || !this._useVertexColor) return;
    if (this._gpuColorBytes !== this.colors.byteLength) {
      this._colorDirty = true;
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      byteOffset,
      this._colorBuf.subarray(byteOffset, byteOffset + byteCount)
    );
  }

  #uploadSizeRange(floatOffset: number, floatCount: number): void {
    const gl = this.gl;
    if (!gl || !this.sizeBuffer || floatCount <= 0 || !this._useVertexSize) return;
    if (this._gpuSizeBytes !== this.sizes.byteLength) {
      this._sizeDirty = true;
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      floatOffset * 4,
      this._sizeBuf.subarray(floatOffset, floatOffset + floatCount)
    );
  }

  #uploadColorPatchRanges(indices: Uint32Array): void {
    const pointCount = this.colors.length / 4;
    if (pointCount <= 0 || indices.length <= 0) return;
    this.#uploadPatchRanges(indices, pointCount, (start, count) => this.#uploadColorRange(start * 4, count * 4));
  }

  #uploadSizePatchRanges(indices: Uint32Array): void {
    const pointCount = this.sizes.length;
    if (pointCount <= 0 || indices.length <= 0) return;
    this.#uploadPatchRanges(indices, pointCount, (start, count) => this.#uploadSizeRange(start, count));
  }

  #uploadPatchRanges(
    indices: Uint32Array,
    pointCount: number,
    upload: (start: number, count: number) => void
  ): void {
    // Merge nearby slots to amortize WebGL driver calls, but do not promote a
    // sparse batch to a full-buffer upload merely because it has many ranges.
    // The old `rangeCount > 256` rule turned 1k scattered updates on a 1M-point
    // layer into a ~4 MB upload. Estimate driver-call overhead in point units
    // and choose the cheaper plan instead.
    const mergeGap = 8;
    const fullUploadRatio = 0.15;
    const callPenaltyPoints = 512;

    let uniqueCount = 0;
    let rangeCount = 0;
    let coveredPoints = 0;
    let rangeStart = -1;
    let rangeEnd = -1;

    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      if (index === rangeEnd) continue;
      uniqueCount += 1;

      if (rangeStart < 0) {
        rangeStart = index;
        rangeEnd = index;
        rangeCount = 1;
        continue;
      }
      if (index <= rangeEnd + mergeGap + 1) {
        rangeEnd = index;
        continue;
      }

      coveredPoints += rangeEnd - rangeStart + 1;
      rangeStart = index;
      rangeEnd = index;
      rangeCount += 1;
    }
    if (rangeStart >= 0) coveredPoints += rangeEnd - rangeStart + 1;

    const denseEnoughForFullUpload = uniqueCount >= Math.ceil(pointCount * fullUploadRatio);
    const estimatedPartialCost = coveredPoints + rangeCount * callPenaltyPoints;
    if (denseEnoughForFullUpload || estimatedPartialCost >= pointCount) {
      upload(0, pointCount);
      return;
    }

    let start = -1;
    let end = -1;
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      if (index === end) continue;
      if (start < 0) {
        start = index;
        end = index;
        continue;
      }
      if (index <= end + mergeGap + 1) {
        end = index;
        continue;
      }
      upload(start, end - start + 1);
      start = index;
      end = index;
    }
    if (start >= 0) upload(start, end - start + 1);
  }

  /**
   * Encode absolute float64 mercator as camera-relative float32 for the GPU.
   * Avoids `float32(absoluteMerc) * 2^z` precision collapse at high zoom.
   *
   * Re-encode only when data changes or the camera has drifted far in *pixel*
   * space relative to the current mercator ref. Zoom-only changes must NOT
   * trigger a full CPU pass — otherwise continuous zoom stress rewrites every
   * point every frame (~1 FPS at 1M).
   */
  #ensureRelativeEncoding(): void {
    if (!this.map) return;
    const count = this._count;
    if (!count) {
      this._encodedCount = 0;
      return;
    }

    const scale = TILE_SIZE * 2 ** this.map.zoom;
    const ox = this.map.pixelOrigin.x;
    const oy = this.map.pixelOrigin.y;
    // Residual if we keep the existing mercator ref (stable across zoom-only updates).
    const pixelDrift = Math.hypot(ox - this._refMx * scale, oy - this._refMy * scale);
    // float32 relative mercator stays sub-pixel accurate far beyond a few kpx of drift.
    const REENCODE_DRIFT_PX = 8192;
    if (!this._bufferDirty && pixelDrift <= REENCODE_DRIFT_PX && this._encodedCount === count) {
      return;
    }

    this._refMx = ox / scale;
    this._refMy = oy / scale;
    this.#deriveDegreeReference();
    this._refZoom = this.map.zoom;
    this._refOriginX = ox;
    this._refOriginY = oy;

    // Encoding itself happens during the upload, straight out of `_merc64`.
    this._encodedCount = count;
    this._bufferDirty = true;
  }

  /** Fast screen projection from absolute float64 mercator. */
  #mercatorToScreen(mx: number, my: number, scale: number, originX: number, originY: number): { x: number; y: number } {
    let x = mx * scale - originX;
    let y = my * scale - originY;
    if (this.options.rotation !== 0 || this.options.pitch !== 0) {
      const transformed = this.#transformPoint(x, y);
      x = transformed.x;
      y = transformed.y;
    }
    return { x, y };
  }

  #projectVisibleCanvas(dpr: number): { xy: Float32Array; indices: Int32Array } {
    this.#ensureMerc();
    if (!this.map || !this._count) {
      this._lastRendered = 0;
      return { xy: new Float32Array(), indices: new Int32Array() };
    }

    const map = this.map;
    const scale = TILE_SIZE * 2 ** map.zoom;
    const originX = map.pixelOrigin.x;
    const originY = map.pixelOrigin.y;
    const width = map.size.width;
    const height = map.size.height;
    const padding = (this._useVertexSize ? Math.max(this.options.pointSize, this._maxVertexSize) : this.options.pointSize) + 2;
    const source = this._merc64;
    const needed = this._count;
    if (this._scratch.length < needed) this._scratch = new Float32Array(needed);
    const indexBuf = this._scratchColors.length >= needed
      ? this._scratchColors
      : (this._scratchColors = new Float32Array(needed));
    const projected = this._scratch;
    let write = 0;
    let indexWrite = 0;
    const cull = this.options.cull !== false;

    for (let index = 0; index < needed; index += 2) {
      const point = this.#mercatorToScreen(source[index], source[index + 1], scale, originX, originY);
      if (cull && (point.x < -padding || point.y < -padding || point.x > width + padding || point.y > height + padding)) {
        continue;
      }
      projected[write++] = point.x * dpr;
      projected[write++] = point.y * dpr;
      indexBuf[indexWrite++] = index / 2;
    }

    this._lastRendered = write / 2;
    const indices = new Int32Array(indexWrite);
    for (let i = 0; i < indexWrite; i++) indices[i] = indexBuf[i];
    return { xy: projected.subarray(0, write), indices };
  }

  #transformPoint(x: number, y: number): { x: number; y: number } {
    if (!this.map) return { x, y };
    const rotation = (this.options.rotation * Math.PI) / 180;
    const pitchScale = Math.cos((this.options.pitch * Math.PI) / 180);
    if (!rotation && this.options.pitch === 0) return { x, y };
    const cx = this.map.size.width / 2;
    const cy = this.map.size.height / 2;
    const dx = x - cx;
    const dy = (y - cy) * pitchScale;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos
    };
  }

  #syncInteraction(): void {
    this._interactionUnsub?.();
    this._interactionUnsub = null;
    if (!this.canvas || !this.options.interactive) return;
    const unsubs = [
      listenTap(this.canvas, (event) => {
        const hit = this.#hitTest(event.clientX, event.clientY);
        if (!hit) return;
        event.preventDefault();
        event.stopPropagation();
        this.emit("click", {
          originalEvent: event,
          latlng: hit.latlng,
          containerPoint: hit.containerPoint,
          index: hit.index,
          data: this.pointData[hit.index]
        });
      }),
      listen(this.canvas, "mousemove", (event) => {
        const hit = this.#hitTest(event.clientX, event.clientY);
        this.emit("hover", {
          originalEvent: event,
          latlng: hit?.latlng ?? null,
          containerPoint: hit?.containerPoint ?? null,
          index: hit ? hit.index : -1,
          data: hit ? this.pointData[hit.index] : null
        });
      }),
      listen(this.canvas, "mouseleave", (event) => {
        this.emit("hover", {
          originalEvent: event,
          latlng: null,
          containerPoint: null,
          index: -1,
          data: null
        });
      })
    ];
    this._interactionUnsub = () => {
      for (const off of unsubs) off();
    };
  }

  #rebuildPickIndex(): void {
    this._pickIndex.clear();
    if (!this.options.interactive) return;
    // Under GPU projection the float64 degrees are right there; going through the
    // `points` getter would narrow them to float32 for nothing.
    const pts: ArrayLike<number> = this._gpuProject ? this._latlng64 : this.points;
    const n = this._count;
    for (let i = 0; i < n; i += 2) this._pickIndex.set(i / 2, { lat: pts[i], lng: pts[i + 1] }, i / 2);
  }

  #hitTest(clientX: number, clientY: number, hitTolerance = this.options.hitTolerance): {
    index: number;
    latlng: LatLngLike;
    containerPoint: { x: number; y: number };
  } | null {
    this.#ensureMerc();
    if (!this.map || !this._count) return null;
    const rect = this.map.container.getBoundingClientRect();
    const targetX = clientX - rect.left;
    const targetY = clientY - rect.top;
    const useVertexSize = this._useVertexSize && this.sizes.length > 0;
    const defaultRadius = Math.max(0, hitTolerance) + this.options.pointSize / 2;
    const maxRadius = useVertexSize
      ? Math.max(0, hitTolerance) + Math.max(this.options.pointSize, this._maxVertexSize) / 2
      : defaultRadius;
    const maxDistance = maxRadius * maxRadius;
    const scale = TILE_SIZE * 2 ** this.map.zoom;
    const originX = this.map.pixelOrigin.x;
    const originY = this.map.pixelOrigin.y;
    let nearest = -1;
    let nearestDistance = maxDistance;
    let nearestPoint = { x: 0, y: 0 };
    const merc = this._merc64;
    const count = this._count;
    const pointCount = count / 2;
    const rotated = this.options.rotation !== 0 || this.options.pitch !== 0;
    const consider = (index: number, point: { x: number; y: number }): void => {
      const radius = useVertexSize
        ? Math.max(0, hitTolerance) + (this.sizes[index] || this.options.pointSize) / 2
        : defaultRadius;
      const limit = radius * radius;
      const distance = (point.x - targetX) ** 2 + (point.y - targetY) ** 2;
      if (distance > limit || distance > nearestDistance) return;
      nearest = index;
      nearestDistance = distance;
      nearestPoint = point;
    };
    if (rotated || pointCount <= 256) {
      for (let index = 0; index < count; index += 2) {
        const point = this.#mercatorToScreen(merc[index], merc[index + 1], scale, originX, originY);
        consider(index / 2, point);
      }
    } else {
      const ll = this.map.containerPointToLatLng({ x: targetX, y: targetY });
      const pad = Math.max(0.002, (maxRadius / scale) * 360);
      for (const i of this._pickIndex.searchIds([{ lat: ll.lat - pad, lng: ll.lng - pad }, { lat: ll.lat + pad, lng: ll.lng + pad }])) {
        const point = this.#mercatorToScreen(merc[i * 2], merc[i * 2 + 1], scale, originX, originY);
        consider(i, point);
      }
    }
    if (nearest < 0) return null;
    return {
      index: nearest,
      latlng: { lat: this.points[nearest * 2], lng: this.points[nearest * 2 + 1] },
      containerPoint: nearestPoint
    };
  }

  #renderWebGL(dpr: number, pad = 0): void {
    const gl = this.gl;
    const locs = this._glLocations;
    if (!gl || !this.program || !this.buffer || !this.canvas || !locs || !this.map) return;

    const count = this._count / 2;
    this._lastRendered = count;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!count) return;

    this.#ensureRelativeEncoding();
    this.#uploadMercatorIfNeeded();
    this.#uploadColorsIfNeeded();
    this.#uploadSizesIfNeeded();

    const scale = TILE_SIZE * 2 ** this.map.zoom;
    const rotation = (this.options.rotation * Math.PI) / 180;
    const pitch = Math.cos((this.options.pitch * Math.PI) / 180);
    // Residual origin after relative encoding — stays small between re-encodes.
    const originX = this.map.pixelOrigin.x - this._refMx * scale - pad;
    const originY = this.map.pixelOrigin.y - this._refMy * scale - pad;

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(locs.aMerc);
    gl.vertexAttribPointer(locs.aMerc, 2, gl.FLOAT, false, 0, 0);

    if (this._useVertexColor && this.colorBuffer && locs.aColor >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.enableVertexAttribArray(locs.aColor);
      gl.vertexAttribPointer(locs.aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    } else if (locs.aColor >= 0) {
      gl.disableVertexAttribArray(locs.aColor);
      gl.vertexAttrib4f(locs.aColor, this.color.r / 255, this.color.g / 255, this.color.b / 255, this.options.opacity);
    }

    if (this._useVertexSize && this.sizeBuffer && locs.aSize >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sizeBuffer);
      gl.enableVertexAttribArray(locs.aSize);
      gl.vertexAttribPointer(locs.aSize, 1, gl.FLOAT, false, 0, 0);
    } else if (locs.aSize >= 0) {
      gl.disableVertexAttribArray(locs.aSize);
      gl.vertexAttrib1f(locs.aSize, this.options.pointSize);
    }

    gl.uniform1f(locs.uScale, scale);
    gl.uniform2f(locs.uOrigin, originX, originY);
    gl.uniform1f(locs.uGpuProject, this._gpuProject ? 1 : 0);
    gl.uniform1f(locs.uRefTan, this._refTan);
    gl.uniform2f(locs.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(locs.uDpr, dpr);
    gl.uniform1f(locs.uPointSize, this.options.pointSize);
    gl.uniform4f(
      locs.uColor,
      this.color.r / 255,
      this.color.g / 255,
      this.color.b / 255,
      this.options.opacity
    );
    gl.uniform1f(locs.uUseVertexColor, this._useVertexColor ? 1 : 0);
    gl.uniform1f(locs.uUseVertexSize, this._useVertexSize ? 1 : 0);
    gl.uniform2f(locs.uCenter, this.map.size.width / 2 + pad, this.map.size.height / 2 + pad);
    gl.uniform1f(locs.uRotate, rotation);
    gl.uniform1f(locs.uPitch, pitch);
    // Circles cost a discard per fragment; squares are cheaper at mass scale.
    gl.uniform1f(locs.uRound, count < 80_000 ? 1 : 0);

    gl.disable(gl.DITHER);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // Chunk large POINTS draws — some ANGLE/D3D drivers stall or drop a single 1M call.
    const CHUNK = 262144;
    if (count <= CHUNK) {
      gl.drawArrays(gl.POINTS, 0, count);
    } else {
      for (let start = 0; start < count; start += CHUNK) {
        gl.drawArrays(gl.POINTS, start, Math.min(CHUNK, count - start));
      }
    }
  }

  #renderCanvas(dpr: number): void {
    if (!this.canvas) return;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    const { xy, indices } = this.#projectVisibleCanvas(dpr);
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const useVertexColor = this._useVertexColor && this.colors.length >= indices.length * 4;
    const useVertexSize = this._useVertexSize && this.sizes.length > 0;
    const defaultRadius = Math.max(1, (this.options.pointSize * dpr) / 2);
    for (let i = 0; i < indices.length; i++) {
      const pointIndex = indices[i];
      if (useVertexColor) {
        const c = pointIndex * 4;
        context.globalAlpha = this.colors[c + 3] / 255;
        context.fillStyle = `rgb(${this.colors[c]},${this.colors[c + 1]},${this.colors[c + 2]})`;
      } else {
        context.globalAlpha = this.options.opacity;
        context.fillStyle = `rgb(${this.color.r},${this.color.g},${this.color.b})`;
      }
      const radius = useVertexSize
        ? Math.max(1, ((this.sizes[pointIndex] || this.options.pointSize) * dpr) / 2)
        : defaultRadius;
      context.beginPath();
      context.arc(xy[i * 2], xy[i * 2 + 1], radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }
}

export function webglPointLayer(points?: Iterable<WebGLPointInput>, options?: WebGLPointLayerOptions): WebGLPointLayer {
  return new WebGLPointLayer(points, options);
}

function normalizePoint(value: WebGLPointInput): { lat: number; lng: number } | null {
  const source = Array.isArray(value) || value instanceof Object && "lat" in value && "lng" in value
    ? value as LatLngLike
    : (value as { coordinates?: LatLngLike; latlng?: LatLngLike }).coordinates ?? (value as { latlng?: LatLngLike }).latlng;
  if (!source) return null;
  // Tuples stay ambiguous and `latLng()` is what rejects them; keep that contract.
  if (Array.isArray(source)) return latLng(source as never);
  if (!Number.isFinite(source.lat) || !Number.isFinite(source.lng)) return null;
  // Coordinates are already validated, and every caller only reads `.lat` / `.lng`.
  // Building a LatLng here allocated one object per point — a million of them for a
  // million-point ingest, and unlike a short-lived temporary this one escapes, so
  // the engine cannot optimise it away.
  return source;
}

/**
 * Growable lat/lng + absolute-mercator store for sources whose length is not known
 * up front (generators, `Set`, async iterables).
 *
 * The straightforward version stages coordinates in plain `number[]` and converts
 * once at the end, which costs 8 bytes per coordinate in boxed storage on top of
 * the typed arrays it is about to build — at a million points that is tens of
 * megabytes of garbage plus the churn of growing two arrays by doubling. Doubling
 * the typed arrays directly keeps one copy of the data instead of two.
 */
class PointPairStore {
  /** Degrees in float64, lat then lng; the layer projects these on the GPU. */
  latlng64: Float64Array;
  /** Floats written so far; two per point. */
  length = 0;

  constructor(pairHint = 0) {
    this.latlng64 = new Float64Array(Math.max(1024, Math.ceil(pairHint) * 2));
  }

  push(lat: number, lng: number): void {
    if (this.length + 2 > this.latlng64.length) this.#grow();
    this.latlng64[this.length] = lat;
    this.latlng64[this.length + 1] = lng;
    this.length += 2;
  }

  #grow(): void {
    const next = new Float64Array(this.latlng64.length * 2);
    next.set(this.latlng64);
    this.latlng64 = next;
  }

  /**
   * A buffer sized to what was actually written. Doubling can leave up to half the
   * capacity unused, and a subarray would pin the whole parent buffer anyway, so a
   * wasteful tail is worth one copy — a snug one is not.
   */
  take(): Float64Array<ArrayBufferLike> {
    const spare = this.latlng64.length - this.length;
    return spare === 0 || spare <= this.length / 4
      ? this.latlng64.subarray(0, this.length)
      : this.latlng64.slice(0, this.length);
  }
}

/** Element count when an iterable happens to expose one; 0 when it does not. */
function sizeHintOf(value: unknown): number {
  const sized = value as { length?: unknown; size?: unknown };
  const hint = typeof sized?.length === "number" ? sized.length : sized?.size;
  return typeof hint === "number" && Number.isFinite(hint) && hint > 0 ? hint : 0;
}

function normalizePointSize(value: unknown, fallback: number): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.max(1, Math.min(256, size));
}

function floatToByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}
