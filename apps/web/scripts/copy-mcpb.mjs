import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const source = path.resolve(import.meta.dirname, "../../../packages/mcp/build/a-eye.mcpb");
const destination = path.resolve(import.meta.dirname, "../public/downloads/a-eye.mcpb");

if (existsSync(source)) {
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  console.log("copied a-eye.mcpb to public/downloads");
}
