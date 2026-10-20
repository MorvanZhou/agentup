import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { formatRulesAppend, loadVisitAlwaysApplyRules } from "../src/session/rules.js";

function writeRule(dir: string, name: string, alwaysApply: boolean, body: string, description = ""): void {
  fs.mkdirSync(dir, { recursive: true });
  const desc = description ? `description: ${description}\n` : "";
  fs.writeFileSync(
    path.join(dir, `${name}.mdc`),
    `---\n${desc}alwaysApply: ${alwaysApply}\n---\n\n${body}\n`,
  );
}

it("loads package alwaysApply rules from .pi/rules only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-rules-"));
  const cwd = path.join(root, "cwd");
  writeRule(path.join(cwd, ".pi", "rules"), "safety", true, "Package safety.", "pkg");
  writeRule(path.join(cwd, ".pi", "rules"), "optional", false, "Not always.");

  const rules = loadVisitAlwaysApplyRules(cwd);
  expect(rules.map((rule) => ({ id: rule.id, source: rule.source, body: rule.body.trim() }))).toEqual([
    { id: "safety", source: "package", body: "Package safety." },
  ]);
  expect(formatRulesAppend(rules)).toContain("Package safety.");
  expect(formatRulesAppend(rules)).not.toContain("Not always.");
});
