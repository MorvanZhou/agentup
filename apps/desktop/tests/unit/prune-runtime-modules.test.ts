import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";

const { pruneRuntimeModules } = createRequire(import.meta.url)(
  "../../electron/prune-runtime-modules.cjs",
) as {
  pruneRuntimeModules: (root: string) => { removedFiles: number; removedDirs: number };
};

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

it("drops package-root docs/maps/@types; keeps nested business doc/ and changelog.js", () => {
  root = mkdtempSync(join(tmpdir(), "agentup-prune-"));
  const pkg = join(root, "foo");
  mkdirSync(join(pkg, "docs"), { recursive: true });
  mkdirSync(join(pkg, "dist", "doc"), { recursive: true });
  mkdirSync(join(pkg, "@types", "node"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), "{\"name\":\"foo\"}");
  writeFileSync(join(pkg, "index.js"), "module.exports = 1");
  writeFileSync(join(pkg, "index.js.map"), "{}");
  writeFileSync(join(pkg, "README.md"), "hi");
  writeFileSync(join(pkg, "CHANGELOG.md"), "notes");
  writeFileSync(join(pkg, "changelog.js"), "export const note = 1");
  writeFileSync(join(pkg, "docs", "guide.md"), "x");
  writeFileSync(join(pkg, "dist", "doc", "directives.js"), "export {}");
  writeFileSync(join(pkg, "@types", "node", "index.d.ts"), "export {}");
  writeFileSync(join(pkg, "src.ts"), "export {}");
  writeFileSync(join(pkg, "src.js"), "export {}");

  const result = pruneRuntimeModules(root);
  expect(result.removedFiles).toBeGreaterThan(0);
  expect(result.removedDirs).toBeGreaterThan(0);
  expect(existsSync(join(pkg, "index.js"))).toBe(true);
  expect(existsSync(join(pkg, "changelog.js"))).toBe(true);
  expect(existsSync(join(pkg, "src.ts"))).toBe(true);
  expect(existsSync(join(pkg, "src.js"))).toBe(true);
  expect(existsSync(join(pkg, "dist", "doc", "directives.js"))).toBe(true);
  expect(existsSync(join(pkg, "index.js.map"))).toBe(false);
  expect(existsSync(join(pkg, "README.md"))).toBe(false);
  expect(existsSync(join(pkg, "CHANGELOG.md"))).toBe(false);
  expect(existsSync(join(pkg, "docs"))).toBe(false);
  expect(existsSync(join(pkg, "@types"))).toBe(false);
});
