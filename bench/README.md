# Performance contract

Orihon treats speed as a library contract, not a demo. CI enforces a **CPU performance gate** against committed baselines under `bench/baselines/`.

## Commands

```sh
npm run perf            # build, run suite, compare to baseline
npm run perf:ci         # compare only (expects dist/ already built)
npm run perf:baseline   # rebuild baseline after intentional CPU wins/losses
```

Environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PERF_PROFILE` | `ci` | `ci` (CI sizes) or `full` (≈1M points / heavier kernels) |
| `PERF_THRESHOLD` | `0.15` | Fail when the machine-normalized **score** exceeds baseline × (1 + threshold) plus small slack |
| `PERF_SAMPLES` | profile default | Override sample count (median of N runs) |

Scores are `scenarioMedianMs / busyLoopCalibrateMs`, so the same commit can be compared across different CPUs more fairly than raw wall times. Wall-clock `medianMs` is still stored for humans.

The `ci` profile uses ~200k points and related sizes so GitHub runners finish in a few minutes. Use `PERF_PROFILE=full` locally (or on a scheduled job) for the million-point class of workloads.

## Suite (CPU / Node)

| Scenario | What it contracts |
| --- | --- |
| `points.setData` | WebGL point ingest (CPU pack path) |
| `points.patchPoints` | Incremental position updates |
| `points.setDataAsync` | Async chunked ingest |
| `objectManager.ingest` | ObjectManager bulk add |
| `objectManager.clusterLayout` | Cluster hierarchy via `prepareLayout` |
| `objectManager.search` | Search index query |
| `cluster.index` | Cluster index build |
| `mvt.decode` | Packed MVT decode |
| `heat.field` | Heat field kernel (WASM preferred) |
| `heat.isolines` | Contour extraction from a field |

Threshold is **≈15% on machine-normalized scores** (`medianMs / busy-loop calibrate`), not a 2–3% micro-gate. The gate uses the **median** of several samples after a warmup run. Raw milliseconds are recorded for humans; CI fails on score regressions.

## GPU / browser (not gated here)

These need a dedicated machine or browser harness; they stay outside the PR CPU gate:

- 1M points pan / paint FPS
- MVT render
- tile pan
- heat WebGPU field

Run `npm run demo:bench` / `examples/bench-compare` and the focused `scripts/bench-*.mjs` tools for those. Prefer recording results as artifacts on a self-hosted or GPU runner before promoting them into a hard CI fail.

## Updating the baseline

1. Confirm the change is an intentional performance change (or a size/fingerprint change).
2. `npm run perf:baseline` (or `PERF_PROFILE=full npm run perf:baseline`).
3. Commit the updated `bench/baselines/cpu-*.json` with the PR that changes hot paths.
4. Do not raise `PERF_THRESHOLD` to hide a regression.

## Historical JSON

Each run writes `bench/results/cpu-<profile>-latest.json` (gitignored). Baselines keep `medianMs` per scenario so regressions are visible as a contract diff, not only as a log line.
