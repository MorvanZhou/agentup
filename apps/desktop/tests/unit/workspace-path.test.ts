import { expect, it } from "vitest";

import { formatBytes, joinWorkspacePath, parentWorkspacePath, workspaceBaseName } from "../../src/pages/conversation/model/workspace/workspace-path.js";
import {
  isUnderWorkspaceTab,
  workspaceTabRoot,
  workspaceTabTitle,
} from "../../src/pages/conversation/model/workspace/workspace-roots.js";

it("joins, splits, and formats workspace paths", () => {
  expect(joinWorkspacePath("", "note.txt")).toBe("note.txt");
  expect(joinWorkspacePath("reports", "a.txt")).toBe("reports/a.txt");
  expect(parentWorkspacePath("")).toBe("");
  expect(parentWorkspacePath("reports")).toBe("");
  expect(parentWorkspacePath("reports/a")).toBe("reports");
  expect(workspaceBaseName("reports/a.txt")).toBe("a.txt");
  expect(formatBytes(12)).toBe("12 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
});

it("scopes workspace tabs to ARTIFACT, ATTACHMENTS, and projects", () => {
  expect(workspaceTabRoot("artifact")).toBe("ARTIFACT");
  expect(workspaceTabRoot("attachments")).toBe("ATTACHMENTS");
  expect(workspaceTabRoot("projects")).toBe("");
  expect(isUnderWorkspaceTab("ARTIFACT", "ARTIFACT")).toBe(true);
  expect(isUnderWorkspaceTab("ARTIFACT/a.txt", "ARTIFACT")).toBe(true);
  expect(isUnderWorkspaceTab("ATTACHMENTS", "ARTIFACT")).toBe(false);
  expect(isUnderWorkspaceTab("", "")).toBe(true);
  expect(workspaceTabTitle("ARTIFACT", "ARTIFACT", "AI 产物")).toBe("AI 产物");
  expect(workspaceTabTitle("ARTIFACT/reports", "ARTIFACT", "AI 产物")).toBe("reports");
  expect(workspaceTabTitle("ARTIFACT/a.txt", "ARTIFACT", "AI 产物", "a.txt")).toBe("a.txt");
});
