/**
 * Keep published version claims aligned — same idea as check-size.mjs for gzip.
 * package.version must match CHANGELOG, create-orihon-app, CDN pins, and docs banners.
 */
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];

function fail(message) {
  failures.push(message);
}

async function readText(rel) {
  return readFile(join(root, rel), "utf8");
}

async function* walk(dir, filter) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      yield* walk(full, filter);
    } else if (filter(entry.name)) {
      yield full;
    }
  }
}

const pkg = JSON.parse(await readText("package.json"));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json version is not semver: ${version}`);
}

const createPkg = JSON.parse(await readText("packages/create-orihon-app/package.json"));
if (createPkg.version !== version) {
  fail(`create-orihon-app version ${createPkg.version} != package.json ${version}`);
}

const changelog = await readText("CHANGELOG.md");
const latest = changelog.match(/^##\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/m);
if (!latest) fail("CHANGELOG.md has no leading ## x.y.z release heading");
else if (latest[1] !== version) {
  fail(`CHANGELOG latest ${latest[1]} != package.json ${version}`);
}

const roadmap = await readText("docs/ROADMAP.md");
if (/^#\s+Orihon\s+1\.x\b/m.test(roadmap)) {
  fail('docs/ROADMAP.md still titles itself "Orihon 1.x …" — update the banner to the current major');
}
const major = version.split(".")[0];
if (!new RegExp(`\\b${major}\\.x\\b|current major|Orihon enhancement`, "i").test(roadmap.slice(0, 800))) {
  fail(`docs/ROADMAP.md intro should mention the current major (${major}.x) or "enhancement roadmap"`);
}

const pinRe = /orihon@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g;
const scanRoots = ["examples", "docs", "packages/create-orihon-app", "README.md"];
const textExt = /\.(?:html?|md|js|mjs|cjs|ts|tsx|jsx|json)$/i;

async function scanFile(abs) {
  const rel = relative(root, abs).replaceAll("\\", "/");
  // Generated guide is rebuilt by docs:check; still verify if present.
  if (rel.includes("node_modules") || rel.includes("/dist/")) return;
  const text = await readFile(abs, "utf8");
  for (const match of text.matchAll(pinRe)) {
    if (match[1] !== version) {
      fail(`${rel}: pinned orihon@${match[1]} (expected orihon@${version})`);
    }
  }
}

for (const target of scanRoots) {
  const abs = join(root, target);
  try {
    const stat = await readFile(abs).then(() => "file").catch(async () => {
      await readdir(abs);
      return "dir";
    });
    if (stat === "file") await scanFile(abs);
    else {
      for await (const file of walk(abs, (name) => textExt.test(name))) {
        await scanFile(file);
      }
    }
  } catch (error) {
    fail(`cannot scan ${target}: ${error instanceof Error ? error.message : error}`);
  }
}

// Placeholder templates must not hard-pin a release; create-orihon-app substitutes at scaffold time.
const cdnTemplate = await readText("packages/create-orihon-app/templates/cdn/index.html");
if (!cdnTemplate.includes("__ORIHON_CDN_VERSION__")) {
  fail("create-orihon-app CDN template must use __ORIHON_CDN_VERSION__ placeholder");
}
if (pinRe.test(cdnTemplate)) {
  fail("create-orihon-app CDN template must not hard-pin orihon@x.y.z");
}

// Live site fallback and footer examples.
for (const rel of [
  "examples/live/home.js",
  "examples/index.html",
  "examples/site/index.html"
]) {
  const text = await readText(rel);
  if (!text.includes(version)) {
    fail(`${rel}: expected to mention package version ${version}`);
  }
}

const boot = await readText("examples/live/assets/boot.js");
const bootVersion = boot.match(/\bVERSION\s*=\s*"(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)"/);
if (!bootVersion || bootVersion[1] !== version) {
  fail(`examples/live/assets/boot.js VERSION ${bootVersion?.[1] ?? "(missing)"} != ${version}`);
}

const home = await readText("examples/live/home.js");
const homeVersion = home.match(/version:\s*"(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)"/);
if (!homeVersion || homeVersion[1] !== version) {
  fail(`examples/live/home.js fallback version ${homeVersion?.[1] ?? "(missing)"} != ${version}`);
}

try {
  const manifest = JSON.parse(await readText("examples/developer-guide/manifest.json"));
  if (manifest.version && manifest.version !== version) {
    fail(`developer-guide manifest.version ${manifest.version} != ${version} (run docs:build)`);
  }
} catch {
  // Absent until docs:build; docs:check rebuilds it first when both run together.
}

if (failures.length) {
  console.error("Doc version check failed:\n" + failures.map((line) => `  - ${line}`).join("\n"));
  process.exit(1);
}

console.log(`Doc versions OK (orihon@${version})`);
