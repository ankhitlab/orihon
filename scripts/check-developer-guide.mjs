import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The generated pages are not tracked, so the check is that the generator still runs
// against the current exports and produces a page for every function it catalogues.
run(process.execPath, ["scripts/build-developer-guide.mjs"]);

const manifest = JSON.parse(await readFile(new URL("examples/developer-guide/manifest.json", root), "utf8"));
const functions = manifest.functions ?? [];
if (functions.length === 0) {
  console.error("Developer guide: manifest lists no functions");
  process.exit(1);
}
for (const item of functions) {
  await access(new URL(`examples/developer-guide/functions/${item.name}/index.html`, root));
}
console.log(`Developer guide: ${functions.length} pages present`);
