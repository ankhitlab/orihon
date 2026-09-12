/*
 * Static server for the demo site.
 *
 *   node examples/live/server.mjs [--port 4180]
 *
 * Serves the repository root so that `/dist` is reachable next to the site and
 * the demos run against the local build. Uploading `examples/live/` on its own
 * to any static host also works — the pages fall back to the published package
 * on jsDelivr when `dist/` is not there.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const port = Number(argv[argv.indexOf("--port") + 1]) || Number(process.env.PORT) || 4180;

/* `--standalone` serves only this folder, the way a static host would after an
   upload. `dist/` is then out of reach and the pages fall back to jsDelivr —
   which is exactly the thing worth checking before publishing. */
const standalone = argv.includes("--standalone");
const root = fileURLToPath(new URL(standalone ? "./" : "../../", import.meta.url));
const home = standalone ? "/index.html" : "/examples/live/index.html";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2"
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = home;

  const target = normalize(join(root, pathname));
  if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let file = target;
  try {
    const info = await stat(file);
    if (info.isDirectory()) file = join(file, "index.html");
    await stat(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-cache"
  });
  createReadStream(file).pipe(response);
});

server.listen(port, () => {
  console.log(`Orihon demo site  →  http://localhost:${port}${home}`);
  console.log(`serving ${root}`);
});
