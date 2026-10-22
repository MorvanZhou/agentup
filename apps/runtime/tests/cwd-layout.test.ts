import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import {
  ARTIFACT_DIR,
  ATTACHMENTS_DIR,
  WORK_DIR,
  ensureCwdLayout,
  formatCwdLayoutPrompt,
} from "../src/session/workspace/cwd-layout.js";

it("creates ATTACHMENTS, WORK, and ARTIFACT under cwd", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-cwd-layout-"));
  ensureCwdLayout(cwd);
  expect(fs.statSync(path.join(cwd, ATTACHMENTS_DIR)).isDirectory()).toBe(true);
  expect(fs.statSync(path.join(cwd, WORK_DIR)).isDirectory()).toBe(true);
  expect(fs.statSync(path.join(cwd, ARTIFACT_DIR)).isDirectory()).toBe(true);
  ensureCwdLayout(cwd);
  expect(formatCwdLayoutPrompt()).toContain(ATTACHMENTS_DIR);
  expect(formatCwdLayoutPrompt()).toContain(WORK_DIR);
  expect(formatCwdLayoutPrompt()).toContain(ARTIFACT_DIR);
});
