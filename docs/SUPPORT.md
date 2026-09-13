# Support and compatibility

This is what you can expect a year from now when something breaks.

## Support channels

| Channel | For |
| --- | --- |
| [GitHub Issues](https://github.com/ankhitlab/orihon/issues) | Bugs, regressions, concrete API defects (use the templates) |
| [GitHub Discussions](https://github.com/ankhitlab/orihon/discussions) | Usage questions, showcases, design brainstorming |
| [Security advisories](https://github.com/ankhitlab/orihon/security/advisories/new) | Vulnerabilities only — see [SECURITY.md](../SECURITY.md) |
| [CHANGELOG](../CHANGELOG.md) | What shipped and what broke between versions |

There is no paid SLA attached to the Apache-2.0 package. Maintainers triage as bandwidth allows; reproducible reports with versions and a minimal demo get priority.

## Compatibility policy

- **SemVer.** Breaking public API changes require a new major (`CHANGELOG` + [MIGRATION-NEXT-MAJOR](./MIGRATION-NEXT-MAJOR.md) when relevant).
- **Current major.** Active development targets the latest `2.x` line (`package.json` / npm `orihon`).
- **Browsers.** Evergreen Chromium, Firefox, and Safari/WebKit as exercised in CI Playwright jobs. Older browsers are best-effort.
- **React.** `orihon/react` peers React 18+; declarative prop sync is documented in [API.md](./API.md#react).
- **Node.** Tooling and `create-orihon-app` follow the `engines` field in `package.json` / the create package.

## What “supported” means

| Kind | Commitment |
| --- | --- |
| Security fix on latest 2.x | Yes, via advisories + patch release when confirmed |
| Bugfix on latest 2.x | Yes, when reproducible |
| Backports to older minors | Case-by-case; not guaranteed |
| Custom feature work / consulting | Out of scope for the OSS tracker |

## Reproducing for maintainers

The fastest path to a fix:

1. Orihon version (`orihon@x.y.z` from npm or CDN).
2. Browser or Node version.
3. Entry import (`orihon`, `orihon/easy`, `orihon/react`, …).
4. Minimal HTML/JS or a failing `test/*.test.js` case.

Performance claims should include before/after numbers and the scenario (see the performance issue template).
