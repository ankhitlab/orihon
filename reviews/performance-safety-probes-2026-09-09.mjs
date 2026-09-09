// Post-fix regression runner. The adjacent original probe log records the historical defects.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const test = fileURLToPath(new URL('../test/review-regressions.test.js', import.meta.url));
const result = spawnSync(process.execPath, ['--test', test], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
