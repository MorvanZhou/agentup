import path from "node:path";

import { expect, it } from "vitest";

import { compileSystemPrompt } from "../src/session/context/prompt-policy.js";
import { resolveExecutionTools } from "../src/session/context/tool-policy.js";
import { userDataRootFromVisit } from "../src/session/context/user-data-root.js";
import { normalizeGroupWorkspacePaths } from "../src/session/tools/complete-group-task.js";
import type { Visit } from "../src/package/sync.js";

const shell = { shellTools: ["bash"], mcp: false };

it("gives each execution mode its own tool list from the policy table", () => {
  const single = resolveExecutionTools("single", shell);
  const holder = resolveExecutionTools("group-holder", shell);
  const specialist = resolveExecutionTools("single-delegation", shell);
  const groupSpecialist = resolveExecutionTools("group-delegation", shell);

  expect(single).toContain("agent_search");
  expect(single).toContain("delegate_to_agent");
  expect(single).toContain("bg_run");
  expect(single).not.toContain("complete_group_task");

  expect(holder).not.toContain("agent_search");
  expect(holder).toContain("delegate_to_agent");
  expect(holder).toContain("bash");
  expect(holder).not.toContain("complete_group_task");

  expect(specialist).toContain("deliver_artifacts");
  expect(specialist).not.toContain("delegate_to_agent");
  expect(specialist).not.toContain("bg_run");
  expect(specialist).not.toContain("complete_group_task");

  expect(groupSpecialist).toContain("complete_group_task");
  expect(groupSpecialist).not.toContain("deliver_artifacts");
  expect(groupSpecialist).not.toContain("delegate_to_agent");
  expect(groupSpecialist).not.toContain("agent_search");
});

it("omits tool_search until MCP is actually loaded", () => {
  expect(resolveExecutionTools("single", shell)).not.toContain("tool_search");
  expect(resolveExecutionTools("single", { shellTools: ["bash"], mcp: true })).toContain("tool_search");
});

it("resolves the user data root above users/, not inside it", () => {
  const agent: Visit = {
    userId: "patient",
    agentId: "tax",
    root: path.join("/data", "users", "patient", "agents", "tax"),
    packageVersion: 1,
    packageDigest: "abc",
    tools: [],
    modelCapabilities: [],
    projectTrust: "granted",
  };
  const personal: Visit = { ...agent, kind: "personal", root: path.join("/data", "users", "patient", "personal-assistant") };
  expect(userDataRootFromVisit(agent)).toBe(path.resolve("/data"));
  expect(userDataRootFromVisit(personal)).toBe(path.resolve("/data"));
});

it("keeps private cwd instructions out of a group holder prompt", () => {
  const parts = compileSystemPrompt(["base"], {
    mode: "group-holder",
    environment: "# Environment",
    commandTool: "bash",
    collaborationEnabled: true,
    projectRoots: ["/tmp/project"],
    groupWorkspace: {
      root: "/data/users/patient/.runtime/groups/g1/workspace",
      attachments: "/data/users/patient/.runtime/groups/g1/workspace/ATTACHMENTS",
      work: "/data/users/patient/.runtime/groups/g1/workspace/WORK",
      artifact: "/data/users/patient/.runtime/groups/g1/workspace/ARTIFACT",
    },
    groupRoster: "# Group members",
  });
  const text = parts.join("\n");
  expect(text).toContain("Group shared workspace");
  expect(text).toContain("AgentUp Group");
  expect(text).toContain("complete_group_task");
  expect(text).not.toContain("private scratch");
  expect(text).not.toContain("Allowed Project Roots");
  expect(text).not.toContain("deliver_artifacts");
});

it("keeps the one-to-one prompt on the private cwd and its own delivery rule", () => {
  const parts = compileSystemPrompt(["base"], {
    mode: "single",
    environment: "# Environment",
    commandTool: "bash",
    collaborationEnabled: true,
    projectRoots: [],
  });
  const text = parts.join("\n");
  expect(text).toContain("private scratch");
  expect(text).toContain("deliver_artifacts");
  expect(text).not.toContain("Group shared workspace");
  expect(text).not.toContain("complete_group_task");
});

it("rejects group delivery paths that leave WORK or ARTIFACT", () => {
  expect(
    normalizeGroupWorkspacePaths([
      "WORK/from-QA-Ab12Cd34/a.md",
      "ARTIFACT/from-QA-Ab12Cd34/b.html",
    ]),
  ).toEqual(["WORK/from-QA-Ab12Cd34/a.md", "ARTIFACT/from-QA-Ab12Cd34/b.html"]);
  expect(() => normalizeGroupWorkspacePaths(["../secret"])).toThrow(/group workspace/);
  expect(() => normalizeGroupWorkspacePaths(["ATTACHMENTS/a.md"])).toThrow(/WORK\/ or ARTIFACT/);
  expect(() => normalizeGroupWorkspacePaths(["/tmp/a.md"])).toThrow(/group workspace/);
});
