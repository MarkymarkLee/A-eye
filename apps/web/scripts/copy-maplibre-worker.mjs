// MapLibre resolves its worker relative to import.meta.url, which points into
// /_next/static/chunks once bundled, where the file doesn't exist. Serve the
// worker from /public instead, copied from the installed version so it always matches.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/package.json"));
const out = path.join(import.meta.dirname, "..", "public", "maplibre");
mkdirSync(out, { recursive: true });
copyFileSync(path.join(dist, "dist", "maplibre-gl-worker.mjs"), path.join(out, "maplibre-gl-worker.mjs"));
console.log("copied maplibre-gl-worker.mjs to public/maplibre");
