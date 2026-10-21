import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { projectVisitAgentsMd } from "../src/session/agents-md.js";

it("projects .pi/AGENTS.md into visit .runtime/AGENTS.md", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-agents-md-"));
  const pi = path.join(root, "cwd", ".pi");
  fs.mkdirSync(pi, { recursive: true });
  fs.writeFileSync(path.join(pi, "AGENTS.md"), "# Rules\n\n- be brief\n");

  projectVisitAgentsMd(root);

  expect(fs.readFileSync(path.join(root, ".runtime", "AGENTS.md"), "utf8")).toContain("be brief");
});

it("migrates legacy .pi/rules into .runtime/AGENTS.md without touching .pi", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-agents-md-"));
  const rulesDir = path.join(root, "cwd", ".pi", "rules");
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(rulesDir, "safety.mdc"),
    "---\nalwaysApply: true\ndescription: pkg\n---\n\nPackage safety.\n",
  );

  projectVisitAgentsMd(root);

  const migrated = fs.readFileSync(path.join(root, ".runtime", "AGENTS.md"), "utf8");
  expect(migrated).toContain("Package safety.");
  expect(fs.existsSync(path.join(rulesDir, "safety.mdc"))).toBe(true);
});
