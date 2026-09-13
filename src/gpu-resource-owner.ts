/**
 * Shared GPU lifecycle for WebGL canvases and WebGPU devices.
 *
 * State machine: detached → active ⇄ lost → rebuilding → active | failed
 *
 * WebGL: listen for webglcontextlost / webglcontextrestored (preventDefault on lost
 * so the browser will fire restored). WebGPU: follow device.lost and drop the device.
 */

export type GpuLifecycleState = "detached" | "active" | "lost" | "rebuilding" | "failed";

export interface WebGlContextOwnerHooks {
  /** Drop GL object handles; the context is already gone — do not delete or loseContext. */
  onLost(): void;
  /**
   * Recreate programs, buffers and textures from retained CPU data.
   * Return false (or reject) to enter `failed`.
   */
  onRestored(): boolean | Promise<boolean>;
}

export interface WebGlContextOwnerOptions {
  /** Optional sink for lifecycle transitions (tests / diagnostics). */
  onStateChange?: (state: GpuLifecycleState, detail?: string) => void;
}

/**
 * Owns canvas listeners for one WebGL layer. Attach after a successful getContext;
 * detach before intentional loseContext in onRemove.
 */
type LoseContextExt = { loseContext(): void; restoreContext(): void };

export class WebGlContextOwner {
  state: GpuLifecycleState = "detached";
  #canvas: HTMLCanvasElement | null = null;
  #hooks: WebGlContextOwnerHooks | null = null;
  #options: WebGlContextOwnerOptions;
  #generation = 0;
  #loseExt: LoseContextExt | null = null;
  readonly #onLost = (event: Event): void => {
    event.preventDefault();
    if (this.state === "detached" || this.state === "lost" || this.state === "rebuilding") return;
    this.#setState("lost", "webglcontextlost");
    try {
      this.#hooks?.onLost();
    } catch {
      /* owner must stay consistent even if cleanup throws */
    }
  };
  readonly #onRestored = (event: Event): void => {
    void event;
    if (this.state !== "lost" && this.state !== "failed") return;
    const generation = ++this.#generation;
    this.#setState("rebuilding", "webglcontextrestored");
    void this.#runRestored(generation);
  };

  constructor(options: WebGlContextOwnerOptions = {}) {
    this.#options = options;
  }

  get usable(): boolean {
    return this.state === "active";
  }

  /**
   * @param gl Optional live context used only to cache `WEBGL_lose_context` for tests.
   */
  attach(canvas: HTMLCanvasElement, hooks: WebGlContextOwnerHooks, gl?: WebGLRenderingContext | WebGL2RenderingContext | null): void {
    this.detach();
    this.#canvas = canvas;
    this.#hooks = hooks;
    this.#loseExt = (gl?.getExtension("WEBGL_lose_context") as LoseContextExt | null) ?? null;
    canvas.addEventListener("webglcontextlost", this.#onLost, false);
    canvas.addEventListener("webglcontextrestored", this.#onRestored, false);
    this.#setState("active", "attach");
  }

  /** Remove listeners. Safe to call repeatedly; does not touch the GL context. */
  detach(): void {
    if (this.#canvas) {
      this.#canvas.removeEventListener("webglcontextlost", this.#onLost, false);
      this.#canvas.removeEventListener("webglcontextrestored", this.#onRestored, false);
    }
    this.#canvas = null;
    this.#hooks = null;
    this.#loseExt = null;
    this.#generation++;
    this.#setState("detached", "detach");
  }

  /** Test helper: simulate a lost event on the attached canvas. */
  loseForTest(): void {
    if (!this.#loseExt) throw new Error("WEBGL_lose_context is unavailable");
    this.#loseExt.loseContext();
  }

  /** Test helper: restore after {@link loseForTest}. */
  restoreForTest(): void {
    if (!this.#loseExt) throw new Error("WEBGL_lose_context is unavailable");
    this.#loseExt.restoreContext();
  }

  async #runRestored(generation: number): Promise<void> {
    let ok = false;
    try {
      ok = Boolean(await this.#hooks?.onRestored());
    } catch {
      ok = false;
    }
    if (generation !== this.#generation || this.state === "detached") return;
    this.#setState(ok ? "active" : "failed", ok ? "restored" : "restore-failed");
  }

  #setState(next: GpuLifecycleState, detail?: string): void {
    if (this.state === next && next !== "rebuilding") return;
    this.state = next;
    this.#options.onStateChange?.(next, detail);
  }
}

export interface GpuDeviceLostHandle {
  /** Stop observing; does not destroy the device. */
  cancel(): void;
}

/**
 * Watch `device.lost`. When it settles, invoke `onLost` once and clear any shared cache
 * via the callback (callers typically null their device pointer and retry acquisition).
 */
export function watchGpuDeviceLost(
  device: { lost: Promise<unknown>; destroy?: () => void },
  onLost: (info: unknown) => void
): GpuDeviceLostHandle {
  let cancelled = false;
  void Promise.resolve(device.lost).then((info) => {
    if (cancelled) return;
    try {
      onLost(info);
    } catch {
      /* ignore */
    }
  }, () => {
    /* some implementations reject; treat as loss */
    if (!cancelled) {
      try {
        onLost({ reason: "unknown" });
      } catch {
        /* ignore */
      }
    }
  });
  return {
    cancel() {
      cancelled = true;
    }
  };
}
