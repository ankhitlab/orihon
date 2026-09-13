/**
 * CPU performance contract for Orihon.
 *
 * Runs a fixed suite of Node CPU scenarios, takes the median of several samples,
 * Compares machine-normalized scores (scenario median / busy-loop calibrate) against
 * a committed baseline JSON. GitHub runners are noisy, so the default regression
 * threshold is 15% — not a 2–3% micro-gate.
 *
 * GPU / browser paint scenarios (point pan, MVT render, tile pan) are intentionally
 * out of this job; see bench/README.md.
 *
 * Usage:
 *   node --expose-gc scripts/perf-gate.mjs                 # run + compare
 *   node --expose-gc scripts/perf-gate.mjs --update-baseline
 *   node --expose-gc scripts/perf-gate.mjs --compare        # fail on regression only
 *   PERF_PROFILE=full node --expose-gc scripts/perf-gate.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

import { webglPointLayer } from "../dist/layers/webgl-point-layer.js";
import { objectManager } from "../dist/object-manager-entry.js";
import { buildClusterIndex } from "../dist/services/cluster-layout.js";
import { decodePackedMVT } from "../dist/layers/mvt.js";
import {
  buildHeatFieldCpu,
  createHeatFieldRequest,
  packHeatPoints
} from "../dist/services/heat-field.js";
import { buildHeatIsolinesFromField } from "../dist/services/heat-isolines.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS_DIR = join(ROOT, "bench", "results");
const BASELINES_DIR = join(ROOT, "bench", "baselines");

const args = new Set(process.argv.slice(2));
const UPDATE_BASELINE = args.has("--update-baseline");
const COMPARE_ONLY = args.has("--compare") || !UPDATE_BASELINE;

const PROFILE_NAME = String(process.env.PERF_PROFILE || "ci").toLowerCase();
const THRESHOLD = Math.max(0.01, Number(process.env.PERF_THRESHOLD || 0.15));
/** Absolute slack (ms) so sub-10ms scenarios are not flaky under runner noise. */
const ABS_MS = Math.max(0, Number(process.env.PERF_ABS_MS || 10));
const SAMPLE_OVERRIDE = process.env.PERF_SAMPLES ? Math.max(1, Number(process.env.PERF_SAMPLES)) : null;

const PROFILES = {
  ci: {
    points: 200_000,
    patch: 10_000,
    omIngest: 200_000,
    omCluster: 100_000,
    omSearch: 50_000,
    clusterIndex: 100_000,
    mvtFeatures: 8_000,
    mvtVerts: 8,
    heatPoints: 40_000,
    heatCols: 256,
    heatRows: 192,
    isolineLevels: 8,
    samples: 9
  },
  full: {
    points: 1_000_000,
    patch: 50_000,
    omIngest: 1_000_000,
    omCluster: 250_000,
    omSearch: 100_000,
    clusterIndex: 250_000,
    mvtFeatures: 15_000,
    mvtVerts: 8,
    heatPoints: 100_000,
    heatCols: 512,
    heatRows: 384,
    isolineLevels: 8,
    samples: 5
  }
};

const profile = PROFILES[PROFILE_NAME];
if (!profile) {
  console.error(`Unknown PERF_PROFILE=${PROFILE_NAME}. Use: ${Object.keys(PROFILES).join(", ")}`);
  process.exit(2);
}

const SAMPLES = SAMPLE_OVERRIDE ?? profile.samples;
const baselinePath = join(BASELINES_DIR, `cpu-${PROFILE_NAME}.json`);
const resultsPath = join(RESULTS_DIR, `cpu-${PROFILE_NAME}-latest.json`);
const gc = typeof globalThis.gc === "function" ? () => globalThis.gc() : () => {};

const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function busyCalibrateOnce() {
  let x = 0;
  const t0 = performance.now();
  for (let j = 0; j < 25_000_000; j++) x = (x + (j | 0)) | 0;
  const ms = performance.now() - t0;
  if (x === 0x7fffffff) process.stdout.write(""); // retain side effect for optimizers
  return ms;
}

async function calibrateMs() {
  const values = [];
  for (let i = 0; i < 5; i++) {
    gc();
    values.push(busyCalibrateOnce());
  }
  return median(values);
}

function withScores(scenarios, calibrate) {
  const out = {};
  for (const [name, stats] of Object.entries(scenarios)) {
    out[name] = {
      ...stats,
      score: Number((stats.medianMs / calibrate).toFixed(6))
    };
  }
  return out;
}

function p95(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

function fmt(n) {
  return new Intl.NumberFormat("en-US").format(n);
}

function makeLatLngPoints(count, seed = 0xC0FFEE) {
  const points = new Array(count);
  let state = seed >>> 0;
  const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
  for (let i = 0; i < count; i++) {
    points[i] = { lat: 35 + rnd() * 28, lng: -15 + rnd() * 55 };
  }
  return points;
}

function makePackedCoords(count, seed = 0xA11CE) {
  const coords = new Float64Array(count * 2);
  let state = seed >>> 0;
  const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 0x100000000);
  for (let i = 0; i < count; i++) {
    coords[i * 2] = 45 + rnd() * 20;
    coords[i * 2 + 1] = 20 + rnd() * 40;
  }
  return coords;
}

function makeOmBatch(start, count) {
  const batch = new Array(count);
  for (let i = 0; i < count; i++) {
    const id = start + i;
    const u = ((id * 2654435761) >>> 0) / 4294967296;
    const v = ((id * 1597334677) >>> 0) / 4294967296;
    batch[i] = {
      id,
      coordinates: { lat: 35 + u * 28, lng: -15 + v * 55 },
      properties: { name: `obj-${id}`, alert: id % 97 === 0 }
    };
  }
  return batch;
}

const encoder = new TextEncoder();
function varint(value) {
  let n = BigInt(value);
  const out = [];
  while (n > 0x7fn) {
    out.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}
function key(field, wire) {
  return varint((field << 3) | wire);
}
function bytesField(field, data) {
  return [...key(field, 2), ...varint(data.length), ...data];
}
function varintField(field, value) {
  return [...key(field, 0), ...varint(value)];
}
function zz(v) {
  return v < 0 ? (-v * 2 - 1) >>> 0 : (v * 2) >>> 0;
}
function makeGeometry(seed, vertices, close) {
  let x = (seed * 17) & 4095;
  let y = (seed * 29) & 4095;
  const out = [9, ...varint(zz(x)), ...varint(zz(y))];
  if (vertices > 1) {
    out.push(...varint(((vertices - 1) << 3) | 2));
    for (let i = 1; i < vertices; i++) {
      const nx = (x + 7 + (seed + i) % 31) & 4095;
      const ny = (y + 5 + (seed * 3 + i) % 23) & 4095;
      out.push(...varint(zz(nx - x)), ...varint(zz(ny - y)));
      x = nx;
      y = ny;
    }
  }
  if (close) out.push(15);
  return out;
}
function feature(id, type, geom, tags) {
  return [
    ...varintField(1, id),
    ...bytesField(2, tags.flatMap(varint)),
    ...varintField(3, type),
    ...bytesField(4, geom)
  ];
}
function valueString(v) {
  return bytesField(1, [...encoder.encode(v)]);
}
function valueNumber(v) {
  return varintField(4, v);
}
function valueBool(v) {
  return varintField(6, v ? 1 : 0);
}
function makeLayer(name, startId, count, vertices) {
  const out = [...bytesField(1, [...encoder.encode(name)])];
  for (let i = 0; i < count; i++) {
    const n = startId + i;
    const kind = n % 10;
    const type = kind < 3 ? 1 : kind < 8 ? 2 : 3;
    const points = type === 1 ? 1 : vertices;
    out.push(...bytesField(2, feature(n + 1, type, makeGeometry(n, points, type === 3), [0, 0, 1, 1, 2, 2])));
  }
  for (const k of ["class", "rank", "active"]) out.push(...bytesField(3, [...encoder.encode(k)]));
  for (const v of [valueString(name), valueNumber(7), valueBool(true)]) out.push(...bytesField(4, v));
  out.push(...varintField(5, 4096), ...varintField(15, 2));
  return out;
}
function makeSyntheticTile(count, vertices) {
  const a = Math.floor(count * 0.5);
  const b = Math.floor(count * 0.3);
  const c = count - a - b;
  return Uint8Array.from([
    ...bytesField(3, makeLayer("roads", 0, a, vertices)),
    ...bytesField(3, makeLayer("buildings", a, b, Math.max(4, Math.floor(vertices / 2)))),
    ...bytesField(3, makeLayer("places", a + b, c, 2))
  ]);
}

async function measure(name, samples, fn, { warmup = true } = {}) {
  if (warmup) {
    gc();
    await fn();
  }
  const values = [];
  for (let i = 0; i < samples; i++) {
    gc();
    const t0 = performance.now();
    await fn();
    values.push(performance.now() - t0);
  }
  const result = {
    medianMs: Number(median(values).toFixed(3)),
    p95Ms: Number(p95(values).toFixed(3)),
    minMs: Number(Math.min(...values).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
    samples: values.map((v) => Number(v.toFixed(3)))
  };
  console.log(
    `${name.padEnd(36)} median ${result.medianMs.toFixed(2).padStart(8)}ms · p95 ${result.p95Ms.toFixed(2).padStart(8)}ms · n=${samples}`
  );
  return result;
}

async function runSuite() {
  const scenarios = {};
  const nPoints = profile.points;
  const points = makeLatLngPoints(nPoints);

  {
    const layer = webglPointLayer([], { interactive: false });
    scenarios["points.setData"] = await measure(`points.setData (${fmt(nPoints)})`, SAMPLES, () => {
      layer.setData(points);
    });
    layer.destroy?.();
  }

  {
    const layer = webglPointLayer(points, { interactive: false });
    const patchCount = Math.min(profile.patch, nPoints);
    const indices = new Uint32Array(patchCount);
    const latLngs = new Float64Array(patchCount * 2);
    for (let i = 0; i < patchCount; i++) {
      indices[i] = i;
      latLngs[i * 2] = 55 + (i % 1000) * 0.0001;
      latLngs[i * 2 + 1] = 37 + ((i / 1000) | 0) * 0.0001;
    }
    scenarios["points.patchPoints"] = await measure(
      `points.patchPoints (${fmt(patchCount)})`,
      SAMPLES,
      () => {
        layer.patchPoints(indices, latLngs, patchCount);
      }
    );
    layer.destroy?.();
  }

  {
    const layer = webglPointLayer([], { interactive: false });
    scenarios["points.setDataAsync"] = await measure(
      `points.setDataAsync (${fmt(nPoints)})`,
      SAMPLES,
      async () => {
        await layer.setDataAsync(points, { chunkSize: 50_000 });
      }
    );
    layer.destroy?.();
  }

  {
    const chunk = profile.omIngest >= 1_000_000 ? 25_000 : 10_000;
    scenarios["objectManager.ingest"] = await measure(
      `objectManager.ingest (${fmt(profile.omIngest)})`,
      SAMPLES,
      async () => {
        const manager = objectManager({
          clusterize: false,
          declutter: false,
          sceneFeatures: false,
          visualization: "objects"
        });
        manager.beginBulk();
        let added = 0;
        while (added < profile.omIngest) {
          const n = Math.min(chunk, profile.omIngest - added);
          manager.add(makeOmBatch(added, n));
          added += n;
          if (added % (chunk * 4) === 0 || added === profile.omIngest) {
            await new Promise((r) => setImmediate(r));
          }
        }
        manager.endBulk({ render: false });
        manager.destroy();
      }
    );
  }

  {
    const manager = objectManager({
      clusterize: true,
      clusterRadiusPixels: 55,
      clusterRenderer: "auto",
      declutter: false,
      sceneFeatures: false,
      visualization: "auto"
    });
    const chunk = 10_000;
    manager.beginBulk();
    let added = 0;
    while (added < profile.omCluster) {
      const n = Math.min(chunk, profile.omCluster - added);
      manager.add(makeOmBatch(added, n));
      added += n;
    }
    manager.endBulk({ render: false });
    await manager.prepareLayout(8);
    let layoutFlip = false;
    scenarios["objectManager.clusterLayout"] = await measure(
      `objectManager.clusterLayout (${fmt(profile.omCluster)})`,
      SAMPLES,
      async () => {
        // Alternate zoom so layout work is not a no-op after the first sample.
        layoutFlip = !layoutFlip;
        await manager.prepareLayout(layoutFlip ? 8 : 7);
      }
    );
    manager.destroy();
  }

  {
    const searchN = profile.omSearch;
    const searchManager = objectManager({
      search: { fields: ["properties.name"] },
      sceneFeatures: false
    });
    const chunk = 5_000;
    for (let added = 0; added < searchN; ) {
      const n = Math.min(chunk, searchN - added);
      searchManager.add(makeOmBatch(added, n));
      added += n;
    }
    scenarios["objectManager.search"] = await measure(`objectManager.search (${fmt(searchN)})`, SAMPLES, () => {
      searchManager.search("obj-42", { limit: 20 });
    });
    searchManager.destroy();
  }

  {
    const coords = makePackedCoords(profile.clusterIndex);
    const input = {
      ids: [],
      coords,
      gridSize: 50,
      minPoints: 2,
      clusterize: true,
      clusterMaxZoom: 8,
      clusterMinZoom: 0
    };
    scenarios["cluster.index"] = await measure(
      `cluster.index (${fmt(profile.clusterIndex)})`,
      SAMPLES,
      () => {
        buildClusterIndex(input);
      }
    );
  }

  {
    const tileBytes = makeSyntheticTile(profile.mvtFeatures, profile.mvtVerts);
    const tileCoord = { x: 1204, y: 1539, z: 12 };
    const options = {
      maxBytes: Math.max(2_097_152, tileBytes.byteLength + 1024),
      maxFeatures: Math.max(16_384, profile.mvtFeatures + 1024)
    };
    scenarios["mvt.decode"] = await measure(
      `mvt.decode (${fmt(profile.mvtFeatures)} feat)`,
      SAMPLES,
      () => {
        decodePackedMVT(tileBytes, tileCoord, options);
      }
    );
  }

  {
    const heatInputs = makeLatLngPoints(profile.heatPoints, 0x4ea701);
    const packed = packHeatPoints(heatInputs);
    const bounds = [
      { lat: 35, lng: -15 },
      { lat: 63, lng: 40 }
    ];
    const request = createHeatFieldRequest(packed, bounds, {
      cols: profile.heatCols,
      rows: profile.heatRows,
      radius: 28,
      scaleZoom: 10,
      zoom: 10
    });
    if (!request) throw new Error("heat field request failed");
    scenarios["heat.field"] = await measure(
      `heat.field (${fmt(profile.heatPoints)} → ${profile.heatCols}×${profile.heatRows})`,
      SAMPLES,
      () => {
        buildHeatFieldCpu(request, "wasm");
      }
    );

    const field = buildHeatFieldCpu(request, "wasm");
    scenarios["heat.isolines"] = await measure(
      `heat.isolines (${profile.heatCols}×${profile.heatRows} · L=${profile.isolineLevels})`,
      SAMPLES,
      () => {
        buildHeatIsolinesFromField(field, {
          levels: profile.isolineLevels,
          useWasm: true
        });
      }
    );
  }

  return scenarios;
}

function compare(results, baseline) {
  const failures = [];
  const rows = [];
  const baselineScenarios = baseline.scenarios || {};
  for (const [name, current] of Object.entries(results)) {
    const prior = baselineScenarios[name];
    if (!prior || !(prior.medianMs > 0) || !(prior.score > 0)) {
      failures.push(`${name}: missing baseline median/score`);
      rows.push({ name, status: "MISSING", current: current.medianMs, baseline: null, delta: null });
      continue;
    }
    // Prefer machine-normalized scores so linux CI can share a baseline recorded elsewhere.
    const currentScore = current.score;
    const priorScore = prior.score;
    const slack = Math.max(0.02, priorScore * 0.05);
    const limitScore = priorScore * (1 + THRESHOLD) + slack;
    const ratio = currentScore / priorScore;
    const deltaPct = (ratio - 1) * 100;
    let status = "OK";
    if (currentScore > limitScore) status = "REGRESS";
    else if (ratio < 1 - THRESHOLD) status = "FASTER";
    rows.push({
      name,
      status,
      current: current.medianMs,
      baseline: prior.medianMs,
      currentScore,
      priorScore,
      delta: deltaPct,
      limit: limitScore
    });
    if (status === "REGRESS") {
      failures.push(
        `${name}: score ${currentScore.toFixed(4)} vs baseline ${priorScore.toFixed(4)} (limit ${limitScore.toFixed(4)}; wall ${current.medianMs.toFixed(2)}ms / ${prior.medianMs.toFixed(2)}ms)`
      );
    }
  }
  for (const name of Object.keys(baselineScenarios)) {
    if (!(name in results)) {
      failures.push(`${name}: scenario missing from current run`);
      rows.push({ name, status: "ABSENT", current: null, baseline: baselineScenarios[name].medianMs, delta: null });
    }
  }
  return { failures, rows };
}

console.log(`Orihon CPU perf gate · v${packageJson.version} · profile=${PROFILE_NAME}`);
console.log(
  `Node ${process.version} · ${process.platform}/${process.arch} · samples=${SAMPLES} · threshold=${(THRESHOLD * 100).toFixed(0)}% (score) · gc=${typeof globalThis.gc === "function"}`
);
console.log("");

const calibrate = await calibrateMs();
console.log(`Busy-loop calibrate median: ${calibrate.toFixed(2)}ms (scores = scenarioMs / calibrate)\n`);

const rawScenarios = await runSuite();
const scenarios = withScores(rawScenarios, calibrate);
const fingerprint = createHash("sha256")
  .update(JSON.stringify({ profile: PROFILE_NAME, sizes: profile, scenarioKeys: Object.keys(scenarios).sort(), metric: "score-v1" }))
  .digest("hex")
  .slice(0, 16);

const payload = {
  version: 2,
  library: packageJson.version,
  profile: PROFILE_NAME,
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  threshold: THRESHOLD,
  absoluteSlackMs: ABS_MS,
  samples: SAMPLES,
  calibrateMs: Number(calibrate.toFixed(3)),
  metric: "score",
  sizes: { ...profile },
  fingerprint,
  scenarios
};

await mkdir(RESULTS_DIR, { recursive: true });
await writeFile(resultsPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`\nWrote ${resultsPath}`);

if (UPDATE_BASELINE) {
  await mkdir(BASELINES_DIR, { recursive: true });
  const baselinePayload = {
    version: 2,
    library: packageJson.version,
    profile: PROFILE_NAME,
    generatedAt: payload.generatedAt,
    node: process.version,
    platform: payload.platform,
    threshold: THRESHOLD,
    absoluteSlackMs: ABS_MS,
    samples: SAMPLES,
    calibrateMs: payload.calibrateMs,
    metric: "score",
    sizes: payload.sizes,
    fingerprint,
    scenarios: Object.fromEntries(
      Object.entries(scenarios).map(([name, stats]) => [
        name,
        {
          medianMs: stats.medianMs,
          p95Ms: stats.p95Ms,
          score: stats.score,
          samples: SAMPLES
        }
      ])
    ),
    note:
      "Update with `npm run perf:baseline` after intentional CPU work. CI compares machine-normalized scores (medianMs / busy-loop calibrate) within PERF_THRESHOLD (default 15%)."
  };
  await writeFile(baselinePath, `${JSON.stringify(baselinePayload, null, 2)}\n`, "utf8");
  console.log(`Updated baseline ${baselinePath}`);
  process.exit(0);
}

if (COMPARE_ONLY) {
  let baseline;
  try {
    baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  } catch {
    console.error(`\nNo baseline at ${baselinePath}. Run: npm run perf:baseline`);
    process.exit(2);
  }
  if (baseline.profile && baseline.profile !== PROFILE_NAME) {
    console.error(`Baseline profile ${baseline.profile} != ${PROFILE_NAME}`);
    process.exit(2);
  }
  if (baseline.metric && baseline.metric !== "score") {
    console.error(`Baseline metric ${baseline.metric} is unsupported; regenerate with npm run perf:baseline`);
    process.exit(2);
  }
  if (baseline.fingerprint && baseline.fingerprint !== fingerprint) {
    console.warn(
      `Warning: suite fingerprint changed (${baseline.fingerprint} → ${fingerprint}). Update baseline if scenario sizes/keys changed intentionally.`
    );
  }

  const { failures, rows } = compare(scenarios, baseline);
  console.log("\nComparison vs baseline (normalized scores):");
  for (const row of rows) {
    const delta =
      row.delta == null ? "n/a" : `${row.delta >= 0 ? "+" : ""}${row.delta.toFixed(1)}%`;
    const cur = row.current == null ? "—" : `${row.current.toFixed(2)}ms`;
    const base = row.baseline == null ? "—" : `${row.baseline.toFixed(2)}ms`;
    console.log(`  ${row.status.padEnd(8)} ${row.name.padEnd(32)} ${cur.padStart(10)} / ${base.padStart(10)}  (${delta})`);
  }

  if (failures.length) {
    console.error("\nPerformance regressions:");
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log("\nPerformance gate: PASS");
}
