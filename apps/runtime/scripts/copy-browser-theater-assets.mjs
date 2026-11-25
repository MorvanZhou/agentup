import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fromDir = path.join(root, "src/session/mcp/browser-theater");
const toDir = path.join(root, "dist/session/mcp/browser-theater");
fs.mkdirSync(toDir, { recursive: true });

const names = [
  "theater-init.js",
  "mcp-bridge.mjs",
  "ndjson.mjs",
  "upstream-hub.mjs",
  "singleton.mjs",
];
for (const name of names) {
  fs.copyFileSync(path.join(fromDir, name), path.join(toDir, name));
}
console.log("copied browser-theater assets → dist");
