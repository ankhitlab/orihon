# Security policy

## Supported versions

Security fixes land on the **latest published 2.x** release line. Older majors receive fixes only when a release is still listed as supported in [docs/SUPPORT.md](./docs/SUPPORT.md).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for exploitable bugs (XSS via library APIs, prototype pollution, cache poisoning, credential leakage, and similar).

1. Use [GitHub Private Vulnerability Reporting](https://github.com/ankhitlab/orihon/security/advisories/new) for this repository.
2. Include Orihon version, browser/Node version, a minimal reproduction, and impact.
3. Allow a reasonable window for a fix and coordinated disclosure before public write-ups.

The product security *model* (what the API guarantees by default) is documented in [docs/SECURITY.md](./docs/SECURITY.md).
