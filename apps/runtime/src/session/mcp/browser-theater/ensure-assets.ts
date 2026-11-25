import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** bridge 入口 + 相对 import 依赖；须与入口同目录落到 userData。 */
export const BROWSER_THEATER_BRIDGE_MODULES = [
  "mcp-bridge.mjs",
  "ndjson.mjs",
  "upstream-hub.mjs",
  "singleton.mjs",
] as const;

export type BrowserTheaterAssets = {
  dir: string;
  initScript: string;
  bridge: string;
};

/** 把剧场脚本落到 userData，供 playwright-mcp 与 bridge 用绝对路径加载。 */
export function ensureBrowserTheaterAssets(userDataRoot: string): BrowserTheaterAssets {
  const dir = path.join(userDataRoot, "runtime", "browser-theater");
  fs.mkdirSync(dir, { recursive: true });
  const initScript = path.join(dir, "theater-init.js");
  const bridge = path.join(dir, "mcp-bridge.mjs");
  copyIfNeeded(path.join(HERE, "theater-init.js"), initScript);
  for (const name of BROWSER_THEATER_BRIDGE_MODULES) {
    copyIfNeeded(path.join(HERE, name), path.join(dir, name));
  }
  return { dir, initScript, bridge };
}

function copyIfNeeded(from: string, to: string): void {
  if (!fs.existsSync(from)) {
    throw new Error(`browser theater asset missing: ${from}`);
  }
  const source = fs.readFileSync(from);
  if (fs.existsSync(to) && fs.readFileSync(to).equals(source)) return;
  fs.writeFileSync(to, source);
}
