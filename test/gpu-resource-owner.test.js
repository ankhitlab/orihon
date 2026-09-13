import test from "node:test";
import assert from "node:assert/strict";
import { WebGlContextOwner, watchGpuDeviceLost } from "../dist/gpu-resource-owner.js";

/** Minimal EventTarget canvas stand-in for lifecycle unit tests. */
class FakeCanvas extends EventTarget {
  tagName = "CANVAS";
}

test("WebGlContextOwner transitions active → lost → rebuilding → active", async () => {
  const canvas = new FakeCanvas();
  const states = [];
  const owner = new WebGlContextOwner({
    onStateChange: (state) => states.push(state)
  });
  let restored = 0;
  let lost = 0;

  owner.attach(/** @type {any} */ (canvas), {
    onLost: () => {
      lost += 1;
    },
    onRestored: () => {
      restored += 1;
      return true;
    }
  });

  assert.equal(owner.state, "active");
  assert.equal(owner.usable, true);

  const lostEvent = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(lostEvent);
  assert.equal(lostEvent.defaultPrevented, true, "must preventDefault so the browser fires restored");
  assert.equal(owner.state, "lost");
  assert.equal(lost, 1);
  assert.equal(owner.usable, false);

  canvas.dispatchEvent(new Event("webglcontextrestored"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(restored, 1);
  assert.equal(owner.state, "active");
  assert.deepEqual(states.slice(-3), ["lost", "rebuilding", "active"]);

  owner.detach();
  assert.equal(owner.state, "detached");
  canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  assert.equal(lost, 1, "detached owner ignores further lost events");
});

test("WebGlContextOwner enters failed when onRestored returns false", async () => {
  const canvas = new FakeCanvas();
  const owner = new WebGlContextOwner();
  owner.attach(/** @type {any} */ (canvas), {
    onLost: () => {},
    onRestored: () => false
  });
  canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(owner.state, "failed");
});

test("watchGpuDeviceLost fires once then can be cancelled", async () => {
  let calls = 0;
  let settle;
  const lost = new Promise((resolve) => {
    settle = resolve;
  });
  const handle = watchGpuDeviceLost({ lost }, () => {
    calls += 1;
  });
  settle({ reason: "destroyed" });
  await lost;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);

  let ignored = 0;
  let settle2;
  const lost2 = new Promise((resolve) => {
    settle2 = resolve;
  });
  const cancelled = watchGpuDeviceLost({ lost: lost2 }, () => {
    ignored += 1;
  });
  cancelled.cancel();
  settle2({});
  await lost2;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ignored, 0);
});
