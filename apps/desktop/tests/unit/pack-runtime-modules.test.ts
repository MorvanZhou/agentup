import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { packRuntimeModules, ARCHIVE_NAME } = require("../../electron/pack-runtime-modules.cjs") as {
  packRuntimeModules: (
    root: string,
    options?: { tarRequireFrom?: string },
  ) => Promise<{ archivePath: string; archiveBytes: number }>;
  ARCHIVE_NAME: string;
};
const { ensureRuntimeModules } = require("../../electron/ensure-runtime-modules.cjs") as {
  ensureRuntimeModules: (opts: {
    runtimeRoot: string;
    userDataRoot: string;
    appVersion: string;
  }) => string;
};

let root = "";

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function seedModules(runtimeRoot: string) {
  const real = join(runtimeRoot, "node_modules", ".pnpm", "pkg@1", "node_modules", "pkg");
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, "package.json"), '{"name":"pkg","main":"index.js"}');
  writeFileSync(join(real, "index.js"), "module.exports = { ok: 1 }");
  symlinkSync(join(".pnpm", "pkg@1", "node_modules", "pkg"), join(runtimeRoot, "node_modules", "pkg"), "dir");
  writeFileSync(join(runtimeRoot, "package.json"), '{"name":"@agentup/runtime"}');
  mkdirSync(join(runtimeRoot, "dist", "local"), { recursive: true });
  writeFileSync(join(runtimeRoot, "dist", "local", "cli.js"), "console.log(1)");
}

it("packs node_modules into a single tgz and drops the loose tree", async () => {
  root = mkdtempSync(join(tmpdir(), "agentup-pack-nm-"));
  seedModules(root);

  const { archivePath, archiveBytes } = await packRuntimeModules(root);
  expect(archivePath).toBe(join(root, ARCHIVE_NAME));
  expect(archiveBytes).toBeGreaterThan(0);
  expect(existsSync(join(root, "node_modules"))).toBe(false);
  expect(existsSync(archivePath)).toBe(true);

  // 必须保留相对 symlink（follow:true 会让 dmg 从 ~160MB 胀到 220MB+）
  const list = spawnSync("tar", ["-tvzf", archivePath], { encoding: "utf8" });
  expect(list.status).toBe(0);
  expect(list.stdout).toMatch(/node_modules\/pkg/);
  expect(list.stdout).toMatch(/^l.*node_modules\/pkg/m);
});

it("ensureRuntimeModules expands tgz back next to package.json", async () => {
  root = mkdtempSync(join(tmpdir(), "agentup-ensure-nm-"));
  const runtimeRoot = join(root, "runtime");
  const userData = join(root, "ud");
  mkdirSync(runtimeRoot, { recursive: true });
  seedModules(runtimeRoot);
  await packRuntimeModules(runtimeRoot);

  const resolved = ensureRuntimeModules({
    runtimeRoot,
    userDataRoot: userData,
    appVersion: "0.0.0-test",
  });
  expect(resolved).toBe(runtimeRoot);
  const pkgLink = join(runtimeRoot, "node_modules", "pkg");
  expect(lstatSync(pkgLink).isSymbolicLink()).toBe(true);
  expect(readlinkSync(pkgLink)).toContain(".pnpm");
  expect(existsSync(join(pkgLink, "index.js"))).toBe(true);
  expect(readFileSync(join(pkgLink, "index.js"), "utf8")).toContain("ok");
  // 成功后尽量删掉归档
  expect(existsSync(join(runtimeRoot, ARCHIVE_NAME))).toBe(false);
});
