# Contributing to Orihon

Thanks for helping. This document is the short path from “I found something” to a merged change.

## Before you start

1. Read the [security model](./docs/SECURITY.md) and [support / compatibility policy](./docs/SUPPORT.md).
2. Search [issues](https://github.com/ankhitlab/orihon/issues) and [Discussions](https://github.com/ankhitlab/orihon/discussions) so we do not duplicate work.
3. For API-shaped ideas, open an **RFC** issue first (template provided) rather than a surprise PR.

Security-sensitive reports go through [GitHub Security Advisories](https://github.com/ankhitlab/orihon/security/advisories/new) — not a public issue. See [SECURITY.md](./SECURITY.md).

## Good first issues

Issues labeled `good first issue` are scoped for a first contribution: one file area, a failing test or a clear acceptance note, and no speculative API redesign. Ask on the issue if the scope is unclear before writing a large patch.

## Development setup

```sh
npm ci
npm test
npm run typecheck
npm run docs:check
npm run size
npm run perf
```

For a PR that changes hot CPU paths, update `bench/baselines/` with `npm run perf:baseline` when the change is intentional. Do not widen the threshold to hide a regression.

`npm test` rebuilds `dist/` first. Browser / Playwright jobs match CI (`npm run test:browser`, `npm run test:e2e`).

### Doc and version discipline

CDN pins, CHANGELOG, `create-orihon-app`, and docs banners must match `package.json` version:

```sh
npm run docs:versions
```

CI runs this via `docs:check`. If you bump the package version, update CHANGELOG, example CDN URLs, and `packages/create-orihon-app/package.json` in the same PR.

## Pull requests

- Keep the diff focused; prefer the repository’s existing style and public APIs.
- Add or extend a unit test when behaviour changes.
- Do not commit secrets, large binary fixtures, or generated guide pages unless the workflow already tracks them.
- Fill in the PR template: summary, test plan, and any docs/version touchpoints.

## Issue types

| Template | Use when |
| --- | --- |
| Bug report | Incorrect behaviour with a minimal reproduction |
| Performance regression | FPS, memory, ingest time, or bundle size regresses |
| RFC | New public API, breaking change, or packaging change |

Questions and “how do I…?” belong in Discussions when that board is enabled; otherwise use a Discussion-style issue rather than a bug template.

## Code of collaboration

Be precise, kind, and specific. Disagreement about API taste is fine; personal attacks are not. Maintainers may close drive-by redesign PRs that skip the RFC path.
