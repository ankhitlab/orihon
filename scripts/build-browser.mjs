import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { minify } from "terser";
import ts from "typescript";
import { compactShadersPlugin } from "./compact-shaders.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const manifestPath = resolve(dist, "release-manifest.json");

await mkdir(dist, { recursive: true });

// `tsc` does not prune outputs for deleted sources. Never publish retired heat
// renderers or the former long-named pipeline beside the unified heat API.
const obsoleteHeatModules = [
  "layers/heat-layer",
  "layers/webgl-heat-layer",
  "layers/heat-isoline-layer",
  "services/heat-scale",
  "layers/heat-pipeline-layer",
  "services/heat-pipeline",
  "services/heat-pipeline-worker"
];
const obsoleteGpuTileModules = ["layers/webgl-tile-layer", "layers/webgpu-tile-layer"];
const obsoletePublicModules = ["layers/canvas-base-layer"];
for (const modulePath of [...obsoleteHeatModules, ...obsoleteGpuTileModules, ...obsoletePublicModules]) {
  for (const suffix of [".js", ".js.map", ".d.ts", ".d.ts.map"]) {
    await unlink(resolve(dist, `${modulePath}${suffix}`)).catch(() => {});
  }
}

await copyFile(resolve(root, "src", "orihon.css"), resolve(dist, "orihon.css"));
await copyFile(resolve(root, "src", "draw", "orihon.draw.css"), resolve(dist, "draw.css"));

// Drop stale Advanced code-split chunks from prior builds.
for (const name of await readdir(dist)) {
  if (/^orihon-.+\.js(\.map)?$/.test(name) && name !== "orihon.esm.js" && !name.startsWith("orihon.core")
    && !name.startsWith("orihon.standard") && !name.startsWith("orihon.global")
    && !name.startsWith("orihon.controls") && !name.startsWith("orihon.geo")
    && !name.startsWith("orihon.popup") && !name.startsWith("orihon.draw")
    && !name.startsWith("orihon.react")) {
    const { unlink } = await import("node:fs/promises");
    await unlink(join(dist, name)).catch(() => {});
  }
}

const banner = `/*! Orihon ${pkg.version} | Apache-2.0 | Copyright 2026 whahe */`;

/** Safe property mangling: only rename identifiers matching /^_/ (keeps `_unsub`). */
const terserPropertyMangle = {
  regex: /^_/,
  // These are public names exported by embedded WASM modules, not JS-private fields.
  // Renaming `__heap_base` makes the one-file browser bundle silently fall back to JS.
  reserved: ["_unsub", "__heap_base", "__data_end"]
};

async function terserMinifyFile(filePath, { module, mangleProperties = true }) {
  const sourceMapPath = `${filePath}.map`;
  let mapContent;
  try {
    mapContent = await readFile(sourceMapPath, "utf8");
  } catch {
    mapContent = undefined;
  }
  const file = filePath.split(/[/\\]/).pop();
  const compact = await minify(await readFile(filePath, "utf8"), {
    module,
    // Public getters and external modules rely on actual booleans (=== true),
    // so do not rewrite them to 0/1 in any published artifact.
    compress: { passes: 8, keep_fargs: false },
    mangle: {
      properties: mangleProperties ? terserPropertyMangle : false
    },
    format: { comments: /^!/ },
    sourceMap: mapContent
      ? {
          content: mapContent,
          filename: file,
          url: `${file}.map`
        }
      : undefined
  });
  if (!compact.code) throw new Error(`Terser produced no code for ${filePath}`);
  await writeFile(filePath, compact.code);
  if (compact.map) await writeFile(sourceMapPath, compact.map);
}

const artifacts = [
  { entry: "core.ts", file: "orihon.core.esm.js" },
  { entry: "standard.ts", file: "orihon.standard.esm.js" },
  { entry: "advanced-entry.ts", file: "orihon.esm.js" },
  { entry: "object-manager-entry.ts", file: "orihon.object-manager.esm.js" },
  { entry: "locales-entry.ts", file: "orihon.locales.esm.js" },
  { entry: "controls.ts", file: "orihon.controls.esm.js" },
  { entry: "geo-entry.ts", file: "orihon.geo.esm.js" },
  { entry: "popup-content.ts", file: "orihon.popup-content.esm.js" },
  { entry: "draw/index.ts", file: "orihon.draw.esm.js" },
  { entry: "react/index.ts", file: "orihon.react.esm.js" },
  { entry: "react/object-manager.ts", file: "orihon.react-object-manager.esm.js" },
  { entry: "advanced-entry.ts", file: "orihon.global.js", format: "iife" }
];

const esmArtifacts = artifacts.filter(a => a.format !== "iife");
// One graph: classes, registries, React context and expensive renderers have a
// single identity across browser entries. Keep public/plugin property names.
const result = await build({
  entryPoints: Object.fromEntries(esmArtifacts.map(a => [a.file.replace(/\.js$/, ""), resolve(root, "src", a.entry)])),
  outdir: dist, entryNames: "[name]", chunkNames: "orihon-[name]-[hash]",
  bundle: true, splitting: true, format: "esm", minify: true,
  sourcemap: true, metafile: true, target: ["es2022"], legalComments: "none",
  external: ["react", "react-dom/client"],
  plugins: [compactShadersPlugin], banner: { js: banner }
});
const esmFiles = Object.keys(result.metafile.outputs).filter(file => file.endsWith(".js"))
  .map(file => file.split(/[/\\\\]/).pop());
const entryFiles = new Set(esmArtifacts.map(a => a.file));
const chunkFiles = esmFiles.filter(file => !entryFiles.has(file));
for (const file of esmFiles) {
  await terserMinifyFile(resolve(dist, file), { module: true, mangleProperties: false });
}

// The script-tag distribution remains self-contained.
await build({
  entryPoints: [resolve(root, "src/advanced-entry.ts")],
  outfile: resolve(dist, "orihon.global.js"),
  bundle: true, format: "iife", globalName: "Orihon", minify: true,
  sourcemap: true, target: ["es2022"], legalComments: "none",
  plugins: [compactShadersPlugin], banner: { js: banner },
  footer: { js: "globalThis.OrihonReady=Promise.resolve(Orihon);" }
});
await terserMinifyFile(resolve(dist, "orihon.global.js"), { module: false });

const sizeTargets = [
  ...artifacts.map((a) => a.file),
  ...chunkFiles
];

const sizes = Object.fromEntries(await Promise.all(sizeTargets.map(async (file) => {
  const contents = await readFile(resolve(dist, file));
  return [file, { bytes: contents.length, gzipBytes: gzipSync(contents, { level: 9 }).length }];
})));

const staticImports = {};
for (const file of sizeTargets) {
  const source = await readFile(resolve(dist, file), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  staticImports[file] = tree.statements
    .filter(node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    .map(node => node.moduleSpecifier?.text)
    .filter(name => typeof name === "string" && name.startsWith("./"))
    .map(name => name.slice(2)).filter(name => name in sizes);
}

function staticClosure(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const current = queue.pop();
    for (const dependency of staticImports[current] ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      queue.push(dependency);
    }
  }
  return [...seen];
}

const initialLoads = Object.fromEntries(artifacts.map(({ file }) => {
  const files = staticClosure(file);
  return [file, {
    files,
    bytes: files.reduce((total, dependency) => total + sizes[dependency].bytes, 0),
    gzipBytes: files.reduce((total, dependency) => total + sizes[dependency].gzipBytes, 0)
  }];
}));

// Contribution metadata allows tests to catch duplicated implementations and
// accidental promotion of optional renderers into an entry's initial closure.
const moduleOutputs = {};
for (const [output, info] of Object.entries(result.metafile.outputs)) {
  if (!output.endsWith('.js')) continue;
  const file = output.split(/[/\\]/).pop();
  for (const [input, contribution] of Object.entries(info.inputs)) {
    if (contribution.bytesInOutput > 0) (moduleOutputs[input.replaceAll('\\', '/')] ??= []).push(file);
  }
}

await writeFile(manifestPath, JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  module: "standard.js",
  core: "core.js",
  standard: "standard.js",
  advanced: "advanced-entry.js",
  objectManager: "object-manager-entry.js",
  locales: "locales-entry.js",
  controls: "controls.js",
  geo: "geo-entry.js",
  popupContent: "popup-content.js",
  bundledModule: "orihon.esm.js",
  chunks: chunkFiles,
  global: "orihon.global.js",
  css: "orihon.css",
  sizes,
  staticImports,
  initialLoads,
  moduleOutputs
}, null, 2));
