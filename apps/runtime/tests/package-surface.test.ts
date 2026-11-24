import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { packageDigest } from "../src/package/digest.js";
import { readPackageSurface } from "../src/package/surface.js";
import { validateAgentPackage } from "../src/package/validate.js";

const MANIFEST = { version: 1, tools: [] as string[], modelCapabilities: [] as string[] };

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-package-surface-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

it("readPackageSurface 跳过顶层宿主杂文件，校验与 digest 不受影响", () => {
  const pi = path.join(root, ".pi");
  fs.mkdirSync(pi, { recursive: true });
  fs.writeFileSync(path.join(pi, "SYSTEM.md"), "You are a test agent.\n");
  fs.writeFileSync(path.join(pi, "AGENTS.md"), "Be careful.\n");
  fs.writeFileSync(
    path.join(pi, "skills-project.json"),
    JSON.stringify({ version: 1, templateId: "codebuddy-sdk", rel: ".codebuddy/skills", names: [] }),
  );
  fs.writeFileSync(path.join(pi, "future-cache.bin"), "junk");

  const clean = readPackageSurface(pi);
  expect(Object.keys(clean).sort()).toEqual(["AGENTS.md", "SYSTEM.md"]);
  expect(validateAgentPackage(clean)).toEqual([]);

  const withJunk: Record<string, Uint8Array> = {
    ...clean,
    "skills-project.json": fs.readFileSync(path.join(pi, "skills-project.json")),
  };
  expect(validateAgentPackage(withJunk).some((issue) => issue.path === "skills-project.json")).toBe(
    true,
  );

  const digestClean = packageDigest(MANIFEST, clean);
  const again = readPackageSurface(pi);
  expect(packageDigest(MANIFEST, again)).toBe(digestClean);
});
