import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it } from "vitest";

import { compileSystemPrompt } from "../src/session/context/prompt-policy.js";
import { resolveExecutionTools } from "../src/session/context/tool-policy.js";
import { userDataRootFromVisit } from "../src/session/context/user-data-root.js";
import {
  sessionProjectRoots,
  WORKSPACE_POLICY,
} from "../src/session/context/workspace-policy.js";
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
  expect(text).toContain("Allowed Project Roots");
  expect(text).not.toContain("deliver_artifacts");
});

it("omits the project roots section when the group mounts nothing", () => {
  const parts = compileSystemPrompt(["base"], {
    mode: "group-holder",
    environment: "# Environment",
    commandTool: "bash",
    collaborationEnabled: true,
    projectRoots: [],
    groupWorkspace: {
      root: "/data/users/patient/.runtime/groups/g1/workspace",
      attachments: "/data/users/patient/.runtime/groups/g1/workspace/ATTACHMENTS",
      work: "/data/users/patient/.runtime/groups/g1/workspace/WORK",
      artifact: "/data/users/patient/.runtime/groups/g1/workspace/ARTIFACT",
    },
  });
  expect(parts.join("\n")).not.toContain("Allowed Project Roots");
});

it("adds group mounted roots to a group delegation prompt", () => {
  const parts = compileSystemPrompt(["base"], {
    mode: "group-delegation",
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
    taskId: "task-1",
  });
  expect(parts.join("\n")).toContain("Allowed Project Roots");
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

it("group sessions read only group-mounted roots; single keeps its own visit roots", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ctx-roots-"));
  const visitRoot = path.join(dataRoot, "users", "patient", "agents", "tax");
  fs.mkdirSync(visitRoot, { recursive: true });
  const ownProject = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ctx-own-"));
  fs.writeFileSync(
    path.join(visitRoot, "instance.json"),
    `${JSON.stringify({ user_id: "patient", agent_id: "tax", project_roots: [ownProject] }, null, 2)}\n`,
  );
  const groupDir = path.join(dataRoot, "users", "patient", ".runtime", "groups", "g-1");
  fs.mkdirSync(groupDir, { recursive: true });
  const groupProject = fs.mkdtempSync(path.join(os.tmpdir(), "agentup-ctx-grp-"));
  fs.writeFileSync(
    path.join(groupDir, "settings.json"),
    `${JSON.stringify({ project_roots: [groupProject] }, null, 2)}\n`,
  );
  const visit = {
    userId: "patient",
    agentId: "tax",
    root: visitRoot,
    packageVersion: 1,
    packageDigest: "abc",
    tools: [],
    modelCapabilities: [],
    projectTrust: "granted",
  } satisfies Visit;

  // 一对一：读自己 instance.json 的挂载（旧路径不被群改动破坏）
  expect(
    sessionProjectRoots({ policy: WORKSPACE_POLICY.single, visit }),
  ).toEqual([ownProject]);

  // 群执掌 / 群委托：只读群挂载，不带入成员自己 instance.json 的目录
  for (const mode of ["group-holder", "group-delegation"] as const) {
    expect(
      sessionProjectRoots({ policy: WORKSPACE_POLICY[mode], visit, groupId: "g-1" }),
    ).toEqual([groupProject]);
  }

  // 群身份缺失（不应发生）回落为空，避免误读 visit 挂载
  expect(
    sessionProjectRoots({ policy: WORKSPACE_POLICY["group-holder"], visit }),
  ).toEqual([]);
});
