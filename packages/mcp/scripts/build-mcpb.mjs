import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = path.join(packageDir, "build", "mcpb");
const serverDir = path.join(bundleDir, "server");
const manifest = path.join(bundleDir, "manifest.json");
const bundle = path.join(serverDir, "index.js");
const mcpb = path.join(packageDir, "build", "a-eye.mcpb");

mkdirSync(serverDir, { recursive: true });
copyFileSync(path.join(packageDir, "mcpb", "manifest.json"), manifest);
copyFileSync(path.join(packageDir, "mcpb", "icon.png"), path.join(bundleDir, "icon.png"));
await build({
  entryPoints: [path.join(packageDir, "src", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: bundle,
  external: ["sharp"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

execFileSync("mcpb", ["validate", manifest], { stdio: "inherit" });
execFileSync("mcpb", ["pack", bundleDir, mcpb], { stdio: "inherit" });
